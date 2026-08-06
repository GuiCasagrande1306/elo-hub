"use client";

import Link from "next/link";
import { ArrowUpRight, Pencil, Target } from "lucide-react";

import { GoalBar } from "./goal-bar";
import { Sparkline } from "@/components/dashboard/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GOAL_TONE_CLASSES,
  buildGoalProgress,
} from "@/lib/metrics/goals";
import {
  formatGoalValue,
  type GoalMetric,
} from "@/lib/metrics/goal-metric";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import type { Client } from "@/types/database";

/* =====================================================================
   ClientCard
   ---------------------------------------------------------------------
   Estrutura em três faixas, separadas por hairline:

     CABEÇALHO  marca + nome + status + dias restantes
     METAS      duas barras com semântica oposta e marcador de ritmo
     RODAPÉ     ações

   Sobre a profundidade: o pedido era `shadow-sm hover:shadow-md`. Está
   aplicado, mas combinado com o ring de 1px do design system — no tema
   escuro a sombra praticamente desaparece, e sem o ring o card perderia
   a borda. A sombra carrega o modo claro; o ring carrega os dois.
   ===================================================================== */

export interface ClientCardProps {
  client: Client;
  /**
   * Progresso já resolvido — calculado no servidor na primeira carga e
   * recalculado no cliente só quando o Realtime traz uma meta nova.
   * Recalcular aqui na renderização inicial causaria divergência de
   * hidratação, porque o cálculo depende de "hoje".
   */
  progress: GoalProgressPair | null;
  /** Fallback quando não há meta: mostra o que já foi executado. */
  computedSpendCents: number;
  /** Executado já na unidade de `metric` — resolvido no servidor. */
  computedGoalValue: number;
  /** O que conta como resultado nesta conta. */
  metric: GoalMetric;
  trend: number[];
  index?: number;
}

export type GoalProgressPair = NonNullable<
  ReturnType<typeof buildGoalProgress>
>;

const STATUS_VARIANT: Record<
  Client["status"],
  { label: string; className: string }
> = {
  active: { label: "Ativo", className: "bg-positive-muted text-positive" },
  onboarding: { label: "Onboarding", className: "bg-warning-muted text-warning" },
  paused: { label: "Pausado", className: "bg-muted text-muted-foreground" },
  lead: { label: "Lead", className: "bg-muted text-muted-foreground" },
  churned: { label: "Encerrado", className: "bg-negative-muted text-negative" },
};

const SEGMENT_LABELS: Record<Client["segment"], string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

