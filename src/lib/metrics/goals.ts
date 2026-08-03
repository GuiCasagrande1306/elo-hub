import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
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
  status: GoalStatus;
  tone: GoalTone;
  /** Frase curta que explica o status em uma linha. */
  message: string;
  plannedLabel: string;
  executedLabel: string;
  /** Valor veio de override manual, não do sync das plataformas. */
  isOverride: boolean;
}

/** Tolerância de ritmo: abaixo disso, considera-se dentro do esperado. */
const PACE_TOLERANCE = 0.12;

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

  let status: GoalStatus = "no-ritmo";
  let tone: GoalTone = "neutral";
  let message = "Dentro do planejado.";

  if (plannedCents <= 0) {
    status = "sem-meta";
    tone = "neutral";
    message = "Orçamento do período não definido.";
  } else if (ratio > 1) {
    status = "estourou";
    tone = "negative";
    message = `Estourou o orçamento em ${formatCurrency(executedCents - plannedCents)}.`;
  } else if (elapsed !== null) {
    const drift = ratio - elapsed;

    if (drift > PACE_TOLERANCE) {
      status = "acelerado";
      tone = "warning";
      message = `Gastando acima do ritmo — ${formatPercent(ratio, 0)} da verba com ${formatPercent(elapsed, 0)} do período.`;
    } else if (drift < -PACE_TOLERANCE) {
      // Subinvestir também é desvio: verba parada não vira resultado.
      status = "atrasado";
      tone = "warning";
      message = `Abaixo do ritmo — sobra ${formatCurrency(plannedCents - executedCents)} para o período restante.`;
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
    status,
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
): GoalProgress {
  const ratio = safeRatio(executedResults, plannedResults);

  let status: GoalStatus = "no-ritmo";
  let tone: GoalTone = "neutral";
  let message = "Dentro do esperado.";

  if (plannedResults <= 0) {
    status = "sem-meta";
    tone = "neutral";
    message = "Meta de resultados não definida.";
  } else if (ratio >= 1) {
    status = "batida";
    tone = "positive";
    message =
      ratio > 1
        ? `Meta superada em ${formatPercent(ratio - 1, 0)}.`
        : "Meta atingida.";
  } else if (elapsed !== null) {
    const drift = ratio - elapsed;

    if (drift > PACE_TOLERANCE) {
      status = "acelerado";
      tone = "positive";
      message = `Adiantado — ${formatPercent(ratio, 0)} da meta com ${formatPercent(elapsed, 0)} do período.`;
    } else if (drift < -PACE_TOLERANCE) {
      status = "atrasado";
      tone = "negative";
      const faltam = plannedResults - executedResults;
      message = `Atrasado — faltam ${formatNumber(Math.ceil(faltam))} para a meta.`;
    } else {
      status = "no-ritmo";
      tone = "positive";
      message = "No ritmo para bater a meta.";
    }
  }

  return {
    kind: "results",
    label: "Resultados",
    planned: plannedResults,
    executed: executedResults,
    ratio,
    barPercent: Math.min(ratio * 100, 100),
    elapsed,
    status,
    tone,
    message,
    plannedLabel: formatNumber(Math.round(plannedResults)),
    executedLabel: formatNumber(Math.round(executedResults)),
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
  computedResults: number;
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
  computedResults,
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
  const executedResults = goal.executed_results_override ?? computedResults;

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

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  "sem-meta": "Sem meta",
  "no-ritmo": "No ritmo",
  acelerado: "Acelerado",
  atrasado: "Atrasado",
  estourou: "Estourou",
  batida: "Meta batida",
};
