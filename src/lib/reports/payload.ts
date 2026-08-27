import "server-only";

import {
  PLATFORM_LABELS,
  buildTrend,
  computeKpi,
  deriveMetric,
  splitByPlatform,
  EMPTY_TOTALS,
  type KpiResult,
  type MetricTotals,
  type PlatformSplit,
  type TrendPoint,
} from "@/lib/metrics/kpi";
import { sessionSource, type ReportSource } from "./source";
import { metricasDeCriativosNoPeriodo } from "./creative-insights";
import { aplicarMetricas } from "./print-data";
import {
  objetivoDoCriativo,
  vitrineDoCriativo,
  type VitrineDoCriativo,
} from "@/lib/ads/creative-goal";
import { isDemoMode } from "@/lib/env";
import { formatPeriod } from "@/lib/format";
import { mensagemDoCliente } from "./mensagem-do-cliente";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
export {
  objetivoDoCriativo,
  vitrineDoCriativo,
  type VitrineDoCriativo,
} from "@/lib/ads/creative-goal";

/**
 * Acento quando ninguém definiu cor: um grafite frio, não uma cor de
 * marca. Serve de fundo para texto branco e não compete com a cor do
 * cliente na capa.
 */
const ACENTO_NEUTRO = "#4A5568";

export interface ReportPayload {
  meta: {
    generatedAt: string;
    periodStart: string;
    periodEnd: string;
    /** Dias na janela — a comparação usa período anterior equivalente. */
    days: number;
    templateName: string;
    /**
     * Cor do acento do documento.
     *
     * PRECEDÊNCIA: `template.theme.accent` vence, se o template fixar
     * uma; senão vem da agência que assina; e sem ela, um cinza neutro.
     * Antes era o verde da Elo por padrão — a marca de uma agência
     * aparecia no relatório de todas as outras.
     */
    accent: string;
  };
  /**
   * Quem ASSINA o relatório: a agência que atende esta conta.
   *
   * Vem de `clients.agency_partner` cruzado com `agency_contracts`. O
   * pipeline não lia esse campo — o documento tinha "Elo Marketing"
   * escrito no código, e o relatório de conta terceirizada saía com a
   * marca de outra empresa.
   *
   * `null` quando a conta não aponta para agência nenhuma: aí o
   * documento sai sem assinatura, que é melhor que assinar errado.
   */
  agency: {
    name: string;
    brandPrimary: string | null;
    /** Raster (png/jpg). SVG aborta o react-pdf — ver a migration 38. */
    logoUrl: string | null;
  } | null;
  client: {
    id: string;
    name: string;
    segment: Client["segment"];
    brandPrimary: string | null;
    logoUrl: string | null;
    website: string | null;
  };
  /**
   * Se os números da galeria foram apurados PARA O PERÍODO do relatório.
   *
   * `false` quando a consulta à Meta não pôde ser feita: os valores
   * então vêm da última sincronização, e o documento precisa dizer isso.
   * Sem essa marca, número de outra janela sai sob o cabeçalho do
   * período como se fosse dele.
   */
  creativesDoPeriodo: boolean;
  kpis: KpiResult[];
  /**
   * A métrica que abre a capa em tamanho grande.
   *
   * É a resposta que o cliente procura primeiro e muda com o negócio:
   * faturamento na loja e no delivery, visitas ao perfil no negócio
   * local, leads na captação. Sai de `report_templates.highlight_metric`,
   * então a agência troca pela tela, sem deploy.
   *
   * `null` quando o template não define destaque — a capa volta a ser só
   * a fileira de três, como sempre foi.
   */
  highlight: KpiResult | null;
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
  /**
   * A VITRINE do card, decidida pelo que a campanha compra.
   *
   * Um card só de "Resultados / Custo por resultado" não diz a mesma
   * coisa em campanha de venda e em campanha de perfil: na primeira o
   * que importa é quanto voltou, na segunda quantas pessoas chegaram ao
   * perfil e a que custo. `vitrine` é resolvida no servidor porque a
   * regra depende de `optimization_goal`, que só existe aqui.
   */
  vitrine: VitrineDoCriativo;
  /**
   * O objetivo da campanha, em português: "Vendas", "Alcance"…
   *
   * `null` quando a combinação de objetivo e meta não é reconhecida —
   * melhor o selo sumir do que imprimir `OUTCOME_AWARENESS` no
   * documento que vai para o cliente.
   */
  objetivo: string | null;
  /** Visitas ao perfil no período — só preenchido quando apurado. */
  profileVisits: number;
  /** Receita atribuída ao anúncio, dos mesmos eventos que contam. */
  revenueCents: number;
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

