import type { TaskPriority, TaskStatus } from "@/types/database";

/**
 * Vocabulário compartilhado do módulo de tarefas.
 *
 * Kanban, lista, modal e o resumo da home leem daqui. Rótulo ou cor
 * definidos em mais de um lugar sempre acabam divergindo — aqui existe
 * uma única fonte.
 */

export const TASK_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "A fazer" },
  { status: "in_progress", label: "Em andamento" },
  { status: "review", label: "Revisão" },
  { status: "done", label: "Concluído" },
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Revisão",
  done: "Concluído",
};

/** Cor do marcador da coluna — só o ponto é colorido, não o cabeçalho. */
export const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/45",
  todo: "bg-chart-5",
  in_progress: "bg-chart-3",
  review: "bg-chart-4",
  done: "bg-signal",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-muted text-muted-foreground",
  high: "bg-warning-muted text-warning",
  urgent: "bg-negative-muted text-negative",
};

/** Ordena por urgência e depois por prazo — a ordem do "o que fazer agora". */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/* =====================================================================
   Criticidade e cor pessoal
   ---------------------------------------------------------------------
   `criticality` (1–10) é a fonte da verdade; `priority` é derivada dela
   por trigger no banco. As duas nunca divergem, então a interface pode
   mostrar a que fizer mais sentido em cada lugar sem risco de conflito.
   ===================================================================== */

/** Faixa da barra de criticidade. Só três: dez tons não se distinguem. */
export function criticalityTone(nivel: number): string {
  if (nivel >= 9) return "bg-negative";
  if (nivel >= 7) return "bg-warning";
  return "bg-muted-foreground/50";
}

/* Tokens do tema, não hex: cor escolhida no claro por uma pessoa vira
   mancha ilegível no escuro do colega. */
export const COLOR_TAG_CLASSES: Record<string, string> = {
  rosa: "bg-pink-500",
  laranja: "bg-orange-500",
  ambar: "bg-amber-500",
  verde: "bg-emerald-500",
  azul: "bg-sky-500",
  roxo: "bg-violet-500",
  cinza: "bg-slate-400",
};

export const COLOR_TAG_LABELS: Record<string, string> = {
  rosa: "Rosa",
  laranja: "Laranja",
  ambar: "Âmbar",
  verde: "Verde",
  azul: "Azul",
  roxo: "Roxo",
  cinza: "Cinza",
};
