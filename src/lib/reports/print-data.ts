import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildTrend,
  computeKpi,
  previousPeriod,
  splitByPlatform,
  sumMetrics,
  type KpiResult,
  type PlatformSplit,
} from "@/lib/metrics/kpi";
import {
  buildPlatformDetail,
  type PlatformDetail,
} from "./platform-detail";
import type {
  AdCreative,
  Client,
  DailyMetric,
  MetricKey,
} from "@/types/database";

/* =====================================================================
   Dados da página de impressão
   ---------------------------------------------------------------------
   Usa o cliente `service_role`, que IGNORA RLS — porque quem chama é o
   Puppeteer, sem sessão. A autorização acontece ANTES, na validação do
   token HMAC: a página só chega aqui depois de provar que o pedido
   partiu do nosso próprio servidor.
   ===================================================================== */

const HERO_METRICS: MetricKey[] = ["spend", "results", "cpa"];

/**
 * Rótulos do template da conta, pelo cliente ADMIN.
 *
 * Existe porque o mesmo `conversions` é "Vendas" numa conta e
 * "Contatos" noutra, e quem define isso é `report_templates.metric_labels`.
 * Sem esta leitura, a folha revisada na tela dizia "Resultados" e o PDF
 * enviado ao cliente dizia "Vendas" — mesmos números, palavras
 * diferentes, no documento que a equipe usa justamente para conferir.
 *
 * Admin e não RLS pelo mesmo motivo do resto do arquivo: quem chama
 * pode ser o Puppeteer, sem sessão. A autorização acontece antes, na
 * página.
 */
async function rotulosDoTemplate(
  client: Client,
): Promise<Partial<Record<MetricKey, string>>> {
  if (isDemoMode) {
    const { demoTemplates } = await import("@/lib/mock/data");
    const t =
      demoTemplates.find((x) => x.segment === client.segment && x.is_default) ??
      demoTemplates.find((x) => x.segment === client.segment);
    return t?.metric_labels ?? {};
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("report_templates")
    .select("metric_labels, is_default")
    .eq("segment", client.segment)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.metric_labels ?? {}) as Partial<Record<MetricKey, string>>;
}

export interface PrintReportData {
  client: Client;
  kpis: KpiResult[];
  platforms: PlatformSplit[];
  /**
   * Uma entrada por plataforma com veiculação. Sai do MESMO
   * `buildPlatformDetail` que o PDF usa — sem isso, a folha revisada na
   * tela e o arquivo enviado ao cliente mostrariam contas diferentes.
   */
  platformDetail: PlatformDetail[];
  creatives: AdCreative[];
  /** Agregado por semana — o gráfico do resumo executivo. */
  weekly: { label: string; spend: number; results: number }[];
  totals: { spendCents: number; results: number };
  period: { start: string; end: string };
}

export async function getPrintReportData(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PrintReportData | null> {
  if (isDemoMode) {
    const { demoClients, demoMetrics, demoCreatives } = await import(
      "@/lib/mock/data"
    );
    const client = demoClients.find((c) => c.id === clientId);
    if (!client) return null;

    const inRange = (m: DailyMetric, a: string, b: string) =>
      m.client_id === clientId && m.metric_date >= a && m.metric_date <= b;

    const prev = previousPeriod(periodStart, periodEnd);

    return assemble(
      client,
      demoMetrics.filter((m) => inRange(m, periodStart, periodEnd)),
      demoMetrics.filter((m) => inRange(m, prev.start, prev.end)),
      demoCreatives
        .filter((c) => c.client_id === clientId && c.is_active)
        .sort((a, b) => b.spend_cents - a.spend_cents)
        .slice(0, 6),
      periodStart,
      periodEnd,
      await rotulosDoTemplate(client),
    );
  }

  const admin = createSupabaseAdminClient();
  const prev = previousPeriod(periodStart, periodEnd);

  const [clientRes, current, previous, creatives] = await Promise.all([
    admin.from("clients").select("*").eq("id", clientId).maybeSingle(),
    admin
      .from("daily_metrics")
      .select("*")
      .eq("client_id", clientId)
      .gte("metric_date", periodStart)
      .lte("metric_date", periodEnd),
    admin
      .from("daily_metrics")
      .select("*")
      .eq("client_id", clientId)
      .gte("metric_date", prev.start)
      .lte("metric_date", prev.end),
    admin
      .from("ad_creatives")
      .select("*")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .order("spend_cents", { ascending: false })
      .limit(6),
  ]);

  if (!clientRes.data) return null;

  const client = clientRes.data as Client;

  return assemble(
    client,
    (current.data ?? []) as DailyMetric[],
    (previous.data ?? []) as DailyMetric[],
    (creatives.data ?? []) as AdCreative[],
    periodStart,
    periodEnd,
    await rotulosDoTemplate(client),
  );
}

function assemble(
  client: Client,
  current: DailyMetric[],
  previous: DailyMetric[],
  creatives: AdCreative[],
  periodStart: string,
  periodEnd: string,
  rotulos: Partial<Record<MetricKey, string>> = {},
): PrintReportData {
  const currentTotals = sumMetrics(current);
  const previousTotals = sumMetrics(previous);

  return {
    client,
    // Mesmas funções do dashboard: é o que garante que o PDF entregue ao
    // cliente não divirja do número que o gestor vê na tela.
    kpis: HERO_METRICS.map((key) => {
      const kpi = computeKpi(key, currentTotals, previousTotals);
      const rotulo = rotulos[key];
      return rotulo ? { ...kpi, label: rotulo } : kpi;
    }),
    platforms: splitByPlatform(current),
    platformDetail: buildPlatformDetail(current, previous, rotulos),
    creatives,
    weekly: toWeekly(current),
    totals: {
      spendCents: currentTotals.spendCents,
      results: currentTotals.conversions,
    },
    period: { start: periodStart, end: periodEnd },
  };
}

/**
 * Agrupa a série diária em semanas.
 *
 * Um mês tem ~30 barras diárias; em 18cm de papel elas viram um pente
 * ilegível. Quatro ou cinco barras semanais mostram a MESMA tendência e
 * cabem com folga — é a granularidade certa para relatório impresso.
 */
function toWeekly(rows: DailyMetric[]) {
  const daily = buildTrend(rows);
  const semanas: { label: string; spend: number; results: number }[] = [];

  for (let i = 0; i < daily.length; i += 7) {
    const bloco = daily.slice(i, i + 7);
    if (bloco.length === 0) continue;

    semanas.push({
      label: `Sem ${semanas.length + 1}`,
      spend: bloco.reduce((acc, d) => acc + d.spend, 0),
      results: bloco.reduce((acc, d) => acc + d.results, 0),
    });
  }

  return semanas;
}
