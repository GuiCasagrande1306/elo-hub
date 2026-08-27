import {
  totaisDeOrigem,
  type TotaisDeOrigem,
} from "@/lib/ads/campanha-de-origem";
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
};

/** Somatórios brutos de um período. Tudo inteiro; moeda em centavos. */
export interface MetricTotals {
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  /**
   * O mesmo período, contado só nas CAMPANHAS DE ORIGEM do resultado.
   *
   * Existe porque custo por resultado e ROAS eram divididos pelo gasto da
   * conta inteira, e isso faz uma conta lucrativa parecer no prejuízo.
   * Medido na Satö, 17–23/08/2026: R$550,29 investidos e 22 compras dão
   * R$25,01 por compra e ROAS 8,13; a campanha que existe para vender
   * gastou R$335,08 e trouxe 20 compras — R$16,75 e ROAS 12,35. Os
   * R$215,21 restantes pagam alcance, tráfego e atendimento.
   *
   * O VOLUME NÃO PASSA POR AQUI. Quantas compras e quanta receita
   * continuam sendo da conta inteira: a venda que veio da campanha de
   * alcance é venda de verdade, e tirá-la do relatório mentiria para
   * menos. Só as RAZÕES de eficiência mudam de denominador.
   *
   * Quando não há o que isolar, é uma cópia dos totais com
   * `isolado: false` — ver a rede de segurança em `totaisDeOrigem`.
   */
  origem: TotaisDeOrigem;
}

const ORIGEM_VAZIA: TotaisDeOrigem = {
  spendCents: 0,
  conversions: 0,
  revenueCents: 0,
  campanhas: 0,
  isolado: false,
};

export const EMPTY_TOTALS: MetricTotals = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  revenueCents: 0,
  origem: ORIGEM_VAZIA,
};

/**
 * `tiposDeConversao` é OPCIONAL, e a omissão tem significado: sem ela
 * não há como saber qual família de campanha é a origem, então `origem`
 * vira uma cópia dos totais e o comportamento é o de antes. É o que
 * mantém as treze chamadas espalhadas pelo projeto funcionando enquanto
 * só o relatório e o painel passam a lista — em vez de um parâmetro
 * obrigatório que obrigaria cada uma delas a inventar um valor.
 */
export function sumMetrics(
  rows: DailyMetric[],
  tiposDeConversao?: string[],
): MetricTotals {
  const base = rows.reduce(
    (acc, row) => ({
      spendCents: acc.spendCents + row.spend_cents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + Number(row.conversions),
      revenueCents: acc.revenueCents + row.revenue_cents,
    }),
    {
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenueCents: 0,
    },
  );

  const origem = tiposDeConversao
    ? totaisDeOrigem(rows, tiposDeConversao)
    : {
        spendCents: base.spendCents,
        conversions: base.conversions,
        revenueCents: base.revenueCents,
        campanhas: new Set(rows.map((r) => r.campaign_id)).size,
        isolado: false,
      };

  return { ...base, origem };
}

/**
 * A métrica é uma RAZÃO cujo denominador é zero?
 *
 * ⚠️ ZERO E INDEFINIDO NÃO SÃO A MESMA COISA, e confundi-los produziu o
 * pior defeito que este sistema já teve — porque ele não quebrava nada,
 * só mentia com confiança no documento que vai para o cliente.
 *
 * `deriveMetric` devolve 0 quando o divisor é 0. Isso protege contra
 * NaN e está certo para o gráfico, onde o ponto precisa de um número.
 * Mas um cliente que investiu R$ 5.000 e não gerou pedido nenhum tem
 * custo por pedido INDEFINIDO, não R$ 0,00 — e era isso que a capa do
 * relatório imprimia, com "−100%" pintado de VERDE porque custo caindo
 * é bom, e "anterior: R$ 62,34" logo abaixo. O pior mês possível saía
 * anunciado como o melhor do ano, e a mesma frase ia na mensagem do
 * WhatsApp.
 *
 * A tabela de campanhas do PDF já acertava sozinha, imprimindo "—". O
 * resto do sistema agora segue a mesma régua, num lugar só.
 */
