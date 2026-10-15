"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { ROTULO_DA_CATEGORIA } from "@/lib/financeiro/categorias";
import { cn } from "@/lib/utils";
import type { FinancialTransaction } from "@/types/database";

const STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  canceled: "Cancelado",
};

export function ExtratoDoMes({
  mes,
  transactions,
}: {
  mes: string; // "YYYY-MM-01"
  transactions: FinancialTransaction[];
}) {
  const anoMes = mes.slice(0, 7);

  const doMes = transactions.filter((t) => {
    const data = (t.paid_date ?? t.due_date).slice(0, 7);
    return data === anoMes;
  });

  if (doMes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum lançamento neste mês.
      </p>
    );
  }

  return (
    <div className="divide-y divide-hairline rounded-lg border border-hairline">
      {doMes.map((t) => {
        const isIncome = t.type === "income";
        const data = t.paid_date ?? t.due_date;
        const dia = new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
        });

        return (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              t.status === "canceled" && "opacity-40",
            )}
          >
            {/* ícone entrada/saída */}
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full",
                isIncome
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              )}
            >
              {isIncome ? (
                <ArrowDownLeft className="size-3.5" />
              ) : (
                <ArrowUpRight className="size-3.5" />
              )}
            </span>

            {/* descrição + categoria */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.description}</p>
              <p className="text-2xs text-muted-foreground">
                {ROTULO_DA_CATEGORIA[t.category] ?? t.category}
                {" · "}
                <span
                  className={cn(
                    t.status === "pending" && "text-warning",
                    t.status === "paid" && "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </p>
            </div>

            {/* data */}
            <span className="shrink-0 text-2xs text-muted-foreground">{dia}</span>

            {/* valor */}
            <span
              className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                isIncome
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground",
              )}
            >
              {isIncome ? "+" : "−"}{formatCurrency(t.amount_cents)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
