"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Sparkline } from "./sparkline";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/format";
import type { KpiResult } from "@/lib/metrics/kpi";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* =====================================================================
   Card de KPI
   ---------------------------------------------------------------------
   Anatomia, de cima para baixo:

     eyebrow ······ rótulo em caixa alta, tracking aberto
     valor ········ 34px, tabular-nums, tracking negativo
     tendência ···· chip colorido + valor do período anterior
     ─────────────  hairline
     sparkline ···· formato dos últimos 30 dias

   Três escolhas que sustentam o resultado:

   • A COR VEM DE `sentiment`, não do sinal. O motor de KPI já resolveu
     que CPA caindo é bom; o card só pinta. Nenhuma regra de negócio
     mora aqui.

   • Sem ícone decorativo em caixa colorida no canto. É a assinatura
     mais reconhecível de dashboard gerado por IA. A hierarquia vem da
     tipografia.

   • `tabular-nums` obrigatório: com Realtime ligado o valor muda
     sozinho, e sem largura fixa de dígito o card treme a cada update.
   ===================================================================== */

interface KpiCardProps {
  kpi: KpiResult;
  /** Série do período para a sparkline (mesma unidade do valor). */
  trend?: number[];
  index?: number;
  /** Destaca o card principal do hero. */
  emphasis?: boolean;
  className?: string;
}

const sentimentStyles = {
  positive: {
    chip: "bg-positive-muted text-positive",
    spark: "var(--positive)",
  },
  negative: {
    chip: "bg-negative-muted text-negative",
    spark: "var(--negative)",
  },
  neutral: {
    chip: "bg-muted text-muted-foreground",
    spark: "var(--muted-foreground)",
  },
} as const;

export function KpiCard({
  kpi,
  trend,
  index = 0,
  emphasis = false,
  className,
}: KpiCardProps) {
  const tone = sentimentStyles[kpi.sentiment];
  const DeltaIcon =
    kpi.direction === "up"
      ? ArrowUpRight
      : kpi.direction === "down"
        ? ArrowDownRight
        : Minus;

  return (
    <article
      // Cascata via CSS (ver `.rise-in` em globals.css): o valor do KPI
      // é renderizado no servidor e precisa estar visível mesmo sem JS.
      style={{ "--rise-delay": `${index * 60}ms` } as React.CSSProperties}
      className={cn(
        "rise-in surface-card group relative flex flex-col overflow-hidden p-5 transition-shadow",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_14%,transparent)]",
        emphasis && "ring-[color-mix(in_oklab,var(--signal)_28%,transparent)]",
        className,
      )}
    >
      {/* Rótulo + dica ------------------------------------------------ */}
      <div className="flex items-start justify-between gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <h3 className="eyebrow cursor-help decoration-dotted underline-offset-4 hover:underline" />
            }
          >
            {kpi.label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-56">
            {kpi.hint}
          </TooltipContent>
        </Tooltip>

        {emphasis && (
          <span className="size-1.5 shrink-0 translate-y-1 rounded-full bg-signal" />
        )}
      </div>

      {/* Valor -------------------------------------------------------- */}
      <p
        data-slot="metric-value"
        className={cn(
          "mt-3 font-semibold leading-none tracking-[-0.025em]",
          emphasis ? "text-[2.35rem]" : "text-[1.95rem]",
        )}
      >
        {kpi.formatted}
      </p>

      {/* De onde o número saiu ---------------------------------------
          Custo por resultado e ROAS são contados só nas campanhas de
          origem — a campanha que existe para produzir aquele resultado.
          Sem esta linha o número não fecha com o investimento ao lado:
          numa conta que gastou R$550 e vendeu 22 vezes, o card mostra
          R$16,75, e quem divide na calculadora acha R$25,01 e conclui
          que o painel está errado. */}
      {kpi.origem !== null && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          de {kpi.origem} {kpi.origem === 1 ? "campanha" : "campanhas"} de
          origem
        </p>
      )}

      {/* Tendência ---------------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {kpi.deltaPercent === null ? (
          <span className="text-xs text-muted-foreground">
            Sem base de comparação
          </span>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full py-0.5 pl-1 pr-1.5 text-xs font-medium tabular-nums",
                tone.chip,
              )}
            >
              <DeltaIcon className="size-3.5" strokeWidth={2.4} />
              {formatDelta(kpi.deltaPercent)}
            </span>
            <span className="text-xs text-muted-foreground">
              vs. <span className="tabular-nums">{kpi.previousFormatted}</span>
            </span>
          </>
        )}
      </div>

      {/* Sparkline ---------------------------------------------------- */}
      {trend && trend.length > 1 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <Sparkline
            id={kpi.key}
            data={trend}
            stroke={tone.spark}
            className="h-7 w-full opacity-90 transition-opacity group-hover:opacity-100"
          />
        </div>
      )}
    </article>
  );
}

/** Placeholder com a mesma altura do card — evita salto de layout. */
export function KpiCardSkeleton() {
  return (
    <div className="surface-card flex flex-col gap-3 p-5">
      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
      <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-7 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
