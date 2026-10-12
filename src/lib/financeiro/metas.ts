import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TransactionCategory } from "@/types/database";
import {
  CATEGORIAS_DE_DESPESA,
  type MetaDaCategoria,
} from "@/lib/financeiro/categorias";

/* =====================================================================
   Leitura das metas de gasto
   ---------------------------------------------------------------------
   A conta inteira — meta contra realizado, com toda categoria presente
   mesmo sem nenhum dos dois — é feita em `expense_budget_status`, no
   Postgres, e não aqui.

   POR QUE NO BANCO E NÃO EM JAVASCRIPT. São duas tabelas cruzadas com
   uma lista fixa de categorias; montar isso aqui exigiria buscar
   `expense_budgets` e `financial_transactions` inteiras e juntar na
   memória. Além do tráfego, a junção em JS é onde nasce a divergência
   com `financial_monthly_summary`, que já agrupa por
   `date_trunc('month', coalesce(paid_date, due_date))` — duas regras
   de "a que mês pertence este lançamento" não podem existir.

   ⚠️ RÓTULO E LISTA DE CATEGORIAS NÃO MORAM AQUI, e sim em
   `categorias.ts`. Este arquivo é `server-only`; o painel de metas é
   client component. Importar um VALOR daqui para lá arrasta
   `next/headers` para o bundle e derruba o app inteiro — aconteceu em
   11/10/2026, e a nota longa está lá.
   ===================================================================== */

/**
 * Meta contra realizado no mês pedido.
 *
 * Lista VAZIA no erro, nunca exceção: esta seção divide a página com o
 * histórico, e uma policy recusando (colaborador que digitou a URL,
 * migration ainda não rodada) não pode derrubar a outra. O erro vai
 * para o log; a tela mostra o painel sem números, que é honesto.
 */
export async function metasDoMes(mes: string): Promise<MetaDaCategoria[]> {
  if (isDemoMode) {
    /* ⚠️ O DEMO LÊ O MESMO DATASET DO RESTO DA TELA. A primeira versão
       devolvia zero fixo, e o resultado foi uma tela que se contradizia
       sozinha: o cartão do topo dizia "R$ 13.297,40 saíram em outubro"
       e as sete categorias abaixo diziam "sem lançamento". Um stub que
       mente é pior que stub nenhum — quem abre o demo conclui que o
       painel está quebrado.

       Metas não existem no demo (não há onde gravá-las), então
       `temMeta` é falso e o que varia é só o realizado. */
    const { demoTransactions } = await import("@/lib/mock/finance");

    return CATEGORIAS_DE_DESPESA.map((category) => {
      const doMes = demoTransactions.filter(
        (t) =>
          t.type === "expense" &&
          t.category === category &&
          t.status !== "canceled" &&
          (t.paid_date ?? t.due_date).slice(0, 7) === mes.slice(0, 7),
      );

      return {
        category,
        temMeta: false,
        limiteCents: 0,
        pagoCents: doMes
          .filter((t) => t.status === "paid")
          .reduce((a, t) => a + t.amount_cents, 0),
        previstoCents: doMes
          .filter((t) => t.status === "pending")
          .reduce((a, t) => a + t.amount_cents, 0),
        lancamentos: doMes.length,
      };
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("expense_budget_status", {
    p_month: mes,
  });

  if (error) {
    console.error("[financeiro] expense_budget_status:", error.message);
    return [];
  }

  /* `bigint` chega como STRING pelo PostgREST — somar sem converter
     concatena. É a mesma armadilha que já mordeu o custo por
     resultado. */
  return (
    (data as
      | {
          category: TransactionCategory;
          tem_meta: boolean;
          limite_cents: number | string;
          pago_cents: number | string;
          previsto_cents: number | string;
          lancamentos: number;
        }[]
      | null) ?? []
  ).map((l) => ({
    category: l.category,
    temMeta: l.tem_meta,
    limiteCents: Number(l.limite_cents),
    pagoCents: Number(l.pago_cents),
    previstoCents: Number(l.previsto_cents),
    lancamentos: Number(l.lancamentos),
  }));
}
