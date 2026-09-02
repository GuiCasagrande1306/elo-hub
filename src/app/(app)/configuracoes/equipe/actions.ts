"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode, serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

const schema = z.object({
  profileId: z.string().uuid(),
  role: z.enum(["admin", "collaborator"]),
});

export type RoleResult = { ok: true } | { ok: false; error: string };

/**
 * Altera o nível de acesso de alguém da equipe.
 *
 * NÃO usa `service_role`, e isso é deliberado. O trigger
 * `guard_profile_privileges` já libera a troca quando quem escreve é
 * admin (`if app.is_admin() then return new`), e a policy
 * `profiles_admin_all` cobre a linha. Fazer por service_role
 * contornaria as duas — e no dia em que a regra do banco mudasse, esta
 * rota continuaria promovendo gente por fora dela.
 *
 * A checagem de admin daqui é para dar ERRO LEGÍVEL. Quem barra de
 * verdade é o Postgres: um colaborador que chamasse esta action direto
 * teria `new.role := old.role` aplicado pelo trigger e sairia sem
 * alteração nenhuma.
 */
export async function setUserRole(input: {
  profileId: string;
  role: "admin" | "collaborator";
}): Promise<RoleResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores alteram acessos." };
  }

  /* Rebaixar a si mesmo deixaria a agência sem ninguém capaz de
     promover de volta — e o conserto seria pelo SQL Editor. Barrar aqui
     custa uma linha; destravar depois custa uma sessão. */
  if (parsed.data.profileId === user.id && parsed.data.role !== "admin") {
    return {
      ok: false,
      error: "Você não pode remover o próprio acesso de administrador.",
    };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.profileId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracoes/equipe");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Entrar e sair da equipe                                             */
/* ------------------------------------------------------------------ */

const convite = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  fullName: z.string().trim().min(2, "Escreva o nome da pessoa.").max(120),
  role: z.enum(["admin", "collaborator"]),
});

export type Convite =
  | { ok: true; link: string; reenvio: boolean }
  | { ok: false; error: string };

/**
 * Convida alguém da agência.
 *
 * MESMO CAMINHO DO ACESSO DE CLIENTE — link, não senha. Ver o cabeçalho
 * de `configuracoes/acessos/actions.ts`: o convite é um endereço de uso
 * único que a pessoa abre para escolher a própria senha, e não depende
 * de SMTP configurado no Supabase.
 *
 * ⚠️ O PERFIL NASCE COLABORADOR pelo gatilho `handle_new_user`, e só o
 * UPDATE seguinte o promove. Se esse update falhar num convite de
 * ADMIN, o que sobra é uma pessoa com acesso menor do que devia — o
 * inverso do risco no acesso de cliente, e por isso aqui não se apaga
 * o usuário: perder o convite de alguém da casa por causa de uma falha
 * de rede seria pior que promover à mão depois.
 */
export async function convidarMembro(
  input: z.input<typeof convite>,
): Promise<Convite> {
  const parsed = convite.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores convidam." };
  }
  if (isDemoMode) {
    return { ok: false, error: "Modo demo: convidar está desativado." };
  }

  const { email, fullName, role } = parsed.data;
  const admin = createSupabaseAdminClient();

  const { data: existente } = await admin
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();

  if (existente) {
    if (existente.role === "client") {
      return {
        ok: false,
        error:
          "Esse e-mail pertence a um acesso de cliente antigo. Apague o usuário no Supabase antes de trazê-lo para a equipe.",
      };
    }

    /* Já é da equipe: o que a pessoa quer é um link novo, não um
       convite duplicado — `invite` no mesmo e-mail falharia com
       "already registered" e o operador não tem como saber disso. */
    const link = await linkDeRecuperacao(admin, email);
    return link.ok
      ? { ok: true, link: link.link, reenvio: true }
      : { ok: false, error: link.error };
  }

  const { data: criado, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName } },
  });

  if (error || !criado?.user) {
    return { ok: false, error: error?.message ?? "Não foi possível convidar." };
  }

  const { error: erroPerfil } = await admin
    .from("profiles")
    .update({ full_name: fullName, role })
    .eq("id", criado.user.id);

  if (erroPerfil) {
    return {
      ok: false,
      error: `Convite criado, mas o nível não foi aplicado: ${erroPerfil.message}. Ajuste na lista.`,
    };
  }

  revalidatePath("/configuracoes/equipe");

  return {
    ok: true,
    reenvio: false,
    link: linkDeAcao(criado.properties.hashed_token, "invite"),
  };
}

/**
 * Tira alguém da equipe — apaga o usuário de autenticação.
 *
 * DESATIVAR NÃO BASTA: `is_active` some com a pessoa das listas e nada
 * no caminho de login o consulta. Quem saiu da agência precisa parar de
 * entrar.
 *
 * O QUE ELA FEZ FICA. `optimization_history.collaborator_id`,
 * `tasks` e o resto apontam para `profiles` com `on delete set null` —
 * o registro do que foi feito na conta sobrevive à saída, que é
 * justamente o que explica a variação do mês seguinte.
 */
export async function removerMembro(profileId: string): Promise<RoleResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores removem acessos." };
  }
  if (isDemoMode) {
    return { ok: false, error: "Modo demo: remover está desativado." };
  }

  /* Remover a si mesmo deixaria a sessão viva sobre um usuário que não
     existe mais — e, se fosse o último admin, a agência sem ninguém
     capaz de promover. */
  if (profileId === user.id) {
    return { ok: false, error: "Você não pode remover o próprio acesso." };
  }

  const admin = createSupabaseAdminClient();

  const { data: alvo } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", profileId)
    .maybeSingle();

  if (!alvo) return { ok: false, error: "Pessoa não encontrada." };

  /* ACESSO DE CLIENTE REMANESCENTE. A tela que criava esses usuários
     saiu junto com o CRM do cliente, e hoje não há nenhum — mas a
     guarda fica: se sobrar um numa base antiga, apagá-lo por aqui
     seria às cegas, porque a lista de equipe não mostra de qual empresa
     a pessoa é. */
  if (alvo.role === "client") {
    return {
      ok: false,
      error:
        "Esse é um acesso de cliente de uma versão anterior do painel. Apague o usuário no Supabase.",
    };
  }

  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/configuracoes/equipe");
  return { ok: true };
}

/* ------------------------------------------------------------------ */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function linkDeRecuperacao(
  admin: Admin,
  email: string,
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error || !data?.properties) {
    return { ok: false, error: error?.message ?? "Não foi possível gerar o link." };
  }

  return { ok: true, link: linkDeAcao(data.properties.hashed_token, "recovery") };
}

/**
 * O endereço que vai para a pessoa.
 *
 * Aponta para `/auth/confirm`, não para o `action_link` do Supabase —
 * aquele devolve a sessão no fragmento da URL, que nunca chega ao
 * servidor, e este app guarda sessão em cookie. Mesma explicação, mais
 * longa, em `configuracoes/acessos/actions.ts`.
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
