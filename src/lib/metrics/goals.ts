import { formatCurrency, formatPercent } from "@/lib/format";
import {
  formatGoalValue,
  goalExecutedFrom,
  type GoalMetric,
} from "@/lib/metrics/goal-metric";
import type { ClientGoal } from "@/types/database";

/* =====================================================================
   Progresso de meta
   ---------------------------------------------------------------------
   As duas barras do card têm semântica OPOSTA, e tratá-las igual é o
   erro que torna esse tipo de painel inútil:

     ORÇAMENTO  — passar de 100% é ESTOURO. Vermelho.
     RESULTADOS — passar de 100% é SUPERAÇÃO. Verde.

   E há uma segunda dimensão que quase todo painel ignora: RITMO.
   Ter gasto 60% do orçamento não diz nada sozinho. Se o mês está pela
   metade, 60% é aceleração; se faltam 3 dias, é subinvestimento — e
   subinvestir é tão problema quanto estourar, porque a verba não gasta
   não vira resultado e o cliente cobra o que foi contratado.

   Por isso o cálculo compara o percentual executado com o percentual do
   PERÍODO JÁ DECORRIDO, e não com 100%.
   ===================================================================== */

export type GoalTone = "positive" | "warning" | "negative" | "neutral";

export type GoalStatus =
  | "sem-meta"
  | "no-ritmo"
  | "acelerado"
  | "atrasado"
  | "estourou"
  | "batida";

/**
 * Ritmo: o que o período decorrido pedia até hoje, contra o que saiu.
 *
 * `ratio` é o PACING do mercado de mídia — executado ÷ esperado, e não
 * a diferença em pontos percentuais entre os dois. A distinção importa
 * nas pontas do mês: 12 pontos de desvio no dia 3 são ruído de fim de
 * semana, e no dia 28 são verba que não vai mais ser gasta. A razão
 * trata os dois casos na mesma escala — 0,75 é "três quartos do que
 * deveria" em qualquer dia.
 */
export interface PacingInfo {
  /** Valor ideal acumulado até hoje: planejado × período decorrido. */
  expected: number;
  expectedLabel: string;
  /** Executado ÷ esperado. 1 = exatamente no ritmo. */
  ratio: number;
}

export interface GoalProgress {
  kind: "budget" | "results";
  label: string;
  planned: number;
  executed: number;
  /** Executado ÷ planejado. 1 = exatamente na meta. */
  ratio: number;
  /** Largura da barra, 0–100. Acima de 100 satura para não vazar. */
  barPercent: number;
  /** Fração do período já decorrida (0–1); null fora de um período. */
  elapsed: number | null;
  /** Ritmo do dia. `null` quando não há meta ou é cedo demais para ler. */
  pacing: PacingInfo | null;
  status: GoalStatus;
  /** Rótulo curto do status, já ciente de orçamento vs resultado. */
  statusLabel: string;
  tone: GoalTone;
  /** Frase curta que explica o status em uma linha. */
  message: string;
  plannedLabel: string;
  executedLabel: string;
  /** Valor veio de override manual, não do sync das plataformas. */
  isOverride: boolean;
}

/**
 * Tolerância de ritmo: entre 90% e 110% do esperado, está no ritmo.
 *
 * Aplicada sobre a RAZÃO de pacing, não sobre a diferença de pontos.
 */
const PACE_TOLERANCE = 0.1;

/**
 * Antes disto o ritmo não é lido — fica neutro.
 *
 * 10% do período são ~3 dias num mês. Nos primeiros dias o esperado é
 * pequeno o bastante para que uma pausa de fim de semana, uma conta que
 * subiu no dia 2 ou uma entrega atrasada da plataforma joguem a razão
 * para 0,4 sem que nada esteja errado. Um alerta que dispara todo dia 1º
 * é um alerta que ninguém lê no dia 20.
 */
const MIN_ELAPSED_FOR_PACING = 0.1;

