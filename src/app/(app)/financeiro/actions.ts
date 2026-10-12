"use server";

import { revalidatePath } from "next/cache";

import { isDemoMode } from "@/lib/env";
import { parseCurrencyToCents } from "@/lib/format";
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";

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
  /** Primeiro dia do mês, `YYYY-MM-01`. */
  mes: string;
  category: string;
  /** Texto do formulário: "4.000,00". Vazio apaga. */
  limite: string;
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

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  if (bruto === "") {
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

  const cents = parseCurrencyToCents(bruto);
  if (cents === null || cents < 0) {
    return { ok: false, error: "Valor inválido. Use algo como 4.000,00." };
  }

  /* `upsert` na chave (month, category), que é a unique da migration
     90: a tela edita uma célula e não sabe se a linha existe. */
  const { error } = await supabase.from("expense_budgets").upsert(
    {
      month: input.mes,
      category: input.category,
      limit_cents: cents,
      note: input.note?.trim() || null,
      created_by: user.id,
    },
    { onConflict: "month,category" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/financeiro");
  return { ok: true };
}
