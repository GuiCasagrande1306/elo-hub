import "server-only";

import {
  PLATFORM_LABELS,
  buildTrend,
  computeKpi,
  deriveMetric,
  splitByPlatform,
  type KpiResult,
  type PlatformSplit,
  type TrendPoint,
} from "@/lib/metrics/kpi";
import { sessionSource, type ReportSource } from "./source";
import {
  buildPlatformDetail,
  type PlatformDetail,
} from "./platform-detail";
import type {
  AdCreative,
  Client,
  MetricKey,
  ReportSection,
  ReportTemplate,
} from "@/types/database";

/* =====================================================================
   Payload do relatório
   ---------------------------------------------------------------------
   Tudo o que o PDF precisa, resolvido de uma vez e SERIALIZÁVEL.

   Por que congelar em vez de consultar durante a renderização:

   • As plataformas reprocessam dados. A Meta ajusta conversões por até
     28 dias. Um PDF que consultasse o banco a cada abertura mostraria
     números diferentes dos que foram apresentados ao cliente.
   • O payload inteiro é gravado em `report_history.snapshot`, então o
     relatório é auditável: dá para provar o que foi enviado e quando.
   • Renderização vira função pura de dados — testável sem banco.

   Os KPIs saem de `computeKpi`, exatamente a mesma função do dashboard.
   É isso que garante que o PDF nunca divirja da tela.
   ===================================================================== */

/* Reexportados: o documento PDF e a página A4 importam daqui. */
export type { PlatformCampaign, PlatformDetail } from "./platform-detail";

export interface ReportPayload {
  meta: {
    generatedAt: string;
    periodStart: string;
    periodEnd: string;
    /** Dias na janela — a comparação usa período anterior equivalente. */
    days: number;
    templateName: string;
    accent: string;
  };
  client: {
    id: string;
    name: string;
    segment: Client["segment"];
    brandPrimary: string | null;
    logoUrl: string | null;
    website: string | null;
  };
  kpis: KpiResult[];
  trend: TrendPoint[];
  platforms: PlatformSplit[];
  /** Uma entrada por plataforma que teve veiculação no período. */
  platformDetail: PlatformDetail[];
  creatives: ReportCreative[];
  sections: ReportSection[];
  /** Texto escrito pelo time; vazio quando ainda não preenchido. */
  insights: string;
  nextSteps: string[];
}

/** Criativo já com os derivados calculados — o PDF não faz conta. */
export interface ReportCreative {
  id: string;
  platform: AdCreative["platform"];
  platformLabel: string;
  campaignName: string | null;
  adName: string | null;
  headline: string | null;
  primaryText: string | null;
  imageUrl: string | null;
  /** false quando a origem não é raster — ver nota em `pdf/document.tsx`. */
  imageIsRaster: boolean;
  spendCents: number;
  results: number;
  cpaCents: number;
  ctr: number;
  clicks: number;
}

/**
 * O renderizador de PDF só embute imagem raster. SVG e URLs relativas
 * quebrariam a geração inteira — detectamos antes e trocamos por um
 * bloco de marca. Em produção as miniaturas vêm da Meta/Google em
 * JPEG/PNG, então este caminho é a exceção, não a regra.
 */
function isRasterImage(url: string | null): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/svg")) return false;
  if (url.startsWith("data:image/")) return true;
  if (!/^https?:\/\//.test(url)) return false;
  return !/\.svg(\?|$)/i.test(url);
}

