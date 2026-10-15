"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AsaasMovimentacao } from "@/lib/asaas/extrato";

const TIPO_ASAAS: Record<string, string> = {
  PAYMENT_RECEIVED:             "Recebimento",
  PAYMENT_RECEIVED_IN_CASH_AND_CREDIT_CARD: "Recebimento (cartão)",
  TRANSFER:                     "Transferência",
  CREDIT:                       "Crédito",
  DEBIT:                        "Débito",
  FEE:                          "Tarifa",
  INTERNAL_TRANSFER_DEBIT:      "Transf. interna",
  INTERNAL_TRANSFER_CREDIT:     "Transf. interna",
  REFUND:                       "Estorno",
  CHARGEBACK:                   "Chargeback",
  ANTICIPATED_PAYMENT:          "Antecipação",
  PIX_CREDIT:                   "PIX recebido",
  PIX_DEBIT:                    "PIX enviado",
  BANK_SLIP_FEE:                "Tarifa de boleto",
  PIX_TRANSACTION_FEE:          "Tarifa PIX",
  CREDIT_CARD_TRANSACTION_FEE:  "Tarifa cartão",
};

function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.abs(value));
}

const INICIAL = 8;

export function ExtratoAsaas({
  movimentacoes,
  saldoFinal,
}: {
  movimentacoes: AsaasMovimentacao[];
  saldoFinal: number | null;
}) {
  const [expandido, setExpandido] = useState(false);

  if (movimentacoes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma movimentação no período.
      </p>
    );
  }

  const totalCredito = movimentacoes.filter((m) => m.value > 0).reduce((a, m) => a + m.value, 0);
  const totalDebito  = movimentacoes.filter((m) => m.value < 0).reduce((a, m) => a + m.value, 0);
  const visiveis = expandido ? movimentacoes : movimentacoes.slice(0, INICIAL);

  return (
    <div className="space-y-3">
      {/* ── Totais ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="surface-card p-3">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Recebido</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            +{formatBRL(totalCredito)}
          </p>
        </div>
        <div className="surface-card p-3">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Saiu</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
            −{formatBRL(Math.abs(totalDebito))}
          </p>
        </div>
        <div className="surface-card p-3">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Saldo conta</p>
          <p className={cn(
            "mt-1 text-base font-semibold tabular-nums",
            (saldoFinal ?? 0) >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400",
          )}>
            {saldoFinal !== null ? formatBRL(saldoFinal) : "—"}
          </p>
        </div>
      </div>

      {/* ── Lista ── */}
      <div className="divide-y divide-hairline rounded-lg border border-hairline">
        {visiveis.map((m) => {
          const isCredito = m.value >= 0;
          const dia = new Date(`${m.date}T12:00:00`).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          });
          const rotulo = m.payment?.description || m.payment?.customerName
            ? (m.payment.description || m.payment.customerName)
            : m.description;

          return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                isCredito
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
              )}>
                {isCredito
                  ? <ArrowDownLeft className="size-3" />
                  : <ArrowUpRight  className="size-3" />}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{rotulo}</p>
                <p className="text-2xs text-muted-foreground">
                  {TIPO_ASAAS[m.type] ?? m.type}
                </p>
              </div>

              <span className="shrink-0 text-2xs text-muted-foreground">{dia}</span>

              <span className={cn(
                "shrink-0 w-28 text-right text-sm font-semibold tabular-nums",
                isCredito
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}>
                {isCredito ? "+" : "−"}{formatBRL(m.value)}
              </span>
            </div>
          );
        })}
      </div>

      {movimentacoes.length > INICIAL && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => setExpandido((v) => !v)}
        >
          {expandido ? (
            <><ChevronUp className="size-3.5" /> Mostrar menos</>
          ) : (
            <><ChevronDown className="size-3.5" /> Ver todas {movimentacoes.length} movimentações</>
          )}
        </Button>
      )}
    </div>
  );
}