  /* PEDE MAIS DO QUE VAI MOSTRAR, de propósito. O corte em 6 acontecia
     no banco, ordenado por `spend_cents` — a coluna que guarda o gasto
     da ÚLTIMA sincronização, não o do período do relatório. Com isso a
     galeria mostrava "os 6 que mais gastaram" segundo outra janela: os
     números errados vinham em cards errados. Buscando um conjunto maior
     dá para reordenar aqui, depois de aplicar as métricas certas. */
  const [metrics, candidatos, metricasDoPeriodo] = await Promise.all([
    source.metrics(client.id, periodStart, periodEnd),
    source.creatives(client.id, Math.max(creativeLimit * 8, 48)),
    metricasDeCriativosNoPeriodo(client.id, periodStart, periodEnd),
  ]);

  /* `null` = não deu para apurar (conta sem Meta, token vencido, rede).
     Nesse caso NÃO zeramos nada: ficam os números do banco, e o
     documento diz de que janela eles são. Zerar seria reproduzir o
     defeito que este caminho conserta. */
  /* MESMA função que a folha A4 usa. Duas cópias da regra divergiriam
     no primeiro ajuste, e o cliente receberia um PDF discordando da
     folha que a equipe revisou — foi para evitar isso que
     `platform-detail` e `resolverTemplate` já existem. */
  const creatives = aplicarMetricas(candidatos, metricasDoPeriodo, creativeLimit);

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

  /* O destaque é UM DOS `kpis`, não um cálculo à parte: o número da capa
     e o da grade têm que ser o mesmo objeto, senão um dia divergem —
     mesma razão de `platform-detail` reusar `deriveMetric` em vez de
     refazer as contas. O banco garante que a chave está em `metrics`
     (check da migration 45); o `?? null` cobre template antigo. */
  const highlight =
    kpis.find((k) => k.key === template.highlight_metric) ?? null;

  const agency = await resolverAgencia(client.agency_partner);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      days: metrics.period.days,
      templateName: template.name,
      /* Neutro no fim da fila, nunca a cor de uma agência específica. */
      accent: template.theme.accent ?? agency?.brandPrimary ?? ACENTO_NEUTRO,
    },
    agency,
    client: {
      id: client.id,
      name: client.name,
      segment: client.segment,
      brandPrimary: client.brand_primary,
      logoUrl: client.logo_url,
      website: client.website,
    },
    creativesDoPeriodo: metricasDoPeriodo !== null,
    kpis,
    highlight,
    /* Os tipos de conversão passam nos TRÊS: o gráfico diário, a divisão
       por canal e o quadro por plataforma. Antes só a grade de KPIs os
       recebia, e o PDF da Satö saía com ROAS 12,35x na página 2 e 8,11x
       na 3 — o mesmo número, duas respostas, no arquivo do cliente. */
    trend: buildTrend(metrics.current, metrics.tiposDeConversao),
    platforms: splitByPlatform(metrics.current, metrics.tiposDeConversao),
    platformDetail: buildPlatformDetail(
      metrics.current,
      metrics.previous,
      rotulos,
      metrics.tiposDeConversao,
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
        vitrine: vitrineDoCriativo(ad.optimizationGoal, ad.objective),
        /* "Vendas", "Visitas ao perfil"… `null` quando não dá para
           afirmar. O card mostra o selo só quando existe — ver
           `objetivoDoCriativo`. */
        objetivo: objetivoDoCriativo(ad.optimizationGoal, ad.objective),
        profileVisits: ad.profileVisits,
        revenueCents: ad.revenueCents,
      };
    }),
    sections: template.sections,
    insights: options.insights ?? "",
    nextSteps: options.nextSteps ?? [],
  };
}


/**
 * A legenda que vai junto do PDF no WhatsApp.
 *
 * É A MESMA MENSAGEM QUE A TELA MOSTRA em "Texto para o cliente" — as
 * duas chamam `mensagemDoCliente`, e é isso que impede a equipe de
 * conferir um texto e o cliente receber outro.
 *
 * SÓ O PERÍODO ENTRA. A legenda deixou de repetir os números do
 * relatório em 27/08/2026, depois que oito contas passaram a mandar
 * mensagem e anexo com ROAS diferentes — ver o cabeçalho de
 * `mensagem-do-cliente.ts`.
 *
 * SEM RAMO PARA SNAPSHOT ANTIGO, e ele podia sumir: o que restou vem de
 * `meta`, que todo payload gravado sempre teve. O caminho que remontava
 * a mensagem a partir dos KPIs existia só para os números, e não há
 * mais números.
 */