const DAY_MS = 86_400_000;

/**
 * Fração do período já decorrida, em granularidade de DIA.
 *
 * Deliberadamente não usa milissegundos. Duas razões:
 *
 *  • Semântica: "82% do ciclo" é uma leitura diária. Um marcador que
 *    desliza a cada milissegundo não informa nada a mais.
 *  • Estabilidade: valor derivado do relógio, renderizado no servidor e
 *    de novo no cliente, produz dois números diferentes e o React acusa
 *    divergência de hidratação. Dia inteiro elimina a oscilação.
 *
 * Ainda assim, quem renderiza no servidor deve PASSAR o resultado ao
 * cliente em vez de recalcular — servidor em UTC e navegador em UTC-3
 * discordam sobre qual é "hoje" durante três horas por dia.
 */
export function periodElapsed(
  start: string,
  end: string,
  now = new Date(),
): number {
  const startDay = Date.parse(`${start}T00:00:00Z`);
  const endDay = Date.parse(`${end}T00:00:00Z`);

  const totalDays = Math.round((endDay - startDay) / DAY_MS) + 1;
  if (totalDays <= 0) return 1;

  const todayDay = Date.parse(`${toISODate(now)}T00:00:00Z`);
  const elapsedDays = Math.round((todayDay - startDay) / DAY_MS) + 1;

  return Math.min(Math.max(elapsedDays / totalDays, 0), 1);
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeRatio(executed: number, planned: number): number {
  // Sem meta definida não existe proporção — quem chama trata como
  // "sem-meta" em vez de receber Infinity e pintar a barra inteira.
  return planned <= 0 ? 0 : executed / planned;
}

/**
 * O ritmo do dia, ou `null` quando não há o que ler.
 *
 * `null` em três casos, e todos significam "não afirme nada": sem meta,
 * fora de um período, ou cedo demais no ciclo. Devolver 0 em vez de
 * `null` faria a interface anunciar "gasto lento" numa conta que ainda
 * não tinha como ter gasto.
 */
function buildPacing(
  planned: number,
  executed: number,
  elapsed: number | null,
  format: (value: number) => string,
): PacingInfo | null {
  if (planned <= 0) return null;
  if (elapsed === null || elapsed < MIN_ELAPSED_FOR_PACING) return null;

  const expected = planned * elapsed;

  return {
    expected,
    expectedLabel: format(expected),
    ratio: expected <= 0 ? 0 : executed / expected,
  };
}

const BUDGET_STATUS_LABELS: Record<GoalStatus, string> = {
  "sem-meta": "Sem orçamento",
  "no-ritmo": "Ritmo saudável",
  acelerado: "Gasto acelerado",
  atrasado: "Gasto lento",
  estourou: "Estourou",
  batida: "Verba usada",
};

const RESULTS_STATUS_LABELS: Record<GoalStatus, string> = {
  "sem-meta": "Sem meta",
  "no-ritmo": "No ritmo da meta",
  acelerado: "Adiantado",
  atrasado: "Abaixo da meta",
  estourou: "Estourou",
  batida: "Meta batida",
};

/* ------------------------------------------------------------------ */
/* Orçamento — passar de 100% é ruim                                   */
/* ------------------------------------------------------------------ */

function budgetProgress(
  plannedCents: number,
  executedCents: number,
  elapsed: number | null,
  isOverride: boolean,
): GoalProgress {
  const ratio = safeRatio(executedCents, plannedCents);
  const pacing = buildPacing(
    plannedCents,
    executedCents,
    elapsed,
    formatCurrency,
  );

  let status: GoalStatus = "no-ritmo";
  let tone: GoalTone = "neutral";
  let message = "Dentro do planejado.";

  if (plannedCents <= 0) {
    status = "sem-meta";
    tone = "neutral";
    message = "Orçamento do período não definido.";
  } else if (ratio > 1) {
    /* Estouro é absoluto e vem ANTES do ritmo: passou da verba do mês
       inteiro, e nenhuma leitura de pacing muda isso. */
    status = "estourou";
    tone = "negative";
    message = `Estourou o orçamento em ${formatCurrency(executedCents - plannedCents)}.`;
  } else if (pacing) {
    if (pacing.ratio > 1 + PACE_TOLERANCE) {
      status = "acelerado";
      tone = "warning";
      message = `${formatPercent(pacing.ratio, 0)} do previsto para hoje — a verba acaba antes do mês.`;
    } else if (pacing.ratio < 1 - PACE_TOLERANCE) {
      // Subinvestir também é desvio: verba parada não vira resultado.
      status = "atrasado";
      tone = "warning";
      message = `Sobra ${formatCurrency(plannedCents - executedCents)} para o período restante.`;
    } else {
      status = "no-ritmo";
      tone = "positive";
      message = "Ritmo de investimento saudável.";
    }
  }

  return {
    kind: "budget",
    label: "Investimento",
    planned: plannedCents,
    executed: executedCents,
    ratio,
    barPercent: Math.min(ratio * 100, 100),
    elapsed,
    pacing,
    status,
    statusLabel: BUDGET_STATUS_LABELS[status],
    tone,
    message,
    plannedLabel: formatCurrency(plannedCents),
    executedLabel: formatCurrency(executedCents),
    isOverride,
  };
}

/* ------------------------------------------------------------------ */
/* Resultados — passar de 100% é ótimo                                 */
/* ------------------------------------------------------------------ */

function resultsProgress(
  plannedResults: number,
  executedResults: number,
  elapsed: number | null,
  isOverride: boolean,
  metric: GoalMetric,
): GoalProgress {
  const ratio = safeRatio(executedResults, plannedResults);
  const pacing = buildPacing(plannedResults, executedResults, elapsed, (v) =>
    formatGoalValue(metric, v),
  );

  let status: GoalStatus = "no-ritmo";
  let tone: GoalTone = "neutral";
  let message = "Dentro do esperado.";

  if (plannedResults <= 0) {
    status = "sem-meta";
    tone = "neutral";
    message = `Meta de ${metric.label.toLowerCase()} não definida.`;
  } else if (ratio >= 1) {
    status = "batida";
    tone = "positive";
    message =
      ratio > 1
        ? `Meta superada em ${formatPercent(ratio - 1, 0)}.`
        : "Meta atingida.";
  } else if (pacing) {
    /* Só DUAS faixas decidem a cor, como no orçamento invertido: a
       partir de 90% do esperado está no ritmo, abaixo disso está
       atrasado. "Adiantado" é um recorte do verde, não um terceiro
       julgamento — mas vale dizer, porque quem está 40% à frente no dia
       10 pode cortar verba e ainda bater. */
    if (pacing.ratio >= 1 - PACE_TOLERANCE) {
      status = pacing.ratio > 1 + PACE_TOLERANCE ? "acelerado" : "no-ritmo";
      tone = "positive";
      message =
        status === "acelerado"
          ? `${formatPercent(pacing.ratio, 0)} do esperado para hoje.`
          : "No ritmo para bater a meta.";
    } else {
      status = "atrasado";
      tone = "negative";
      const faltam = plannedResults - executedResults;
      message = `Faltam ${formatGoalValue(metric, faltam)} para a meta.`;
    }
  }

  return {
    kind: "results",
    label: metric.label,
    planned: plannedResults,
    executed: executedResults,
    ratio,
    barPercent: Math.min(ratio * 100, 100),
    elapsed,
    pacing,
    status,
    statusLabel: RESULTS_STATUS_LABELS[status],
    tone,
    message,
    plannedLabel: formatGoalValue(metric, plannedResults),
    executedLabel: formatGoalValue(metric, executedResults),
    isOverride,
  };
}

/* ------------------------------------------------------------------ */
/* Entrada pública                                                     */
/* ------------------------------------------------------------------ */

export interface GoalInput {
  goal: ClientGoal | null;
  /** Somatórios reais do período, vindos de `daily_metrics`. */
  computedSpendCents: number;
  /**
   * As DUAS colunas de resultado, não a que o chamador achou que valia.
   *
   * A meta de uma loja é faturamento e a de uma clínica é contagem —
   * quem escolhe é `metric.source`, aqui dentro. Receber um único
   * `computedResults` já resolvido devolveria a decisão para cada tela,
   * e bastaria uma delas passar `conversions` numa conta de e-commerce
   * para a barra comparar 12 compras contra uma meta de R$ 50.000.
   */
  computedConversions: number;
  computedRevenueCents: number;
  /** O indicador desta conta — ver `lib/metrics/goal-metric.ts`. */
  metric: GoalMetric;
  now?: Date;
}

export interface GoalProgressPair {
  budget: GoalProgress;
  results: GoalProgress;
  cycle: {
    elapsed: number;
    /** Dias inteiros até o fim do ciclo. Calculado junto com `elapsed`
     *  para que o card não precise consultar o relógio de novo. */
    daysLeft: number;
    periodEnd: string;
  };
}

export function buildGoalProgress({
  goal,
  computedSpendCents,
  computedConversions,
  computedRevenueCents,
  metric,
  now,
}: GoalInput): GoalProgressPair | null {
  if (!goal) return null;

  const elapsed = periodElapsed(goal.period_start, goal.period_end, now);

  const daysLeft = Math.max(
    Math.round(
      (Date.parse(`${goal.period_end}T00:00:00Z`) -
        Date.parse(`${toISODate(now ?? new Date())}T00:00:00Z`)) /
        DAY_MS,
    ),
    0,
  );

  // O override manual vence o número da plataforma — ver a justificativa
  // na migration 20260803000005.
  const executedBudget =
    goal.executed_budget_cents_override ?? computedSpendCents;

  /* O override está na mesma unidade da meta — quem digitou "corrigir
     para R$ 42.000" e quem digitou "corrigir para 42 leads" preenchem o
     mesmo campo da mesma tela. Por isso ele entra depois da escolha da
     coluna, não antes. */
  const executedResults =
    goal.executed_results_override ??
    goalExecutedFrom(metric, {
      conversions: computedConversions,
      revenueCents: computedRevenueCents,
    });

  return {
    budget: budgetProgress(
      goal.planned_budget_cents,
      executedBudget,
      elapsed,
      goal.executed_budget_cents_override !== null,
    ),
    results: resultsProgress(
      goal.planned_results,
      executedResults,
      elapsed,
      goal.executed_results_override !== null,
      metric,
    ),
    cycle: { elapsed, daysLeft, periodEnd: goal.period_end },
  };
}

/** Cor da barra e do texto por tom — usada pelo card. */
export const GOAL_TONE_CLASSES: Record<
  GoalTone,
  { bar: string; text: string; chip: string }
> = {
  positive: {
    bar: "bg-positive",
    text: "text-positive",
    chip: "bg-positive-muted text-positive",
  },
  warning: {
    bar: "bg-warning",
    text: "text-warning",
    chip: "bg-warning-muted text-warning",
  },
  negative: {
    bar: "bg-negative",
    text: "text-negative",
    chip: "bg-negative-muted text-negative",
  },
  neutral: {
    bar: "bg-muted-foreground/45",
    text: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground",
  },
};

/* Não existe mais um mapa único de status → rótulo. O mesmo status
   significa coisas opostas nas duas barras — "acelerado" é alerta no
   orçamento e elogio no resultado —, então cada `GoalProgress` já sai
   com o seu `statusLabel` resolvido. Ver BUDGET_STATUS_LABELS e
   RESULTS_STATUS_LABELS acima. */
