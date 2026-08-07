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
  /* Aceita string além de número: os cartões de dinheiro chegam já
     formatados em R$, e o de ritmo é uma frase ("8 no ritmo · 3
     abaixo"). Formatar aqui dentro obrigaria o componente a saber se o
     número é moeda, contagem ou percentual. */
  value: number | string;
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
        {/* Frase longa não cabe em text-2xl — "8 no ritmo · 3 abaixo"
            quebraria em duas linhas e desalinharia o card do vizinho.
            O corte em 12 caracteres separa número de sentença. */}
        <p
          className={cn(
            "mt-0.5 font-semibold tabular-nums leading-none tracking-[-0.02em]",
            String(value).length > 12 ? "text-base" : "text-2xl",
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