export function buildGroupCaption(
  payload: ReportPayload,
  /**
   * O texto gravado em `report_message_settings`.
   *
   * Buscado NA HORA DO ENVIO, não congelado no snapshot: um relatório
   * que o cron preparou às 6h20 e alguém despacha às 15h sai com a
   * mensagem vigente às 15h. Se o texto mudou no meio, foi porque
   * alguém quis — e a versão nova é a que a agência quer dizer.
   *
   * Sem valor, cai no de fábrica. É o que mantém o caminho de teste e
   * a prévia funcionando sem ida ao banco.
   */
  template?: string,
): string {
  return mensagemDoCliente(
    {
      periodoLabel: formatPeriod(
        payload.meta.periodStart,
        payload.meta.periodEnd,
      ),
      dias: payload.meta.days,
      cliente: payload.client.name,
    },
    template,
  );
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

  /* Razão sem denominador vira FRASE, não traço. "*—*" no meio de uma
     mensagem de WhatsApp lê como falha do sistema, e some justamente a
     informação que importa: não houve conversão no período. Antes daqui
     saía "*R$ 0,00* ▼ 100,0%", que era pior — dizia o contrário do que
     aconteceu. */
  const linhaCpa = !cpa
    ? ""
    : cpa.indefinido
      ? "📉 Custo por resultado: *sem conversões no período*"
      : `📉 Custo por resultado: *${cpa.formatted}*${trendWord(cpa)}`;

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
    linhaCpa,
    "",
    "O relatório completo, com a análise e os criativos que rodaram, está no PDF em anexo.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}

/** Total consolidado, usado no cabeçalho da capa. */
export function payloadHeadline(payload: ReportPayload) {
  const totals = payload.platforms.reduce<MetricTotals>(
    (acc, p) => ({
      spendCents: acc.spendCents + p.totals.spendCents,
      impressions: acc.impressions + p.totals.impressions,
      clicks: acc.clicks + p.totals.clicks,
      conversions: acc.conversions + p.totals.conversions,
      revenueCents: acc.revenueCents + p.totals.revenueCents,
      /* A origem soma junto, plataforma a plataforma. Somar só os totais
         e deixar a origem zerada faria o ROAS da capa — que sai da
         origem — imprimir "—" numa conta que tem ROAS. */
      origem: {
        spendCents: acc.origem.spendCents + p.totals.origem.spendCents,
        conversions: acc.origem.conversions + p.totals.origem.conversions,
        revenueCents: acc.origem.revenueCents + p.totals.origem.revenueCents,
        campanhas: acc.origem.campanhas + p.totals.origem.campanhas,
        /* Basta UMA plataforma isolar para o número da capa já não ser
           a conta inteira, e o selo precisa dizer isso. */
        isolado: acc.origem.isolado || p.totals.origem.isolado,
      },
    }),
    EMPTY_TOTALS,
  );

  return {
    totals,
    roas: deriveMetric("roas", totals),
  };
}


/**
 * Identidade da agência que assina o relatório desta conta.
 *
 * Uma consulta por relatório, e não um join no carregamento do cliente:
 * o payload é montado uma vez por documento, e `agency_contracts` tem
 * uma linha por agência — são unidades, não milhares.
 *
 * FALHA PARA O LADO DE EMITIR. Sem linha, sem permissão de leitura ou
 * com erro de rede, devolve o NOME em texto e nenhuma identidade visual:
 * o relatório sai assinado, sem cor nem logo. Um documento sem enfeite é
 * melhor que um documento que não existe — e a leitura é feita com a
 * chave anon sob RLS, então uma policy restritiva sobre
 * `agency_contracts` derrubaria a geração se isto lançasse.
 */
export async function resolverAgencia(
  nome: string | null,
): Promise<ReportPayload["agency"]> {
  if (!nome) return null;

  if (isDemoMode) {
    const { demoAgencies } = await import("@/lib/mock/data");
    const a = demoAgencies.find((x) => x.agency === nome);
    return {
      name: nome,
      brandPrimary: a?.brand_primary ?? null,
      logoUrl: a?.logo_url ?? null,
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("agency_contracts")
      .select("agency, brand_primary, logo_url")
      .eq("agency", nome)
      .maybeSingle();

    return {
      name: nome,
      brandPrimary: (data?.brand_primary as string | null) ?? null,
      logoUrl: (data?.logo_url as string | null) ?? null,
    };
  } catch {
    return { name: nome, brandPrimary: null, logoUrl: null };
  }
}