export async function buildReportPayload(options: {
  client: Client;
  template: ReportTemplate;
  periodStart: string;
  periodEnd: string;
  insights?: string;
  nextSteps?: string[];
  /** RLS por padrão; o cron injeta a origem de sistema. */
  source?: ReportSource;
}): Promise<ReportPayload> {
  const { client, template, periodStart, periodEnd } = options;
  const source = options.source ?? sessionSource();

  // Quantos criativos a seção `ad_gallery` pediu (padrão 6).
  const gallery = template.sections.find((s) => s.type === "ad_gallery");
  const creativeLimit = Number(gallery?.options?.limit ?? 6);

  const [metrics, creatives] = await Promise.all([
    source.metrics(client.id, periodStart, periodEnd),
    source.creatives(client.id, creativeLimit),
  ]);

  /* O template define QUAIS KPIs aparecem, em que ordem e COMO SE
     CHAMAM. O rótulo é do template, não da métrica: o mesmo
     `conversions` é "Vendas", "Pedidos", "Leads" ou "Contatos"
     dependendo do negócio do cliente. */
  const rotulos = template.metric_labels ?? {};

  const kpis: KpiResult[] = (template.metrics as MetricKey[]).map((key) => {
    const kpi = computeKpi(key, metrics.currentTotals, metrics.previousTotals);
    const rotulo = rotulos[key];
    return rotulo ? { ...kpi, label: rotulo } : kpi;
  });

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      days: metrics.period.days,
      templateName: template.name,
      accent: template.theme.accent ?? "#7BF178",
    },
    client: {
      id: client.id,
      name: client.name,
      segment: client.segment,
      brandPrimary: client.brand_primary,
      logoUrl: client.logo_url,
      website: client.website,
    },
    kpis,
    trend: buildTrend(metrics.current),
    platforms: splitByPlatform(metrics.current),
    platformDetail: buildPlatformDetail(
      metrics.current,
      metrics.previous,
      rotulos,
    ),
    creatives: creatives.map((ad) => {
      const image = ad.storage_path ?? ad.thumbnail_url;
      return {
        id: ad.id,
        platform: ad.platform,
        platformLabel: PLATFORM_LABELS[ad.platform],
        campaignName: ad.campaign_name,
        adName: ad.ad_name,
        headline: ad.headline,
        primaryText: ad.primary_text,
        imageUrl: image,
        imageIsRaster: isRasterImage(image),
        spendCents: ad.spend_cents,
        results: ad.conversions,
        cpaCents: ad.conversions > 0 ? ad.spend_cents / ad.conversions : 0,
        ctr: ad.impressions > 0 ? ad.clicks / ad.impressions : 0,
        clicks: ad.clicks,
      };
    }),
    sections: template.sections,
    insights: options.insights ?? "",
    nextSteps: options.nextSteps ?? [],
  };
}

/**
 * Resumo em texto que acompanha o PDF no WhatsApp.
 *
 * Precisa fazer sentido sozinho: muita gente lê a mensagem no celular e
 * só abre o anexo depois — ou nunca. Por isso os três números que
 * definem a conta vêm no corpo da mensagem.
 */
/**
 * Legenda que acompanha o PDF quando o destino é um GRUPO.
 *
 * Tom diferente do resumo formal: grupo tem a equipe do cliente junto,
 * e a mensagem precisa fazer alguém abrir o anexo. Os três números vêm
 * no corpo porque muita gente lê no celular e nunca abre o PDF — se o
 * essencial só estiver no arquivo, não foi comunicado.
 */
export function buildGroupCaption(payload: ReportPayload): string {
  const find = (key: MetricKey) => payload.kpis.find((k) => k.key === key);

  const spend = find("spend");
  const results = find("results");
  const cpa = find("cpa");

  const linhas = [
    "Fala equipe! 🚀 Segue o relatório de performance fechado.",
    "",
    spend && results && cpa
      ? `Investimos *${spend.formatted}* e geramos *${results.formatted} resultados* a um custo de *${cpa.formatted}* cada.`
      : "Os números do período estão no PDF em anexo.",
    "",
    "Baixe o PDF para ver os anúncios que mais performaram! 📊",
  ];

  return linhas.filter((l, i) => l !== "" || i > 0).join("\n");
}

export function buildWhatsAppSummary(payload: ReportPayload): string {
  const find = (key: MetricKey) => payload.kpis.find((k) => k.key === key);

  const spend = find("spend");
  const results = find("results");
  const cpa = find("cpa");

  const trendWord = (kpi?: KpiResult) => {
    if (!kpi || kpi.deltaPercent === null) return "";
    const arrow = kpi.direction === "up" ? "▲" : kpi.direction === "down" ? "▼" : "";
    return ` ${arrow} ${Math.abs(kpi.deltaPercent).toFixed(1).replace(".", ",")}%`;
  };

  const period = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

  const lines = [
    `*${payload.client.name}* — relatório de mídia paga`,
    `Período: ${period.format(new Date(`${payload.meta.periodStart}T12:00:00`))} a ${period.format(
      new Date(`${payload.meta.periodEnd}T12:00:00`),
    )}`,
    "",
    spend ? `💰 Investimento: *${spend.formatted}*${trendWord(spend)}` : "",
    results ? `🎯 Resultados: *${results.formatted}*${trendWord(results)}` : "",
    cpa ? `📉 Custo por resultado: *${cpa.formatted}*${trendWord(cpa)}` : "",
    "",
    "O relatório completo, com a análise e os criativos que rodaram, está no PDF em anexo.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

/** Total consolidado, usado no cabeçalho da capa. */
export function payloadHeadline(payload: ReportPayload) {
  const totals = payload.platforms.reduce(
    (acc, p) => ({
      spendCents: acc.spendCents + p.totals.spendCents,
      impressions: acc.impressions + p.totals.impressions,
      clicks: acc.clicks + p.totals.clicks,
      conversions: acc.conversions + p.totals.conversions,
      revenueCents: acc.revenueCents + p.totals.revenueCents,
    }),
    {
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenueCents: 0,
    },
  );

  return {
    totals,
    roas: deriveMetric("roas", totals),
  };
}
