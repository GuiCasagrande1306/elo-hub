import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ClientDashboard } from "@/components/dashboard/ClientDashboard";
import {
  getClientBySlug,
  getClientIntegrations,
  getGoalHistory,
  getMonthlyGoalStatus,
  getCreatives,
  getCurrentGoals,
  getMetricsWithComparison,
  lastNDays,
} from "@/lib/data";
import {
  buildTrend,
  computeKpi,
  splitByPlatform,
} from "@/lib/metrics/kpi";
import {
  defaultGoalMetricFor,
} from "@/lib/metrics/goal-metric";
import type { ClientSegment, MetricKey } from "@/types/database";

/**
 * Página do cliente.
 *
 * Server Component: busca sob RLS, agrega e entrega ao componente de
 * apresentação já calculado. Nenhum número é somado no browser — assim o
 * PDF, que roda no servidor, consome exatamente as mesmas funções e não
 * há como o relatório divergir da tela.
 *
 * Next 16: `params` e `searchParams` são Promises.
 */

const PRESETS = [7, 30, 90];

/**
 * Os três KPIs do hero, na ordem de leitura de mídia paga: quanto
 * entrou → o que gerou → a que preço.
 *
 * O MEIO E O FIM MUDAM COM O NICHO. Numa loja virtual, "Resultados: 84"
 * e "Custo por Resultado: R$ 31" descrevem a conta pior do que
 * faturamento e ROAS — a receita está sincronizada em `revenue_cents`
 * desde o backfill e simplesmente não estava sendo mostrada. Onde não
 * há valor por conversão (leads, negócio local), contagem e custo
 * unitário continuam sendo a leitura certa.
 */
function heroMetricsFor(segment: ClientSegment): MetricKey[] {
  return defaultGoalMetricFor(segment).key === "revenue"
    ? ["spend", "revenue", "roas"]
    : ["spend", "results", "cpa"];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  return { title: client?.name ?? "Cliente" };
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const [{ slug }, { periodo, de, ate }] = await Promise.all([
    params,
    searchParams,
  ]);

  const client = await getClientBySlug(slug);
  if (!client) notFound();

  /* Tudo que vem da URL é entrada do usuário.

     Intervalo explícito (`?de=&ate=`) ganha do preset. Validado por
     formato E por ordem: um `de` maior que `ate` produziria um
     `time_range` vazio e um painel zerado que pareceria falta de dado.
     Fora do formato, cai no preset — nunca em erro. */
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const intervalo =
    de && ate && ISO.test(de) && ISO.test(ate) && de <= ate
      ? { start: de, end: ate }
      : null;

  const parsed = Number(periodo);
  const days = PRESETS.includes(parsed) ? parsed : 30;
  const { start, end } = intervalo ?? lastNDays(days);

  const [metrics, creatives, integrations, goals, goalStatus, goalHistory] =
    await Promise.all([
      getMetricsWithComparison(client.id, start, end),
      getCreatives(client.id, 6),
      getClientIntegrations(client.id),
      getCurrentGoals(),
      getMonthlyGoalStatus(client.id),
      getGoalHistory(client.id, 12, client.segment),
    ]);

  const metaAtual = goals.get(client.id) ?? null;

  /* O RÓTULO DOS CARDS VEM DO SEGMENTO, NUNCA DA META GRAVADA.

     Estava vindo de `goalMetricFor(segment, meta.results_metric)`, e a
     meta vencia. Como `heroMetricsFor` já escolhia QUAL número mostrar
     pelo segmento, os dois discordavam assim que o nicho mudava: uma
     conta que saiu de delivery para negócio local mostrava a CONTAGEM de
     conversas sob o título "FATURAMENTO". Número certo, nome errado —
     que é pior do que os dois errados, porque parece que funciona.

     A separação está documentada em `lib/metrics/goal-metric.ts`: rótulo
     é cosmético e acompanha o cadastro; unidade é semântica e pertence
     à meta. Aqui não há número digitado por ninguém — é o que a
     plataforma mediu —, então quem manda é o segmento. */
  const metrica = defaultGoalMetricFor(client.segment);

  const kpis = heroMetricsFor(client.segment)
    .map((key) => computeKpi(key, metrics.currentTotals, metrics.previousTotals))
    /* "Resultados" e "Custo por Resultado" são rótulos genéricos do
       catálogo de métricas. Aqui já sabemos o que a conta vende, então
       o card diz "Visitas ao perfil" e "Custo por visita" em vez de
       obrigar quem lê a lembrar de cabeça. */
    .map((kpi) =>
      kpi.key === "results" || kpi.key === "revenue"
        ? { ...kpi, label: metrica.label }
        : kpi.key === "cpa" && metrica.costLabel
          ? { ...kpi, label: metrica.costLabel }
          : kpi,
    );

  const trend = buildTrend(metrics.current);

  // Uma série por KPI, na mesma unidade do card.
  const sparklines: Record<string, number[]> = {
    spend: trend.map((p) => p.spend),
    results: trend.map((p) => p.results),
    cpa: trend.map((p) => p.cpa),
    revenue: trend.map((p) => p.revenue),
    /* ROAS do dia. Dia sem gasto vira 0 e não Infinity — a sparkline
       normaliza pelo maior valor da série, e um Infinity achataria a
       curva inteira contra o eixo. */
    roas: trend.map((p) => (p.spend === 0 ? 0 : p.revenue / p.spend)),
  };

  return (
    <ClientDashboard
      client={client}
      kpis={kpis}
      sparklines={sparklines}
      trend={trend}
      platforms={splitByPlatform(metrics.current)}
      creatives={creatives}
      period={{
        start,
        end,
        /* Dias REAIS do intervalo, não o preset: com datas escolhidas à
           mão o rótulo "30d" mentiria. */
        days: intervalo ? diasEntre(start, end) : days,
        custom: Boolean(intervalo),
      }}
      presets={PRESETS}
      integrations={integrations}
      goalStatus={goalStatus}
      goalHistory={goalHistory}
      resultLabel={metrica.label}
      costLabel={metrica.costLabel ?? "Custo por resultado"}
      goal={
        metaAtual
          ? {
              plannedBudgetCents: metaAtual.planned_budget_cents,
              plannedResults: metaAtual.planned_results,
              resultsMetric: metaAtual.results_metric,
            }
          : null
      }
    />
  );
}

/** Dias inclusivos entre duas datas YYYY-MM-DD. */
function diasEntre(inicio: string, fim: string): number {
  const ms =
    new Date(`${fim}T12:00:00Z`).getTime() -
    new Date(`${inicio}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
