"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";

/* =====================================================================
   Acesso de cliente ao painel
   ---------------------------------------------------------------------
   O QUE ESTA TELA CRIA É GENTE DE FORA DA AGÊNCIA COM LOGIN. Não é um
   cadastro qualquer: um erro aqui não mostra número errado, mostra a
   base de leads de um cliente para outro. Três decisões saem disso.

   1. LINK, NÃO SENHA. O convite é um endereço de uso único que a
      pessoa abre e usa para escolher a própria senha. A alternativa —
      gerar uma senha e mandar pronta — coloca uma credencial no grupo
      de WhatsApp, onde ela fica para sempre, e quase ninguém troca
      depois.

      O link é montado aqui e NÃO depende de e-mail: a agência conversa
      com o cliente por WhatsApp, e um convite que só chega por e-mail
      depende de SMTP configurado no Supabase para funcionar. Copiar e
      colar sempre funciona.

   2. FALHA DESFAZ. `generateLink` do tipo `invite` CRIA o usuário — e o
      gatilho `handle_new_user` provisiona o perfil como COLABORADOR,
      que enxerga a carteira inteira. Só o UPDATE seguinte o rebaixa a
      `client`. Se esse update falhar e a gente deixar por isso mesmo,
      sobra um login de gente de fora com acesso de equipe. Então: se
      ele falhar, o usuário de autenticação é apagado.

   3. SERVICE_ROLE COM CHECAGEM À MÃO. É `service_role` porque só ele
      cria usuário e porque o gatilho `guard_profile_privileges` congela
      `role` e `client_id` para todo o resto. Como o RLS não protege
      nada por aqui, a checagem de admin é feita na primeira linha de
      cada função — ver a regra no topo de `lib/supabase/admin.ts`.
   ===================================================================== */

export type Resultado<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

const convite = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  fullName: z.string().trim().min(2, "Escreva o nome de quem vai acessar.").max(120),
  clientId: z.string().uuid(),
});

export interface ConviteGerado {
  /** O endereço para mandar no WhatsApp. Uso único. */
  link: string;
  /** `true` quando a pessoa já tinha acesso e isto é um novo link. */
  reenvio: boolean;
  email: string;
}

/**
 * Cria (ou renova) o acesso de uma pessoa do cliente.
 *
 * Idempotente do ponto de vista de quem opera: chamar de novo para
 * alguém que já tem acesso não duplica nada — devolve um link de
 * redefinição de senha, que é o que "reenviar o convite" significa
 * depois que o usuário já existe. `invite` no mesmo e-mail falharia com
 * "already registered", e o operador não tem como saber disso de
 * antemão.
 */
export async function convidarCliente(
  input: z.input<typeof convite>,
): Promise<Resultado<ConviteGerado>> {
  const parsed = convite.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores dão acesso a clientes." };
  }

  const { email, fullName, clientId } = parsed.data;
  const admin = createSupabaseAdminClient();

  /* A empresa precisa existir ANTES de o usuário nascer. O `check`
     `profiles_client_role_coerente` exige `client_id` não nulo para
     papel de cliente, e a FK exige que ele aponte para uma linha real —
     descobrir isso só no update deixaria o usuário órfão para trás. */
  const { data: empresa } = await admin
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!empresa) return { ok: false, error: "Cliente não encontrado." };

  /* --- já existe alguém com este e-mail? --------------------------- */
  const { data: existente } = await admin
    .from("profiles")
    .select("id, role, client_id, full_name")
    .eq("email", email)
    .maybeSingle();

  if (existente) {
    if (existente.role !== "client") {
      return {
        ok: false,
        error:
          "Esse e-mail já é da equipe da agência. Use um e-mail do cliente.",
      };
    }

    if (existente.client_id !== clientId) {
      /* Mover uma pessoa de uma empresa para outra é uma operação de
         consequência — ela passaria a ver outra base. Não acontece por
         engano de digitação num campo de convite. */
      return {
        ok: false,
        error:
          "Esse e-mail já tem acesso a outro cliente. Remova o acesso antigo antes.",
      };
    }

    const link = await gerarLink(admin, "recovery", email);
    if (!link.ok) return link;

    return { ok: true, dados: { link: link.dados, reenvio: true, email } };
  }

  /* --- convite novo ------------------------------------------------ */
  const { data: criado, error: erroConvite } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    /* `full_name` viaja no metadado porque é de lá que
       `handle_new_user` tira o nome ao provisionar o perfil. Sem isso o
       perfil nasce com o pedaço do e-mail antes do @. */
    options: { data: { full_name: fullName } },
  });

  if (erroConvite || !criado?.user) {
    return {
      ok: false,
      error: erroConvite?.message ?? "Não foi possível criar o convite.",
    };
  }

  /* O PERFIL NASCEU COLABORADOR — ver a nota 2 no topo. */
  const { error: erroPerfil } = await admin
    .from("profiles")
    .update({ role: "client", client_id: clientId, full_name: fullName })
    .eq("id", criado.user.id);

  if (erroPerfil) {
    /* DESFAZ. Deixar o usuário criado seria deixar um login de fora da
       agência com acesso de equipe — o oposto do que esta tela existe
       para fazer. */
    await admin.auth.admin.deleteUser(criado.user.id);
    return {
      ok: false,
      error: `Convite desfeito — não foi possível vincular à empresa: ${erroPerfil.message}`,
    };
  }

  revalidatePath("/configuracoes/acessos");

  return {
    ok: true,
    dados: {
      link: linkDeAcao(criado.properties.hashed_token, "invite"),
      reenvio: false,
      email,
    },
  };
}

