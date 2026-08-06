import {
  formatCurrency,
  formatNumber,
  parseCurrencyToCents,
} from "@/lib/format";
import type { ClientSegment } from "@/types/database";

/* =====================================================================
   O que conta como "resultado" nesta conta
   ---------------------------------------------------------------------
   "Resultados: 120" não quer dizer nada sozinho. Numa loja virtual o
   número que o dono cobra é faturamento; numa clínica é quantos
   contatos entraram. Rotular os dois como "Resultados" força quem lê a
   lembrar de cabeça o que aquele cliente vende — e é assim que um
   painel vira decoração.

   Duas coisas variam, e elas têm origens diferentes:

     RÓTULO   vem do segmento. É cosmético e pode mudar quando o
              cadastro muda.
     UNIDADE  vem da META. É semântica: decide se `planned_results`
              guarda uma contagem ou centavos, e reinterpretar isso
              retroativamente corrompe o histórico. Ver a migration
              20260806000025.

   Por isso `goalMetricFor` recebe os dois e a unidade gravada vence. O
   segmento só decide o padrão de uma meta NOVA.

   Nada aqui muda o que o sync busca na plataforma: qual evento contar
   já é decidido em `lib/ads/conversion-action.ts`, também por segmento.
   Este arquivo escolhe qual COLUNA do que já foi sincronizado alimenta
   a comparação com a meta.
   ===================================================================== */

export type GoalMetricKey = "count" | "revenue";

export interface GoalMetric {
  key: GoalMetricKey;
  /** Rótulo do indicador — barra do card, banner, coluna do histórico. */
  label: string;
  /** Rótulo do campo no formulário de meta. */
  inputLabel: string;
  /** Explicação de uma linha sob o campo. */
  hint: string;
  placeholder: string;
  /**
   * Nome do custo unitário. `null` quando a meta já é em dinheiro — ali
   * a razão que interessa é ROAS, e "custo por faturamento" não existe.
   */
  costLabel: string | null;
  /** Somatório de `daily_metrics` que alimenta o executado. */
  source: "conversions" | "revenueCents";
  /** Valor trafega em centavos e se digita em reais. */
  isCurrency: boolean;
}

/** Unidade de uma meta nova, quando o segmento não diz o contrário. */
const PADRAO_POR_SEGMENTO: Record<ClientSegment, GoalMetricKey> = {
  /* Loja virtual e delivery têm ticket e receita rastreados pelo pixel:
     `action_values` já vem preenchido no mesmo evento de compra que o
     sync conta. Medir esses dois por quantidade descarta a informação
     mais cara que a conta produz. */
  ecommerce: "revenue",
  delivery: "revenue",

  /* Captação não tem valor por conversão — um lead não vale R$ 0. */
  leads: "count",

  /* Negócio local fecha no balcão ou no telefone: a plataforma vê a
     conversa começar, nunca o valor. */
  local_business: "count",
};

/** Como se chama UMA unidade, por segmento, quando a meta é contagem. */
const CONTAGEM_POR_SEGMENTO: Record<
  ClientSegment,
  { label: string; inputLabel: string; hint: string; placeholder: string; costLabel: string }
> = {
  ecommerce: {
    label: "Compras",
    inputLabel: "Meta de compras",
    hint: "Quantas compras o mês precisa fechar.",
    placeholder: "260",
    costLabel: "Custo por compra",
  },
  delivery: {
    label: "Pedidos",
    inputLabel: "Meta de pedidos",
    hint: "Quantos pedidos o mês precisa fechar.",
    placeholder: "400",
    costLabel: "Custo por pedido",
  },
  leads: {
    label: "Leads",
    inputLabel: "Meta de leads",
    hint: "Quantos formulários o mês precisa entregar.",
    placeholder: "120",
    costLabel: "Custo por lead",
  },
  local_business: {
    /* A Meta entrega este número como conversa iniciada — é o evento que
       o sync conta (`messaging_conversation_started_7d`). Chamar de
       "visitas ao perfil" seria rotular um número pelo nome de outro:
       visita de perfil vem de outro endpoint da Graph API e não está
       disponível com as permissões atuais do app. */
    label: "Conversas",
    inputLabel: "Meta de conversas",
    hint: "Quantas conversas o mês precisa abrir no WhatsApp, Direct ou Messenger.",
    placeholder: "80",
    costLabel: "Custo por conversa",
  },
};

