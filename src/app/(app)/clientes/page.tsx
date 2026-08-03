import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Sparkline } from "@/components/dashboard/sparkline";
import { Button } from "@/components/ui/button";
import {
  getClients,
  getMetricsWithComparison,
  lastNDays,
} from "@/lib/data";
import { buildTrend, computeKpi, deriveMetric } from "@/lib/metrics/kpi";
import { formatCurrency, formatDelta, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

export const metadata: Metadata = { title: "Clientes" };

const SEGMENT_LABELS: Record<Client["segment"], string> = {
  ecommerce: "E-commerce",
  local_business: "Negócio local",
  launch: "Lançamento",
  saas: "SaaS",
  infoproduct: "Infoproduto",
  b2b_services: "Serviços B2B",
  other: "Outro",
};

export default async function ClientsPage() {
  const clients = await getClients();
  const { start, end } = lastNDays(30);

  const rows = await Promise.all(
    clients.map(async (client) => {
      const metrics = await getMetricsWithComparison(client.id, start, end);
      return {
        client,
        trend: buildTrend(metrics.current),
        spend: metrics.currentTotals.spendCents,
        results: deriveMetric("results", metrics.currentTotals),
        cpa: computeKpi("cpa", metrics.currentTotals, metrics.previousTotals),
      };
    }),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        description="Carteira ativa e desempenho dos últimos 30 dias."
        actions={
          <Button size="sm" className="h-9">
            Novo cliente
          </Button>
        }
      />

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ client, trend, spend, results, cpa }) => (
          <Link
            key={client.id}
            href={`/clientes/${client.slug}`}
            className="surface-card group flex flex-col p-5 transition-shadow hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
                style={{
                  background: client.brand_primary
                    ? `linear-gradient(140deg, ${client.brand_primary}, color-mix(in oklab, ${client.brand_primary} 68%, black))`
                    : "var(--surface-2)",
                }}
              >
                {client.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()}
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">{client.name}</h2>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {SEGMENT_LABELS[client.segment]}
                </p>
              </div>

              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
            </div>

            <div className="mt-5 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Investido · 30d</p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em]">
                  {formatCurrency(spend)}
                </p>
              </div>
              <Sparkline
                id={`cl-${client.id}`}
                data={trend.map((p) => p.spend)}
                stroke="var(--chart-2)"
                className="h-9 w-28 shrink-0"
              />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
              <div>
                <dt className="eyebrow">Resultados</dt>
                <dd className="mt-0.5 text-sm font-medium tabular-nums">
                  {formatNumber(Math.round(results))}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Custo por resultado</dt>
                <dd className="mt-0.5 flex items-baseline gap-1.5 text-sm font-medium tabular-nums">
                  {cpa.formatted}
                  {cpa.deltaPercent !== null && (
                    <span
                      className={cn(
                        "text-2xs font-medium",
                        cpa.sentiment === "positive" && "text-positive",
                        cpa.sentiment === "negative" && "text-negative",
                        cpa.sentiment === "neutral" && "text-muted-foreground",
                      )}
                    >
                      {formatDelta(cpa.deltaPercent)}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
