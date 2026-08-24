"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/whatsapp";
import { instanceNameForClient } from "@/lib/whatsapp/session";

/* =====================================================================
   Escrever na conversa
   ---------------------------------------------------------------------
   QUEM RESPONDE É O CLIENTE. A agência lê para atender junto, e não
   escreve — foi a decisão de 23/08/2026, e ela está aqui em `if`
   explícito porque não dá para expressá-la em policy: as tabelas `wa_*`
   não têm escrita para sessão nenhuma (ver migration 62), então a
   autorização precisa ser conferida à mão antes de o `service_role`
   entrar.

   POR QUE service_role E NÃO UMA POLICY DE INSERT. Uma policy que
   deixasse o cliente escrever em `wa_mensagens` deixaria ele escrever
   QUALQUER mensagem: forjar uma recebida, mudar o autor, inventar
   histórico numa conversa que ele mesmo vai usar como prova depois. A
   tabela guarda o que o WhatsApp disse — e a única coisa que a tela
   pode acrescentar é uma mensagem que ela ACABOU de mandar de verdade.
   Por isso a gravação só acontece DEPOIS de a Evolution confirmar o
   envio, e com o id que ela devolveu.
   ===================================================================== */

export type Resultado<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

const LIMITE_TEXTO = 4096;

interface Alvo {
  clientId: string;
  jid: string;
}

/**
 * A conversa existe, é visível, e esta pessoa pode escrever nela?
 *
 * A leitura passa pela SESSÃO: quem decide se a conversa é visível é a
 * policy, não este código. O que fica aqui é só a regra de quem
 * escreve — que a policy não expressa.
 */
async function alvoParaEscrita(
  conversaId: string,
): Promise<{ ok: true; alvo: Alvo } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data: conversa } = await supabase
    .from("wa_conversas")
    .select("id, client_id, jid")
    .eq("id", conversaId)
    .maybeSingle();

  if (!conversa) return { ok: false, error: "Conversa não encontrada." };

  if (user.role !== "client" || user.client_id !== conversa.client_id) {
    return {
      ok: false,
      error:
        "Quem responde pelo WhatsApp é a própria empresa. A Elo acompanha a conversa, mas não escreve por ela.",
    };
  }

  return { ok: true, alvo: { clientId: conversa.client_id, jid: conversa.jid } };
}

export async function enviarMensagem(input: {
  conversaId: string;
  texto: string;
}): Promise<Resultado> {
  const texto = input.texto.trim();
  if (!texto) return { ok: false, error: "Escreva alguma coisa." };
  if (texto.length > LIMITE_TEXTO) {
    return { ok: false, error: "Mensagem longa demais para o WhatsApp." };
  }

  const permissao = await alvoParaEscrita(input.conversaId);
  if (!permissao.ok) return permissao;

  const { clientId, jid } = permissao.alvo;

  /* MANDA PRIMEIRO, GRAVA DEPOIS. Na ordem inversa, uma falha de rede
     deixaria na tela uma mensagem que o destinatário nunca recebeu — e
     o atendente seguiria a conversa achando que já respondeu. */
  const envio = await sendTextMessage(jid, texto, instanceNameForClient(clientId));

  if (!envio.success) {
    return {
      ok: false,
      error:
        envio.error ??
        "O WhatsApp recusou o envio. Confira se o número ainda está conectado.",
    };
  }

  /* O id vem da Evolution, e é o mesmo que o webhook vai trazer daqui a
     um segundo com `fromMe: true`. Usá-lo é o que faz a reentrega bater
     no `unique (conversa_id, wa_id)` em vez de duplicar a mensagem na
     tela. Sem id na resposta, não gravamos: o webhook grava por nós, um
     instante depois. */
  const waId = (envio.data as { key?: { id?: string } } | undefined)?.key?.id;

  if (!waId) {
    revalidatePath("/crm");
    return { ok: true };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("wa_mensagens").insert({
    conversa_id: input.conversaId,
    client_id: clientId,
    wa_id: waId,
    de_mim: true,
    tipo: "texto",
    texto,
    enviada_em: new Date().toISOString(),
  });

  /* Duplicata aqui significa que o webhook chegou primeiro — o que é
     bom, não erro. Qualquer outra falha some com a mensagem da tela sem
     desfazer o envio, e é isso que precisa aparecer. */
  if (error && error.code !== "23505") {
    return {
      ok: false,
      error: `Enviada, mas não registrada aqui: ${error.message}`,
    };
  }

  revalidatePath("/crm");
  return { ok: true };
}

/**
 * Zera o contador de não lidas.
 *
 * Não confirma leitura para o outro lado — o risquinho azul continua
 * dependendo do aplicativo. Isto é só o contador desta tela, e mexer
 * nele não muda nada do lado de quem escreveu.
 */
export async function marcarComoLida(conversaId: string): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data: conversa } = await supabase
    .from("wa_conversas")
    .select("id, client_id, nao_lidas")
    .eq("id", conversaId)
    .maybeSingle();

  if (!conversa) return { ok: false, error: "Conversa não encontrada." };

  /* Já está zerada: sai sem escrever. Abrir a mesma conversa dez vezes
     não deve produzir dez UPDATEs — cada um é um evento de Realtime
     para todo mundo que está com a caixa aberta. */
  if (conversa.nao_lidas === 0) return { ok: true };

  /* A EQUIPE DA AGÊNCIA NÃO ZERA. Ela lê para acompanhar; se a leitura
     dela apagasse o contador, o cliente abriria a caixa e não veria o
     que chegou enquanto esteve fora. O contador é do dono do número. */
  if (user.role !== "client" || user.client_id !== conversa.client_id) {
    return { ok: true };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("wa_conversas")
    .update({ nao_lidas: 0 })
    .eq("id", conversaId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}
