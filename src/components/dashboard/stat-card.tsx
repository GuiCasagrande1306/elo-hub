import { Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Cartão de número no topo do painel.
 *
 * Compartilhado pelos dois perfis: o admin conta a agência, o
 * colaborador conta a própria carteira, mas a leitura é a mesma e duas
 * cópias divergiriam no primeiro ajuste de espaçamento.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutro",
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
  tone?: "neutro" | "alerta";
}) {
  return (
    <div
      className={cn(
        "surface-card flex items-start gap-3 p-4",
        tone === "alerta" && "ring-warning/35",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone === "alerta"
            ? "bg-warning-muted text-warning"
            : "bg-surface-2 text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none tracking-[-0.02em]">
          {value}
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
