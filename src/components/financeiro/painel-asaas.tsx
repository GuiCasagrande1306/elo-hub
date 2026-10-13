import { CalendarDays, TrendingUp } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type { AssinaturaResolvida } from "@/lib/asaas/assinaturas";
import { cn } from "@/lib/utils";

/* =====================================================================
   Painel de assinaturas ativas (Asaas)
   ---------------------------------------------------------------------
   Server component — não tem estado. Recebe os dados prontos da página.
   ===================================================================== */

const ROTULO_BILLING: Record<string, string> = {
  BOLETO: "Boleto",
  PIX: "PIX",
  CREDIT_CARD: "Cartão",
  DEBIT_CARD: "Débito",
  TRANSFER: "Transferência",
  DEPOSIT: "Depósito",
  UNDEFINED: "—",
};

export function PainelAsaas({
  assinaturas,
  mrr,
}: {
  assinaturas: AssinaturaResolvida[];
  mrr: number;
}) {
  if (assinaturas.length === 0) {
    return (
      <p className="surface-card p-5 text-sm text-muted-foreground">
        Nenhuma assinatura ativa encontrada no Asaas.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface-card flex items-center gap-3 p-4">
        <TrendingUp className="size-4 shrink-0 text-positive" />
        <div>
          <p className="text-sm font-semibold tabular-nums">
            {formatCurrency(mrr)}/mês
          </p>
          <p className="text-2xs text-muted-foreground">
            MRR · {assinaturas.length} assinaturas ativas
          </p>
        </div>
      </div>

      <div className="surface-card divide-y divide-hairline overflow-hidden">
        {assinaturas.map((a) => (
          <LinhaAssinatura key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function LinhaAssinatura({ a }: { a: AssinaturaResolvida }) {
  const vence = new Date(`${a.nextDueDate}T12:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diasAte = Math.ceil(
    (vence.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
  );
  const atrasado = diasAte < 0;
  const proximo = diasAte >= 0 && diasAte <= 5;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {a.customerName}
      </p>
      <div className="flex shrink-0 items-center gap-3">
        <p className="text-sm tabular-nums">{formatCurrency(a.valueCents)}</p>
        <div
          className={cn(
            "flex items-center gap-1 text-2xs",
            atrasado
              ? "text-negative"
              : proximo
                ? "text-amber-500 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3" />
          {formatarData(a.nextDueDate)}
        </div>
        <span className="text-2xs text-muted-foreground">
          {ROTULO_BILLING[a.billingType] ?? a.billingType}
        </span>
      </div>
    </div>
  );
}

function formatarData(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