export function metricaIndefinida(key: MetricKey, t: MetricTotals): boolean {
  switch (key) {
    /* `cpa` e `cpl` olham a ORIGEM, porque é dela que sai o número. Sem
       isso, uma conta em que a campanha de origem não converteu diria
       "R$ 0,00" em vez de "—" — o mesmo defeito que este arquivo já
       descreve, um nível abaixo. Quando não há isolamento, `origem` é
       cópia dos totais e as duas leituras coincidem. */
    case "cpa":
    case "cpl":
      return t.origem.conversions === 0;
    case "aov":
      return t.conversions === 0;
    /* ROAS SEM RECEITA É "—", NÃO "0,00x", e a razão é a mesma do
       parágrafo acima, um passo adiante: a divisão existe, mas o número
       não afirma nada que já não esteja dito melhor ao lado.

       Medido em 25/08/2026, ao acrescentar o card de ROAS ao template de
       delivery: quatro contas — D'Mori, Des Cucina, Dom Leonello e Hago
       Pizza — investem de R$192 a R$1.014 e têm ZERO compra registrada
       pelo pixel. O relatório delas já diz "Pedidos: 0" e "Custo por
       pedido: —". Um "ROAS 0,00x" ao lado disso não informa: ele acusa o
       investimento de não ter voltado nada, quando o que os dados dizem
       é que nada foi medido.

       Delivery é justamente onde isso acontece — pedido fechado no iFood
       ou no WhatsApp não passa pelo pixel do site. */
    case "roas":
      return t.origem.spendCents === 0 || t.origem.revenueCents === 0;
    case "ctr":
    case "cpm":
      return t.impressions === 0;
    case "cpc":
      return t.clicks === 0;
    /* Soma, não razão: zero investido é literalmente zero, e imprimir
       "—" ali esconderia um fato verdadeiro. */
    default:
      return false;
  }
}

/**
 * Converte somatórios em valores de KPI.
 * Toda razão é protegida contra divisor zero — um cliente pausado no
 * período não pode derrubar a página com NaN.
 *
 * O 0 devolvido aqui é um VALOR DE FALLBACK, não um fato sobre a conta.
 * Quem exibe número para gente precisa consultar `metricaIndefinida`
 * antes — `computeKpi` já faz isso.
 */
export function deriveMetric(key: MetricKey, t: MetricTotals): number {
  const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

  switch (key) {
    case "spend":
      return t.spendCents;
    case "results":
    case "leads":
      return t.conversions;
    /* AS DUAS RAZÕES DE EFICIÊNCIA SAEM DA ORIGEM, e são as únicas.
       Ver o comentário de `MetricTotals.origem`. */
    case "cpa":
    case "cpl":
      return safeDiv(t.origem.spendCents, t.origem.conversions);
    case "revenue":
      return t.revenueCents;
    case "roas":
      return safeDiv(t.origem.revenueCents, t.origem.spendCents);
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
  /**
   * Razão sem denominador no período — `formatted` é "—" e não há
   * variação para mostrar. Exposto para a interface poder explicar o
   * traço ("sem conversões no período") em vez de deixar um buraco.
   */
  indefinido: boolean;
  /**
   * Quantas campanhas entraram nesta conta, quando ela foi isolada nas
   * campanhas de origem. `null` = conta inteira.
   *
   * A INTERFACE PRECISA DIZER ISSO. Um custo por compra de R$16,75 numa
   * conta que investiu R$550 e vendeu 22 vezes não fecha em lugar
   * nenhum — quem confere na calculadora acha R$25,01 e conclui que o
   * relatório está errado. O selo "1 campanha" é o que transforma uma
   * discrepância inexplicável numa informação.
   */
  origem: number | null;
}

/* As únicas métricas que mudam de denominador. Ver `deriveMetric`. */
const USAM_ORIGEM = new Set<MetricKey>(["cpa", "cpl", "roas"]);

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

  const indefinido = metricaIndefinida(key, current);
  const anteriorIndefinido = metricaIndefinida(key, previous);

  /* Sem denominador de um dos lados não existe variação: comparar o
     fallback 0 contra o CPA do mês passado é o que produzia o "−100%"
     verde. `null` aqui faz toda a interface cair no ramo "sem base de
     comparação", que já existe e já é tratado em todas as telas. */
  const deltaPercent =
    indefinido || anteriorIndefinido || previousValue === 0
      ? null
      : ((value - previousValue) / previousValue) * 100;

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
    formatted: indefinido ? "—" : def.format(value),
    deltaPercent,
    direction,
    sentiment,
    previousValue,
    previousFormatted: anteriorIndefinido ? "—" : def.format(previousValue),
    indefinido,
    origem:
      USAM_ORIGEM.has(key) && current.origem.isolado
        ? current.origem.campanhas
        : null,
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

export function buildTrend(
  rows: DailyMetric[],
  tiposDeConversao?: string[],
): TrendPoint[] {
  /* Agrupa e chama `sumMetrics` por dia, em vez de somar campo a campo
     aqui. Antes era a soma manual, e ela não tinha como calcular a
     origem — o card diria "custo por compra R$16,75" e a linha do
     gráfico desenharia R$25,01 no mesmo dia, sem nada explicando a
     diferença. */
  const porData = new Map<string, DailyMetric[]>();
  for (const row of rows) {
    const lista = porData.get(row.metric_date);
    if (lista) lista.push(row);
    else porData.set(row.metric_date, [row]);
  }

  const byDate = new Map<string, MetricTotals>(
    [...porData].map(([data, linhas]) => [
      data,
      sumMetrics(linhas, tiposDeConversao),
    ]),
  );

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({
      date,
      spend: t.spendCents / 100,
      results: t.conversions,
      revenue: t.revenueCents / 100,
      cpa:
        t.origem.conversions === 0
          ? 0
          : t.origem.spendCents / t.origem.conversions / 100,
    }));
}

