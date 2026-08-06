"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
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
