import type { AdPlatform, DailyMetric, MetricKey } from "@/types/database";
import {
  formatCompact,
  formatCurrency,
  formatDecimal,
  formatMultiplier,
  formatNumber,
  formatPercent,
} from "@/lib/format";

/* =====================================================================
   Motor de KPI
   ---------------------------------------------------------------------
   Duas decisões que definem a qualidade da leitura do painel:

   1. `betterWhen` — a cor da tendência segue a INTERPRETAÇÃO do
      indicador, não o sinal do número. CPA subindo 20% é ruim e precisa
      aparecer em vermelho, mesmo sendo uma variação positiva. É o erro
      mais comum em painel de tráfego e o que mais confunde cliente.

   2. Base zero não vira infinito. Se o período anterior é 0, não existe
      variação percentual — devolvemos `null` e a UI escreve "sem base
      de comparação", em vez de estampar "+∞%".
   ===================================================================== */

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  /** Sentido em que o indicador MELHORA. */
  betterWhen: "up" | "down" | "neutral";
  format: (value: number) => string;
  /** Versão curta, para eixo de gráfico. */
  formatCompactValue?: (value: number) => string;
  hint: string;
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  spend: {
    key: "spend",
    label: "Investimento",
    // Gastar mais não é bom nem ruim isoladamente — depende do retorno.
    betterWhen: "neutral",
    format: formatCurrency,
    formatCompactValue: (v) => formatCompact(v / 100),
    hint: "Soma do valor investido em mídia paga no período.",
  },
  results: {
    key: "results",
    label: "Resultados",
    betterWhen: "up",
    format: (v) => formatNumber(Math.round(v)),
    formatCompactValue: formatCompact,
    hint: "Conversões registradas pelas plataformas (leads, compras, mensagens).",
  },
  cpa: {
    key: "cpa",
    label: "Custo por Resultado",
    betterWhen: "down", // ← o ponto crítico
    format: formatCurrency,
    formatCompactValue: (v) => formatCompact(v / 100),
    hint: "Investimento dividido pelo número de resultados.",
  },
  revenue: {
    key: "revenue",
    label: "Receita",
    betterWhen: "up",
    format: formatCurrency,
    formatCompactValue: (v) => formatCompact(v / 100),
    hint: "Valor de conversão informado pelas plataformas.",
  },
  roas: {
    key: "roas",
    label: "ROAS",
    betterWhen: "up",
    format: formatMultiplier,
    hint: "Retorno sobre o investimento em anúncios (receita ÷ investimento).",
  },
  ctr: {
    key: "ctr",
    label: "CTR",
    betterWhen: "up",
    format: (v) => formatPercent(v, 2),
    hint: "Proporção de cliques sobre impressões.",
  },
  cpc: {
    key: "cpc",
    label: "CPC",
    betterWhen: "down",
    format: formatCurrency,
    hint: "Custo médio por clique.",
  },
  cpm: {
    key: "cpm",
    label: "CPM",
    betterWhen: "down",
    format: formatCurrency,
    hint: "Custo por mil impressões.",
  },
  impressions: {
    key: "impressions",
    label: "Impressões",
    betterWhen: "up",
    format: formatNumber,
    formatCompactValue: formatCompact,
    hint: "Quantidade de vezes que os anúncios foram exibidos.",
  },
  clicks: {
    key: "clicks",
    label: "Cliques",
    betterWhen: "up",
    format: formatNumber,
    formatCompactValue: formatCompact,
    hint: "Total de cliques nos anúncios.",
  },
  leads: {
    key: "leads",
    label: "Leads",
    betterWhen: "up",
    format: (v) => formatNumber(Math.round(v)),
    hint: "Conversões classificadas como captação de contato.",
  },
  cpl: {
    key: "cpl",
    label: "Custo por Lead",
    betterWhen: "down",
    format: formatCurrency,
    hint: "Investimento dividido pelo número de leads.",
  },
  aov: {
    key: "aov",
    label: "Ticket Médio",
    betterWhen: "up",
    format: formatCurrency,
    hint: "Receita dividida pelo número de compras.",
  },
  reach: {
    key: "reach",
    label: "Alcance",
    betterWhen: "up",
    format: formatNumber,
    formatCompactValue: formatCompact,
    hint: "Estimativa de pessoas distintas atingidas.",
  },
};

/** Somatórios brutos de um período. Tudo inteiro; moeda em centavos. */
export interface MetricTotals {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
}

export const EMPTY_TOTALS: MetricTotals = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  revenueCents: 0,
};

export function sumMetrics(rows: DailyMetric[]): MetricTotals {
  return rows.reduce<MetricTotals>(
    (acc, row) => ({
      spendCents: acc.spendCents + row.spend_cents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + Number(row.conversions),
      revenueCents: acc.revenueCents + row.revenue_cents,
    }),
    { ...EMPTY_TOTALS },
  );
}

/**
 * Converte somatórios em valores de KPI.
 * Toda razão é protegida contra divisor zero — um cliente pausado no
 * período não pode derrubar a página com NaN.
 */
