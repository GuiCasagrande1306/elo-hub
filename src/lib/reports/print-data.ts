import "server-only";

import { tiposDeConversaoDoCliente } from "@/lib/ads/conversao-do-cliente";
import { isDemoMode } from "@/lib/env";
import {
  metricasDeCriativosNoPeriodo,
  type MetricasDeCriativo,
} from "./creative-insights";
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
  /** Se os números da galeria foram apurados para o período. */
  creativesDoPeriodo: boolean;
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

    return {
      ...assemble(
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
        await tiposDeConversaoDoCliente(clientId),
      ),
      /* A demonstração não chama a Graph API — os números vêm da
         fixture, que não tem janela. Marcar como "não apurado" faz a
         tela exibir a mesma ressalva que a produção exibiria, o que é o
         ponto de ter modo demo. */
      creativesDoPeriodo: false,
    };
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
      /* Sem `limit(6)` aqui: o corte passou a acontecer depois de
         aplicar as métricas do período, senão os seis escolhidos seriam
         os que mais gastaram em OUTRA janela. Mesmo motivo de
         `payload.ts` — as duas superfícies têm de concordar, e foi para
         isso que `platform-detail` e `resolverTemplate` existem. */
      .order("spend_cents", { ascending: false })
      .limit(48),
  ]);

  if (!clientRes.data) return null;

  const client = clientRes.data as Client;

  /* MESMA apuração do PDF. Sem isto a folha A4 — que é a fonte do motor
     Puppeteer — mostraria os números da última sincronização enquanto o
     react-pdf mostraria os do período: dois documentos, duas verdades,
     para o mesmo cliente e o mesmo mês. */
  const metricasDoPeriodo = await metricasDeCriativosNoPeriodo(
    clientId,
    periodStart,
    periodEnd,
  );

  const criativos = aplicarMetricas(
    (creatives.data ?? []) as AdCreative[],
    metricasDoPeriodo,
    6,
  );

  return {
    ...assemble(
      client,
      (current.data ?? []) as DailyMetric[],
      (previous.data ?? []) as DailyMetric[],
      criativos,
      periodStart,
      periodEnd,
      await rotulosDoTemplate(client),
      await tiposDeConversaoDoCliente(clientId),
    ),
    creativesDoPeriodo: metricasDoPeriodo !== null,
  };
}

/**
 * Aplica as métricas do período aos criativos e reordena.
 *
 * UMA função para as duas superfícies. O PDF (`payload.ts`) e a folha
 * A4 faziam o corte em seis no banco, ordenados por `spend_cents` — a
 * coluna com o gasto da ÚLTIMA sincronização. Números de uma janela em
 * cards escolhidos por outra.
 *
 * `null` = não deu para apurar: mantém o que veio do banco, sem zerar.
 */
/**
 * Criativo com o que a Graph API sabe e a tabela não guarda.
 *
 * `ad_creatives` é uma foto do último sync e não tem coluna para
 * objetivo, visita ao perfil ou receita do anúncio. Esses quatro campos
 * existem só na resposta do Insights da janela pedida, então viajam ao
 * lado da linha do banco em vez de dentro dela.
 *
 * `null`/zero quando a apuração não aconteceu — o card cai na vitrine
 * genérica, que é o comportamento de sempre.
 */
export type CriativoApurado = AdCreative & {
  objective: string | null;
  optimizationGoal: string | null;
  profileVisits: number;
  revenueCents: number;
};

export function aplicarMetricas(
  criativos: AdCreative[],
  metricas: Map<string, MetricasDeCriativo> | null,
  limite: number,
): CriativoApurado[] {
  const semApuracao = (ad: AdCreative): CriativoApurado => ({
    ...ad,
    objective: null,
    optimizationGoal: null,
    profileVisits: 0,
    revenueCents: 0,
  });

  if (!metricas) return criativos.slice(0, limite).map(semApuracao);

  return [...criativos]
    .map((ad) => {
      const m = metricas.get(ad.external_ad_id);
      /* Sem linha nos insights = não veiculou na janela. Zero aqui é
         verdade, porque o mapa veio preenchido. */
      return {
        ...semApuracao(ad),
        spend_cents: m?.spendCents ?? 0,
        conversions: m?.conversions ?? 0,
        impressions: m?.impressions ?? 0,
        clicks: m?.clicks ?? 0,
        objective: m?.objective ?? null,
        optimizationGoal: m?.optimizationGoal ?? null,
        profileVisits: m?.profileVisits ?? 0,
        revenueCents: m?.revenueCents ?? 0,
      };
    })
    .sort((a, b) => b.spend_cents - a.spend_cents)
    .slice(0, limite);
}

function assemble(
  client: Client,
  current: DailyMetric[],
  previous: DailyMetric[],
  creatives: AdCreative[],
  periodStart: string,
  periodEnd: string,
  rotulos: Partial<Record<MetricKey, string>> = {},
  tiposDeConversao: string[] = [],
): Omit<PrintReportData, "creativesDoPeriodo"> {
  const currentTotals = sumMetrics(current, tiposDeConversao);
  const previousTotals = sumMetrics(previous, tiposDeConversao);

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
