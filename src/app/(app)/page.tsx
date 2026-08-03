import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Sparkline } from "@/components/dashboard/sparkline";
import { TaskDigest } from "@/components/tasks/task-digest";
import {
  getClients,
  getMetricsWithComparison,
  getTasks,
  lastNDays,
} from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildTrend, computeKpi, deriveMetric, sumMetrics } from "@/lib/metrics/kpi";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { MetricKey } from "@/types/database";

/**
 * Visão geral da agência.
 *
 * Consolida o portfólio inteiro que o usuário pode ver. Para um admin,
 * é toda a carteira; para um colaborador, apenas as contas atribuídas —
 * a soma sai naturalmente diferente porque a origem já vem filtrada pelo
 * RLS, sem nenhum `if (role === ...)` nesta página.
 */

const HERO_METRICS: MetricKey[] = ["spend", "results", "cpa"];

export default async function OverviewPage() {
  const [user, clients] = await Promise.all([getCurrentUser(), getClients()]);
  const { start, end } = lastNDays(30);

  // Uma consulta por cliente, em paralelo. Com carteira grande isto
  // vira uma única RPC agregada no Postgres — ver nota no README.
  const perClient = await Promise.all(
    clients.map(async (client) => {
      const metrics = await getMetricsWithComparison(client.id, start, end);
      return { client, metrics, trend: buildTrend(metrics.current) };
    }),
  );

  const portfolioCurrent = sumMetrics(perClient.flatMap((c) => c.metrics.current));
  const portfolioPrevious = sumMetrics(
    perClient.flatMap((c) => c.metrics.previous),
  );

  const kpis = HERO_METRICS.map((key) =>
    computeKpi(key, portfolioCurrent, portfolioPrevious),
  );

  const allTrend = buildTrend(perClient.flatMap((c) => c.metrics.current));
  const sparklines: Record<string, number[]> = {
    spend: allTrend.map((p) => p.spend),
    results: allTrend.map((p) => p.results),
    cpa: allTrend.map((p) => p.cpa),
  };

  const tasks = await getTasks();

  return (
    <PageContainer>
      <PageHeader
        title={`Olá, ${user?.full_name.split(" ")[0] ?? "time"}`}
        description={`Consolidado dos últimos 30 dias em ${clients.length} ${
          clients.length === 1 ? "conta" : "contas"
        }.`}
      />

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        {kpis.map((kpi, index) => (
          <KpiCard
            key={kpi.key}
            kpi={kpi}
            index={index}
            trend={sparklines[kpi.key]}
            emphasis={index === 0}
          />
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-lg font-semibold tracking-[-0.015em]">Contas</h2>
            <Link
              href="/clientes"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ver todas
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {perClient.map(({ client, metrics, trend }) => {
              const spend = metrics.currentTotals.spendCents;
              const results = deriveMetric("results", metrics.currentTotals);
              const cpaKpi = computeKpi(
                "cpa",
                metrics.currentTotals,
                metrics.previousTotals,
              );

              return (
                <Link
                  key={client.id}
                  href={`/clientes/${client.slug}`}
                  className="surface-card group flex flex-col p-4 transition-shadow hover:ring-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-6 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: client.brand_primary ?? "#8a8a8a" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {client.name}
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="eyebrow">Investido</p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-[-0.02em]">
                        {formatCurrency(spend)}
                      </p>
                    </div>
                    <Sparkline
                      id={`ov-${client.id}`}
                      data={trend.map((p) => p.spend)}
                      stroke="var(--chart-2)"
                      className="h-8 w-24 shrink-0"
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatNumber(Math.round(results))} resultados
                    </span>
                    <span aria-hidden>•</span>
                    <span className="tabular-nums">
                      CPA {cpaKpi.formatted}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <TaskDigest tasks={tasks} currentUserId={user?.id ?? ""} />
      </div>
    </PageContainer>
  );
}