/**
 * Um link novo para quem já tem acesso.
 *
 * Serve para as duas situações que aparecem na prática: a pessoa
 * perdeu o convite antes de abrir, ou esqueceu a senha meses depois. Os
 * dois casos terminam na mesma tela, escolhendo uma senha nova.
 */
export async function reenviarAcesso(email: string): Promise<Resultado<string>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores." };
  }

  const admin = createSupabaseAdminClient();
  const link = await gerarLink(admin, "recovery", email.trim().toLowerCase());
  if (!link.ok) return link;

  return { ok: true, dados: link.dados };
}

/**
 * Tira o acesso — apaga o usuário de autenticação.
 *
 * DESATIVAR NÃO BASTA. `is_active` é usado para sumir com a pessoa das
 * listas da equipe, e nada no caminho de login o consulta: um perfil
 * "inativo" continua entrando e continua lendo. Para acesso de fora da
 * agência isso não serve — "remover" tem que remover.
 *
 * Os leads FICAM. `lead_deals.created_by` e `owner_id` apontam para
 * `profiles` com `on delete set null`, então o histórico do funil
 * sobrevive à saída da pessoa que o cadastrou.
 */
export async function removerAcesso(profileId: string): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores." };
  }

  const admin = createSupabaseAdminClient();

  /* Confere que é MESMO um acesso de cliente antes de apagar. Sem esta
     linha, um `profileId` trocado apagaria alguém da equipe — e esta
     função roda com service_role, sem RLS para segurar. */
  const { data: alvo } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", profileId)
    .maybeSingle();

  if (!alvo) return { ok: false, error: "Acesso não encontrado." };
  if (alvo.role !== "client") {
    return {
      ok: false,
      error: "Esse usuário é da equipe. Remova pela tela de Equipe.",
    };
  }

  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracoes/acessos");
  return { ok: true };
}

/* ------------------------------------------------------------------ */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function gerarLink(
  admin: Admin,
  tipo: "invite" | "recovery",
  email: string,
): Promise<Resultado<string>> {
  const { data, error } = await admin.auth.admin.generateLink({ type: tipo, email });

  if (error || !data?.properties) {
    return { ok: false, error: error?.message ?? "Não foi possível gerar o link." };
  }

  return { ok: true, dados: linkDeAcao(data.properties.hashed_token, tipo) };
}

/**
 * O endereço que vai para o cliente.
 *
 * NÃO É O `action_link` QUE O SUPABASE DEVOLVE. Aquele aponta para
 * `/auth/v1/verify` do próprio Supabase, que devolve a sessão no
 * fragmento da URL (`#access_token=…`) — e fragmento não chega ao
 * servidor, então os cookies de sessão que este app usa nunca seriam
 * gravados. A pessoa clicaria, veria a tela de login e não entenderia.
 *
 * O caminho que funciona com sessão em cookie é trocar o token por
 * sessão NO SERVIDOR: `/auth/confirm` faz `verifyOtp` e só então
 * redireciona. Ver o próprio route handler.
 */
function linkDeAcao(hashedToken: string, tipo: "invite" | "recovery"): string {
  const base = serverEnv.appUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    token_hash: hashedToken,
    type: tipo,
    next: "/definir-senha",
  });

  return `${base}/auth/confirm?${params.toString()}`;
}