/** Quebra por plataforma — alimenta o donut e a seção do PDF. */
export interface PlatformSplit {
  platform: AdPlatform;
  label: string;
  totals: MetricTotals;
  spendShare: number;
  cpa: number;
  /**
   * O CPA acima é o FALLBACK ZERO de `safeDiv`, não um custo?
   *
   * ⚠️ SEM ISTO O PDF IMPRIMIA "R$ 0,00 por resultado" numa plataforma
   * que não converteu — o único valor monetário de razão do documento
   * inteiro sem a guarda de `metricaIndefinida`. A tabela de campanhas,
   * os cards de criativo e a grade de KPIs já imprimiam "—"; só esta
   * linha estampava o fallback como fato, e "R$ 0,00" lê como "saiu de
   * graça".
   *
   * Medido em 27/08/2026, período de 30 dias: nove pares conta/
   * plataforma caíam nisso — D'Mori R$ 909,00, Cura da Alma R$ 986,13,
   * Des Cucina R$ 691,47, Dom Leonello R$ 690,78, todas com o canal em
   * 100% do investimento e zero conversão. No mesmo PDF, o card da capa
   * dizia "Custo por pedido: —" e a seção de canais dizia R$ 0,00.
   */
  cpaIndefinido: boolean;
}

export const PLATFORM_LABELS: Record<AdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  linkedin_ads: "LinkedIn Ads",
  organic: "Orgânico",
};

/**
 * `tiposDeConversao` OPCIONAL pelo mesmo motivo de `sumMetrics`, e
 * PRECISA ser passado por quem desenha relatório.
 *
 * Sem ele, cada plataforma divide o gasto INTEIRO dela pelos resultados
 * — que é exatamente o número que a campanha de origem existe para
 * corrigir. O estrago não é um número errado isolado: é o MESMO PDF
 * mostrando dois. Medido na Satö, 18–24/08/2026, antes desta linha: a
 * grade de KPIs imprimia ROAS 12,35x e R$ 16,75 por pedido, e a seção
 * "Meta Ads" três parágrafos abaixo imprimia 8,11x e R$ 25,09 — no
 * documento que vai para o cliente, sem nada explicando a diferença.
 *
 * A decisão é POR PLATAFORMA de propósito: a seção do Meta isola entre
 * as campanhas do Meta, e é isso que ela se propõe a mostrar.
 */
export function splitByPlatform(
  rows: DailyMetric[],
  tiposDeConversao?: string[],
): PlatformSplit[] {
  const byPlatform = new Map<AdPlatform, DailyMetric[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }

  const grandTotal = rows.reduce((acc, r) => acc + r.spend_cents, 0);

  return [...byPlatform.entries()]
    .map(([platform, list]) => {
      const totals = sumMetrics(list, tiposDeConversao);
      return {
        platform,
        label: PLATFORM_LABELS[platform],
        totals,
        spendShare: grandTotal === 0 ? 0 : totals.spendCents / grandTotal,
        cpa: deriveMetric("cpa", totals),
        cpaIndefinido: metricaIndefinida("cpa", totals),
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
