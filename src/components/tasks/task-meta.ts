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
