"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

const schema = z.object({
  clientId: z.string().min(1),
  notes: z
    .string()
    .trim()
    .min(3, "Descreva o que foi otimizado.")
    .max(4000, "Máximo de 4000 caracteres."),
  reportSent: z.boolean(),
  /* Projeção em texto porque vem de um input: "87,5" precisa virar
     87.5, e deixar o número entrar direto obrigaria o formulário a
     lidar com a vírgula do teclado brasileiro. */
  goalProjection: z.string().trim(),
});

export type RegisterResult = { ok: true } | { ok: false; error: string };

/**
 * Registra uma rodada da esteira.
 *
 * O autor vem da SESSÃO, não do formulário — a policy de insert exige
 * `collaborator_id = auth.uid()`, então mandar outro id seria recusado
 * pelo banco de qualquer forma. Resolver aqui dá erro legível.
 *
 * Não existe edição: histórico que se altera depois deixa de ser prova.
 * Correção se faz com um registro novo.
 */
export async function registerOptimization(input: {
  clientId: string;
  notes: string;
  reportSent: boolean;
  goalProjection: string;
}): Promise<RegisterResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const bruto = parsed.data.goalProjection.replace(",", ".");
  const projecao = bruto === "" ? null : Number(bruto);

  if (projecao !== null && (!Number.isFinite(projecao) || projecao < 0)) {
    return { ok: false, error: "A projeção precisa ser um número positivo." };
  }

  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    demoOptimizations.unshift({
      id: `op-${Date.now()}`,
      client_id: parsed.data.clientId,
      collaborator_id: user.id,
      notes: parsed.data.notes,
      report_sent: parsed.data.reportSent,
      goal_projection: projecao,
      created_at: new Date().toISOString(),
      collaborator: { id: user.id, full_name: user.full_name },
    });
    revalidatePath("/esteira");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("optimization_history").insert({
    client_id: parsed.data.clientId,
    collaborator_id: user.id,
    notes: parsed.data.notes,
    report_sent: parsed.data.reportSent,
    goal_projection: projecao,
  });

  if (error) {
    // 42501 = violação de policy: a pessoa não atende esta conta.
    if (error.code === "42501") {
      return {
        ok: false,
        error: "Você não tem acesso a esta conta para registrar otimização.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/esteira");
  return { ok: true };
}