export function ClientCard({
  client,
  progress,
  computedSpendCents,
  computedGoalValue,
  metric,
  trend,
  index = 0,
}: ClientCardProps) {
  const status = STATUS_VARIANT[client.status];

  // Dias restantes vêm do ciclo já calculado no servidor, não de um
  // novo `new Date()` — mesma razão do progresso.
  const daysLeft = progress?.cycle.daysLeft ?? null;

  // O tom do card inteiro segue o pior dos dois indicadores: se o
  // orçamento estourou, a conta precisa de atenção mesmo que os
  // resultados estejam ótimos.
  const worstTone = progress
    ? ([progress.budget.tone, progress.results.tone].includes("negative")
        ? "negative"
        : [progress.budget.tone, progress.results.tone].includes("warning")
          ? "warning"
          : "positive")
    : "neutral";

  return (
    <article
      style={{ "--rise-delay": `${index * 55}ms` } as React.CSSProperties}
      className={cn(
        "rise-in group flex flex-col rounded-xl bg-card ring-1 ring-hairline",
        "shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
      )}
    >
      {/* ------------------------------ CABEÇALHO ------------------ */}
      <header className="flex items-start gap-3 p-4">
        <ClientMark client={client} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-tight">
              {client.name}
            </h3>
            <Badge
              className={cn("shrink-0 border-transparent", status.className)}
            >
              {status.label}
            </Badge>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
            <span>{SEGMENT_LABELS[client.segment]}</span>
            {daysLeft !== null && (
              <>
                <span aria-hidden>·</span>
                <span className={cn(daysLeft <= 3 && "font-medium text-warning")}>
                  {daysLeft === 0
                    ? "último dia do ciclo"
                    : `${daysLeft} ${daysLeft === 1 ? "dia" : "dias"} no ciclo`}
                </span>
              </>
            )}
          </p>
        </div>
      </header>

      {/* ------------------------------ METAS ---------------------- */}
      <div className="flex-1 border-t border-hairline p-4">
        {progress ? (
          <div className="flex flex-col gap-4">
            <GoalBar progress={progress.budget} />
            <GoalBar progress={progress.results} />
          </div>
        ) : (
          <NoGoalState
            spendCents={computedSpendCents}
            value={computedGoalValue}
            metric={metric}
            slug={client.slug}
          />
        )}
      </div>

      {/* Tendência + resumo do ciclo ------------------------------- */}
      {progress && trend.length > 1 && (
        <div className="flex items-center gap-3 border-t border-hairline px-4 py-2.5">
          <Sparkline
            id={`card-${client.id}`}
            data={trend}
            stroke={
              worstTone === "negative"
                ? "var(--negative)"
                : worstTone === "warning"
                  ? "var(--warning)"
                  : "var(--positive)"
            }
            className="h-6 flex-1"
          />
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              GOAL_TONE_CLASSES[worstTone].chip,
            )}
          >
            {/* O rótulo sai do próprio indicador: "Gasto acelerado" e
                "Adiantado" nascem do mesmo status e querem dizer coisas
                opostas. */}
            {(worstTone === "negative" && progress.budget.tone === "negative"
              ? progress.budget
              : progress.results
            ).statusLabel}
          </span>
        </div>
      )}

      {/* ------------------------------ RODAPÉ --------------------- */}
      <footer className="flex gap-2 border-t border-hairline p-3">
        <Button
          size="sm"
          className="h-8 flex-1"
          nativeButton={false}
          render={<Link href={`/clientes/${client.slug}`} />}
        >
          Ver dashboard
          <ArrowUpRight className="size-3.5" />
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8"
          nativeButton={false}
          render={<Link href={`/clientes/${client.slug}#ajustes`} />}
        >
          <Pencil className="size-3.5" />
          <span className="sr-only sm:not-sr-only">Editar infos</span>
        </Button>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Estado sem meta                                                     */
/* ------------------------------------------------------------------ */

/**
 * Conta sem meta definida não pode virar um buraco cinza no grid — é
 * justamente onde o gestor precisa AGIR. Mostramos o que já foi
 * executado no mês e um chamado direto para definir a meta.
 */
function NoGoalState({
  spendCents,
  value,
  metric,
  slug,
}: {
  spendCents: number;
  value: number;
  metric: GoalMetric;
  slug: string;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="eyebrow">Investido no mês</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatCurrency(spendCents)}
          </dd>
        </div>
        <div>
          {/* Sem meta o número já precisa se identificar: "1.240" sob o
              rótulo genérico "Resultados" numa loja virtual se lê como
              1.240 vendas, quando são R$ 12,40 de faturamento. */}
          <dt className="eyebrow">{metric.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatGoalValue(metric, value)}
          </dd>
        </div>
      </dl>

      <Link
        href={`/clientes/${slug}#metas`}
        className="flex items-center gap-2 rounded-lg border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-signal hover:text-foreground"
      >
        <Target className="size-3.5 shrink-0" />
        Definir meta do período
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ClientMark({ client }: { client: Client }) {
  const letters = client.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  /* Com logo, a marca do cliente manda. Sem, cai no monograma sobre a
     cor da marca — que é o que existia antes e continua sendo o estado
     normal enquanto ninguém subiu arquivo.

     `object-contain` sobre fundo branco: logo de cliente costuma vir
     com margem própria e fundo transparente, e `cover` cortaria o
     símbolo. Branco porque a maioria é desenhada para papel. */
  if (client.logo_url) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável; next/image exigiria allowlist de domínio. */}
        <img
          src={client.logo_url}
          alt={client.name}
          className="size-full object-contain p-1"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
      style={{
        background: client.brand_primary
          ? `linear-gradient(140deg, ${client.brand_primary}, color-mix(in oklab, ${client.brand_primary} 66%, black))`
          : "var(--surface-2)",
      }}
    >
      {letters}
    </span>
  );
}