const FATURAMENTO: Omit<GoalMetric, "key"> = {
  label: "Faturamento",
  inputLabel: "Meta de faturamento",
  hint: "Quanto a mídia precisa gerar em vendas no mês.",
  placeholder: "50.000,00",
  costLabel: null,
  source: "revenueCents",
  isCurrency: true,
};

/**
 * O indicador de sucesso desta meta.
 *
 * `stored` é `client_goals.results_metric`, e os três casos são
 * DIFERENTES — confundi-los é o bug que esta função existe para evitar:
 *
 *   "count" | "revenue"  a unidade em que o número foi digitado. Vence
 *                        sempre, inclusive contra o segmento atual.
 *   null                 a meta existe e é ANTERIOR à coluna. Toda meta
 *                        anterior era contagem. Cair no padrão do
 *                        segmento aqui releria "80 pedidos" como
 *                        "R$ 0,80" numa conta de delivery — e a barra
 *                        anunciaria 69.965% de superação.
 *   undefined            não há meta. Só então o segmento decide, e o
 *                        que ele decide é o rótulo do card sem meta.
 *
 * Os chamadores preservam a distinção naturalmente com `goal?.field`:
 * sem meta o encadeamento devolve `undefined`, com meta devolve o valor
 * da coluna.
 */
export function goalMetricFor(
  segment: ClientSegment | null | undefined,
  stored?: string | null,
): GoalMetric {
  const seg: ClientSegment = segment ?? "leads";
  const key: GoalMetricKey =
    stored === "revenue" || stored === "count"
      ? stored
      : stored === null
        ? "count"
        : PADRAO_POR_SEGMENTO[seg];

  if (key === "revenue") return { key, ...FATURAMENTO };

  const contagem = CONTAGEM_POR_SEGMENTO[seg];
  return { key, ...contagem, source: "conversions", isCurrency: false };
}

/**
 * Unidade padrão de uma meta NOVA — a que o formulário usa antes de
 * existir linha gravada.
 */
export function defaultGoalMetricFor(
  segment: ClientSegment | null | undefined,
): GoalMetric {
  /* Sem o segundo argumento, de propósito: `null` ali significaria
     "meta antiga, logo contagem" e devolveria contagem para todo mundo.
     Aqui não há meta nenhuma — o segmento é quem decide. */
  return goalMetricFor(segment);
}

/** O executado, lido da coluna que esta meta compara. */
export function goalExecutedFrom(
  metric: GoalMetric,
  totals: { conversions: number; revenueCents: number },
): number {
  return metric.source === "revenueCents"
    ? totals.revenueCents
    : totals.conversions;
}

/** Formata um valor já na unidade da meta. */
export function formatGoalValue(metric: GoalMetric, value: number): string {
  return metric.isCurrency
    ? formatCurrency(Math.round(value))
    : formatNumber(Math.round(value));
}

/**
 * Converte o que foi digitado para a unidade de armazenamento.
 *
 * Meta em dinheiro vira CENTAVOS, como todo valor monetário do sistema.
 * Devolve `null` quando o texto não é um número — quem chama transforma
 * isso em mensagem de erro em vez de gravar `NaN`.
 */
export function parseGoalInput(
  metric: GoalMetric,
  raw: string,
): number | null {
  if (metric.isCurrency) return parseCurrencyToCents(raw);

  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Valor gravado de volta para o campo de texto do formulário. */
export function goalInputValue(metric: GoalMetric, stored: number): string {
  return metric.isCurrency
    ? (stored / 100).toFixed(2).replace(".", ",")
    : String(stored);
}
