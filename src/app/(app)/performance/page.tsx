import Link from "next/link";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Sparkline } from "@/components/dashboard/sparkline";
import { getClients, getMetricsWithComparison } from "@/lib/data";
import {
  isPeriodPreset,
  periodLabel,
  resolvePeriod,
  type PeriodPreset,
} from "@/lib/date-br";
import { PerformanceToolbar } from "@/components/dashboard/performance-toolbar";
import { CLIENT_SEGMENTS, SEGMENT_LABELS } from "@/lib/validation/client";
import type { ClientSegment } from "@/types/database";
import { buildTrend, computeKpi, deriveMetric } from "@/lib/metrics/kpi";
import { formatCurrency, formatDelta, formatNumber } from "@/lib/format";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { AdsManagerSheet } from "@/components/dashboard/ads-manager-sheet";
import { defaultGoalMetricFor } from "@/lib/metrics/goal-metric";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Performance" };

/**
 * Comparação da carteira lado a lado.
 *
 * Ordenada por investimento decrescente: a conta que consome mais verba é
 * a que mais custa quando o CPA escapa, então ela abre a lista.
 */
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; period?: string; niche?: string }>;
}) {
  const { q, period, niche } = await searchParams;

  /* Entrada do usuário: preset desconhecido cai em 30 dias em vez de
     virar erro. Filtro quebrado não pode derrubar a página. */
  const preset: PeriodPreset = isPeriodPreset(period) ? period : "30d";
  const busca = (q ?? "").slice(0, 80);

  /* Só valores conhecidos chegam à query. Um `niche` arbitrário da URL
     não causaria dano — a RLS já limita o que é visível —, mas
     devolveria lista vazia com cara de carteira sem clientes. */
  const segmento = CLIENT_SEGMENTS.includes(
    niche as (typeof CLIENT_SEGMENTS)[number],
  )
    ? (niche as ClientSegment)
    : undefined;

  const { start, end } = resolvePeriod(preset);
  const clients = await getClients(undefined, {
    search: busca,
    segment: segmento,
  });

  const rows = (
    await Promise.all(
      clients.map(async (client) => {
        const metrics = await getMetricsWithComparison(client.id, start, end);
        return {
          client,
          trend: buildTrend(metrics.current),
          spend: computeKpi("spend", metrics.currentTotals, metrics.previousTotals),
          results: computeKpi("results", metrics.currentTotals, metrics.previousTotals),
          cpa: computeKpi("cpa", metrics.currentTotals, metrics.previousTotals),
          roas: deriveMetric("roas", metrics.currentTotals),
        };
      }),
    )
  ).sort((a, b) => b.spend.value - a.spend.value);

  return (
    <PageContainer>
      <PageHeader
        title="Performance"
        description={
          /* O rótulo acompanha o filtro: dizer "últimos 30 dias" com a
             tela mostrando o mês passado é pior que não dizer nada. */
          busca
            ? `${rows.length} ${rows.length === 1 ? "conta" : "contas"} para “${busca}”${segmento ? ` em ${SEGMENT_LABELS[segmento]}` : ""} · ${periodLabel(preset).toLowerCase()}`
            : segmento
              ? `${SEGMENT_LABELS[segmento]} · ${periodLabel(preset).toLowerCase()}, ordenadas por investimento.`
              : `Todas as contas · ${periodLabel(preset).toLowerCase()}, ordenadas por investimento.`
        }
      />

      <PerformanceToolbar
        query={busca}
        period={preset}
        niche={segmento ?? ""}
      />

      <div className="surface-card mt-7 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline">
              {[
                "Conta",
                "Investimento",
                "Resultados",
                "Custo por resultado",
                "ROAS",
                "Tendência",
                "",
              ].map((label, index) => (
                <th
                  key={label}
                  className={cn(
                    "eyebrow px-4 py-2.5 font-medium",
                    index === 0 ? "text-left" : "text-right",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-hairline">
            {/* Busca sem resultado é estado NORMAL, não erro. Tabela
                vazia sem explicação parece falha de carregamento. */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium">Nenhuma conta encontrada</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {busca
                      ? `Nada corresponde a “${busca}”${segmento ? ` em ${SEGMENT_LABELS[segmento]}` : ""}.`
                      : segmento
                        ? `Nenhuma conta em ${SEGMENT_LABELS[segmento]}.`
                        : "Nenhuma conta na carteira."}
                  </p>
                </td>
              </tr>
            )}

            {rows.map(({ client, trend, spend, results, cpa, roas }) => (
              <tr key={client.id} className="transition-colors hover:bg-accent/40">
                <td className="px-4 py-3">
                  <Link
                    href={`/clientes/${client.slug}`}
                    className="flex items-center gap-2.5"
                  >
                    <ClientAvatar
                      name={client.name}
                      logoUrl={client.logo_url}
                      brandPrimary={client.brand_primary}
                    />
                    <span className="font-medium">{client.name}</span>
                  </Link>
                </td>

                <td className="px-4 py-3 text-right tabular-nums">
                  {spend.formatted}
                </td>

                <td className="px-4 py-3 text-right tabular-nums">
                  {formatNumber(Math.round(results.value))}
                </td>

                <td className="px-4 py-3 text-right">
                  <span className="tabular-nums">{cpa.formatted}</span>
                  {cpa.deltaPercent !== null && (
                    <span
                      className={cn(
                        "ml-2 text-2xs font-medium tabular-nums",
                        cpa.sentiment === "positive" && "text-positive",
                        cpa.sentiment === "negative" && "text-negative",
                        cpa.sentiment === "neutral" && "text-muted-foreground",
                      )}
                    >
                      {formatDelta(cpa.deltaPercent)}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-right tabular-nums">
                  {roas > 0
                    ? `${roas.toFixed(2).replace(".", ",")}x`
                    : "—"}
                </td>

                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <Sparkline
                      id={`perf-${client.id}`}
                      data={trend.map((p) => p.spend)}
                      stroke="var(--chart-2)"
                      className="h-7 w-28"
                    />
                  </div>
                </td>

                {/* A gaveta responde "por quê" sem tirar a carteira da
                    tela — ver `AdsManagerSheet`. Fica numa coluna
                    própria, e não no nome, porque o nome já é o link
                    para a conta e dois destinos no mesmo alvo é o tipo
                    de clique que se erra. */}
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <AdsManagerSheet
                      clientId={client.id}
                      clientName={client.name}
                      clientSlug={client.slug}
                      resultLabel={
                        defaultGoalMetricFor(client.segment).label
                      }
                      costLabel={
                        defaultGoalMetricFor(client.segment).costLabel ??
                        "Custo por resultado"
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t border-hairline bg-surface-2/40">
              <td className="px-4 py-3 text-sm font-medium">Total da carteira</td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                {formatCurrency(rows.reduce((acc, r) => acc + r.spend.value, 0))}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                {formatNumber(
                  Math.round(rows.reduce((acc, r) => acc + r.results.value, 0)),
                )}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </PageContainer>
  );
}
