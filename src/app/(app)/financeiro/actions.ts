"use server";

import { revalidatePath } from "next/cache";

import { isDemoMode } from "@/lib/env";
import { parseCurrencyToCents } from "@/lib/format";
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import type { TransactionCategory } from "@/types/database";

/* =====================================================================
   Ações do financeiro
   ---------------------------------------------------------------------
   TUDO AQUI É ADMIN, e a trava real é a policy `expense_budgets_admin_only`
   no Postgres — não a checagem de papel abaixo. A checagem existe para
   devolver uma frase em português em vez de "permission denied", que é
   o que a pessoa veria se só o banco recusasse.
   ===================================================================== */

type Resultado = { ok: true } | { ok: false; error: string };

/**
 * Grava a meta de gasto de uma categoria no mês.
 *
 * CAMPO VAZIO APAGA A META, e isso é diferente de gravar zero. Meta
 * zero é decisão ("não quero gastar nada em freelancer este mês") e a
 * tela a mostra como orçamento; meta ausente é a categoria sem
 * orçamento definido. Sem o apagar, não haveria como voltar atrás de
 * um número digitado por engano.
 */
export async function salvarMetaDeGasto(input: {
  mes: string;
  category: string;
  /** Texto do campo de valor fixo: "4.000,00". Vazio = sem meta fixa. */
  limite: string;
  /** Percentual (0–100). null = sem meta %. Exclusivo com limite. */
  percent?: number | null;
  note?: string | null;
}): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Faça login de novo." };
  if (user.role !== "admin") {
    return { ok: false, error: "Só administrador mexe no financeiro." };
  }

  if (!/^\d{4}-\d{2}-01$/.test(input.mes)) {
    return { ok: false, error: "Mês inválido." };
  }

  const bruto = input.limite.trim();
  const usandoPercent = input.percent != null && input.percent > 0;

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  /* Apagar: campo de valor vazio E sem percentual */
  if (bruto === "" && !usandoPercent) {
    /* ⚠️ `count` EXATO, e não só `error`. O PostgREST devolve
       `error: null` quando o delete não casa nenhuma linha — sem o
       count, apagar uma meta que a policy recusou diria "meta
       removida" e a tela voltaria a mostrá-la no refresh, sem
       explicação. */
    const { error, count } = await supabase
      .from("expense_budgets")
      .delete({ count: "exact" })
      .eq("month", input.mes)
      .eq("category", input.category);

    if (error) return { ok: false, error: error.message };
    if (count === 0) {
      /* Nada a apagar é sucesso: a pessoa limpou um campo que já
         estava vazio. Só não pode ser confundido com recusa. */
      revalidatePath("/financeiro");
      return { ok: true };
    }

    revalidatePath("/financeiro");
    return { ok: true };
  }

  if (usandoPercent) {
    const pct = Number(input.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: "Percentual inválido (1–100)." };
    }
    const { error } = await supabase.from("expense_budgets").upsert(
      { month: input.mes, category: input.category, percent: pct, limit_cents: null, note: input.note?.trim() || null, created_by: user.id },
      { onConflict: "month,category" },
    );
    if (error) return { ok: false, error: error.message };
    revalidatePath("/financeiro");
    return { ok: true };
  }

  const cents = parseCurrencyToCents(bruto);
  if (cents === null || cents < 0) {
    return { ok: false, error: "Valor inválido. Use algo como 4.000,00." };
  }

  const { error } = await supabase.from("expense_budgets").upsert(
    {
      month: input.mes,
      category: input.category,
      limit_cents: cents,
      percent: null,
      note: input.note?.trim() || null,
      created_by: user.id,
    },
    { onConflict: "month,category" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/financeiro");
  return { ok: true };
}

/**
 * Lança uma transação avulsa (entrada ou saída).
 */
export async function lancarTransacao(input: {
  tipo: "income" | "expense";
  category: TransactionCategory;
  descricao: string;
  valorStr: string;
  dataVencimento: string;
  dataPagamento: string | null;
  status: "paid" | "pending";
}): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Faça login de novo." };
  if (user.role !== "admin") {
    return { ok: false, error: "Só administrador lança transações." };
  }

  const cents = parseCurrencyToCents(input.valorStr);
  if (cents === null || cents <= 0) {
    return { ok: false, error: "Valor inválido. Use algo como 1.500,00." };
  }

  if (!input.dataVencimento) {
    return { ok: false, error: "Informe a data de vencimento." };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("financial_transactions").insert({
    type: input.tipo,
    category: input.category,
    description: input.descricao.trim(),
    amount_cents: cents,
    due_date: input.dataVencimento,
    paid_date: input.status === "paid" ? (input.dataPagamento || input.dataVencimento) : null,
    status: input.status,
    provider: null,
    external_id: null,
    recurrence_key: null,
    client_id: null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/financeiro");
  return { ok: true };
}