export function deriveMetric(key: MetricKey, t: MetricTotals): number {
  const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

  switch (key) {
    case "spend":
      return t.spendCents;
    case "results":
    case "leads":
      return t.conversions;
    case "cpa":
    case "cpl":
      return safeDiv(t.spendCents, t.conversions);
    case "revenue":
      return t.revenueCents;
    case "roas":
      return safeDiv(t.revenueCents, t.spendCents);
    case "ctr":
      return safeDiv(t.clicks, t.impressions);
    case "cpc":
      return safeDiv(t.spendCents, t.clicks);
    case "cpm":
      return safeDiv(t.spendCents, t.impressions) * 1000;
    case "impressions":
      return t.impressions;
    case "clicks":
      return t.clicks;
    case "aov":
      return safeDiv(t.revenueCents, t.conversions);
    case "reach":
      // Alcance não é somável entre dias (deduplicação é da plataforma).
      // Até integrarmos o endpoint próprio, estimamos por impressões.
      return Math.round(t.impressions * 0.62);
    default:
      return 0;
  }
}

export type Sentiment = "positive" | "negative" | "neutral";

export interface KpiResult {
  key: MetricKey;
  label: string;
  hint: string;
  value: number;
  formatted: string;
  /** Variação em pontos percentuais. `null` = período anterior zerado. */
  deltaPercent: number | null;
  direction: "up" | "down" | "flat";
  /** Já resolvido por `betterWhen` — a UI só pinta. */
  sentiment: Sentiment;
  previousValue: number;
  previousFormatted: string;
}

/** Abaixo disto, tratamos como estabilidade e não como tendência. */
const FLAT_THRESHOLD = 0.5;

export function computeKpi(
  key: MetricKey,
  current: MetricTotals,
  previous: MetricTotals,
): KpiResult {
  const def = METRIC_DEFINITIONS[key];
  const value = deriveMetric(key, current);
  const previousValue = deriveMetric(key, previous);

  const deltaPercent =
    previousValue === 0 ? null : ((value - previousValue) / previousValue) * 100;

  let direction: KpiResult["direction"] = "flat";
  if (deltaPercent !== null && Math.abs(deltaPercent) >= FLAT_THRESHOLD) {
    direction = deltaPercent > 0 ? "up" : "down";
  }

  let sentiment: Sentiment = "neutral";
  if (def.betterWhen !== "neutral" && direction !== "flat") {
    sentiment = direction === def.betterWhen ? "positive" : "negative";
  }

  return {
    key,
    label: def.label,
    hint: def.hint,
    value,
    formatted: def.format(value),
    deltaPercent,
    direction,
    sentiment,
    previousValue,
    previousFormatted: def.format(previousValue),
  };
}

/** Série diária pronta para gráfico, com moeda já convertida em reais. */
export interface TrendPoint {
  date: string;
  spend: number;
  results: number;
  revenue: number;
  cpa: number;
}

export function buildTrend(rows: DailyMetric[]): TrendPoint[] {
  const byDate = new Map<string, MetricTotals>();

  for (const row of rows) {
    const current = byDate.get(row.metric_date) ?? { ...EMPTY_TOTALS };
    byDate.set(row.metric_date, {
      spendCents: current.spendCents + row.spend_cents,
      impressions: current.impressions + row.impressions,
      clicks: current.clicks + row.clicks,
      conversions: current.conversions + Number(row.conversions),
      revenueCents: current.revenueCents + row.revenue_cents,
    });
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({
      date,
      spend: t.spendCents / 100,
      results: t.conversions,
      revenue: t.revenueCents / 100,
      cpa: t.conversions === 0 ? 0 : t.spendCents / t.conversions / 100,
    }));
}

/** Quebra por plataforma — alimenta o donut e a seção do PDF. */
export interface PlatformSplit {
  platform: AdPlatform;
  label: string;
  totals: MetricTotals;
  spendShare: number;
  cpa: number;
}

export const PLATFORM_LABELS: Record<AdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  organic: "Orgânico",
};

export function splitByPlatform(rows: DailyMetric[]): PlatformSplit[] {
  const byPlatform = new Map<AdPlatform, DailyMetric[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }

  const grandTotal = rows.reduce((acc, r) => acc + r.spend_cents, 0);

  return [...byPlatform.entries()]
    .map(([platform, list]) => {
      const totals = sumMetrics(list);
      return {
        platform,
        label: PLATFORM_LABELS[platform],
        totals,
        spendShare: grandTotal === 0 ? 0 : totals.spendCents / grandTotal,
        cpa: deriveMetric("cpa", totals),
      };
    })
    .sort((a, b) => b.totals.spendCents - a.totals.spendCents);
}

/**
 * Período anterior de MESMA DURAÇÃO, imediatamente antes do atual.
 * Comparar 30 dias com "o mês passado" (28 a 31 dias) distorce a
 * variação — usamos janelas de tamanho idêntico.
 */
export function previousPeriod(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;

  const prevEnd = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(prevStart), end: iso(prevEnd), days };
}

/** Formata um valor de KPI usando a definição do registro. */
export function formatMetric(key: MetricKey, value: number): string {
  return METRIC_DEFINITIONS[key].format(value);
}

export { formatDecimal };
