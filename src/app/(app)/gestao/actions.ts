"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Baixa de um lançamento (contas a pagar / a receber).
 *
 * Sem checagem de papel na aplicação: a policy `financial_admin_only`
 * exige `app.is_admin()` no `with check` do UPDATE, então um
 * colaborador recebe violação de privilégio do próprio banco. Barrar
 * aqui seria redundante e criaria uma segunda fonte de verdade sobre
 * quem pode o quê.
 */
const schema = z.object({
  id: z.string().min(1),
  // Data da baixa. Vazio = hoje.
  paidDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SettleResult = { ok: true } | { ok: false; error: string };

export async function settleTransaction(input: {
  id: string;
  paidDate?: string;
}): Promise<SettleResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const paidDate = parsed.data.paidDate ?? new Date().toISOString().slice(0, 10);

  if (isDemoMode) {
    const { demoTransactions } = await import("@/lib/mock/finance");
    const t = demoTransactions.find((x) => x.id === parsed.data.id);
    if (t) {
      t.status = "paid";
      t.paid_date = paidDate;
    }
    revalidatePath("/gestao");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  // A constraint `paid_needs_date` exige que status e paid_date andem
  // juntos — por isso os dois vão no mesmo UPDATE.
  const { error } = await supabase
    .from("financial_transactions")
    .update({ status: "paid", paid_date: paidDate })
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Apenas administradores podem dar baixa." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/gestao");
  return { ok: true };
}

/** Reabre um lançamento baixado por engano. */
export async function reopenTransaction(id: string): Promise<SettleResult> {
  if (isDemoMode) {
    const { demoTransactions } = await import("@/lib/mock/finance");
    const t = demoTransactions.find((x) => x.id === id);
    if (t) {
      t.status = "pending";
      t.paid_date = null;
    }
    revalidatePath("/gestao");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("financial_transactions")
    .update({ status: "pending", paid_date: null })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/gestao");
  return { ok: true };
}
