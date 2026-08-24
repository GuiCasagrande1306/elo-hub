import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/* =====================================================================
   Leitura da caixa de entrada
   ---------------------------------------------------------------------
   TUDO SOB RLS, sem service_role — mesma regra do resto do CRM. Aqui
   pesa mais do que lá: o que está sendo lido é conversa entre o cliente
   e os clientes DELE. A policy da migration 62 libera a empresa dona e
   a equipe que atende aquela conta, e é ela quem decide, não um `where`
   escrito à mão.
   ===================================================================== */

export interface ConversaDaLista {
  id: string;
  jid: string;
  nome: string | null;
  eh_grupo: boolean;
  ultima_em: string | null;
  ultima_previa: string | null;
  nao_lidas: number;
  deal_id: string | null;
}

export interface MensagemDaThread {
  id: string;
  wa_id: string;
  de_mim: boolean;
  tipo: string;
  texto: string | null;
  midia_path: string | null;
  midia_mime: string | null;
  midia_nome: string | null;
  enviada_em: string;
  /** URL assinada, montada na leitura. `null` quando não há arquivo. */
  midia_url: string | null;
}

/**
 * As conversas da empresa, mais recentes primeiro.
 *
 * TETO DE 200. Uma caixa de entrada de WhatsApp cresce sem limite, e
 * `PostgREST` corta em 1000 sem avisar — o defeito que já apareceu em
 * `getAgencyTrend` nesta base. Melhor um teto explícito e visível na
 * tela do que uma lista que um dia para de crescer em silêncio. Quando
 * fizer falta, entra busca; rolagem infinita numa lista ordenada por
 * atividade recente nunca é o que se quer.
 */
export async function listarConversas(
  clientId: string,
): Promise<ConversaDaLista[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("wa_conversas")
    .select("id, jid, nome, eh_grupo, ultima_em, ultima_previa, nao_lidas, deal_id")
    .eq("client_id", clientId)
    .order("ultima_em", { ascending: false, nullsFirst: false })
    .limit(200);

  /* Erro NÃO vira lista vazia: caixa de entrada em branco por falha de
     consulta é indistinguível de caixa sem conversa, e a segunda é
     estado normal no primeiro dia. */
  if (error) throw new Error(`Conversas: ${error.message}`);

  return (data ?? []) as ConversaDaLista[];
}

/**
 * A thread de uma conversa.
 *
 * ORDEM CRESCENTE, e o teto corta as MAIS ANTIGAS: numa conversa a
 * pessoa lê de baixo para cima, então perder o começo de um histórico
 * de dois anos é aceitável; perder o que foi dito agora, não. Por isso
 * a consulta pede as últimas em ordem decrescente e inverte aqui.
 */
export async function carregarThread(
  conversaId: string,
  limite = 100,
): Promise<MensagemDaThread[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("wa_mensagens")
    .select(
      "id, wa_id, de_mim, tipo, texto, midia_path, midia_mime, midia_nome, enviada_em",
    )
    .eq("conversa_id", conversaId)
    .order("enviada_em", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Mensagens: ${error.message}`);

  const linhas = (data ?? []).reverse() as MensagemDaThread[];

  /* --- as URLs da mídia -------------------------------------------
     UMA chamada para todos os arquivos, não uma por mensagem. Uma
     thread com trinta áudios faria trinta idas ao Storage antes de a
     tela desenhar.

     Assinadas com uma hora: tempo de sobra para ouvir e rever, e curto
     o bastante para um link copiado por engano não virar acesso
     permanente a mensagem de terceiro. */
  const caminhos = linhas
    .map((m) => m.midia_path)
    .filter((p): p is string => Boolean(p));

  if (caminhos.length === 0) {
    return linhas.map((m) => ({ ...m, midia_url: null }));
  }

  const { data: assinadas } = await supabase.storage
    .from("whatsapp-media")
    .createSignedUrls(caminhos, 3600);

  const porCaminho = new Map(
    (assinadas ?? []).map((a) => [a.path, a.signedUrl ?? null]),
  );

  return linhas.map((m) => ({
    ...m,
    midia_url: m.midia_path ? (porCaminho.get(m.midia_path) ?? null) : null,
  }));
}

/** Quantas mensagens ainda não lidas a empresa tem, somando tudo. */
export function totalNaoLidas(conversas: ConversaDaLista[]): number {
  return conversas.reduce((soma, c) => soma + c.nao_lidas, 0);
}

/**
 * O número, legível, a partir do JID.
 *
 * `5547999998888@s.whatsapp.net` → `+55 47 99999-8888`. Grupo não tem
 * número — o JID dele é um id interno do WhatsApp, e mostrá-lo como
 * telefone seria inventar um número que não disca.
 */
export function telefoneDoJid(jid: string): string | null {
  if (jid.endsWith("@g.us")) return null;

  const d = jid.split("@")[0].replace(/\D/g, "");
  if (d.length < 12 || d.length > 13) return d ? `+${d}` : null;

  const pais = d.slice(0, 2);
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);

  return resto.length === 9
    ? `+${pais} ${ddd} ${resto.slice(0, 5)}-${resto.slice(5)}`
    : `+${pais} ${ddd} ${resto.slice(0, 4)}-${resto.slice(4)}`;
}
