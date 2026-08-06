"use client";

import { CheckSquare } from "lucide-react";

import {
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_DOT,
  STATUS_LABELS,
} from "./task-meta";
import { cn } from "@/lib/utils";
import { ColorTagCell, CriticalityCell } from "./task-quick-edit";
import { formatDueDate, initials } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/**
 * Visão em lista.
 *
 * Complementa o Kanban: o quadro responde "em que pé está?", a lista
 * responde "o que vence primeiro?". Por isso a ordenação padrão aqui é
 * por prazo, e não pela posição no quadro.
 *
 * No mobile a tabela vira cartões empilhados — tabela com scroll
 * horizontal em tela pequena é o pior dos dois mundos.
 */
export function TaskList({
  tasks,
  onOpenTask,
}: {
  tasks: TaskWithRelations[];
  onOpenTask: (id: string) => void;
}) {
  const sorted = [...tasks].sort((a, b) =>
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma tarefa encontrada com os filtros atuais.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden">
      {/* Cabeçalho só faz sentido quando há colunas: escondido no mobile. */}
      <div className="hidden grid-cols-[1fr_140px_120px_110px_92px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
        {["Tarefa", "Cliente", "Status", "Prazo", "Equipe"].map((label) => (
          <span key={label} className="eyebrow">
            {label}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-hairline">
        {sorted.map((task) => {
          const due = formatDueDate(task.due_date);
          const doneItems = task.checklist.filter((c) => c.is_done).length;

          return (
            <li key={task.id}>
              <div className="grid w-full grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-accent/45 md:grid-cols-[1fr_140px_120px_110px_92px_auto_auto] md:items-center">
                {/* Tarefa — só o título abre a gaveta. As células de
                    edição rápida ficam fora do alvo de clique, senão
                    ajustar criticidade abriria a tarefa junto. */}
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="flex min-w-0 items-start gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      PRIORITY_STYLES[task.priority],
                    )}
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    {task.checklist.length > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
                        <CheckSquare className="size-3" />
                        {doneItems}/{task.checklist.length}
                      </p>
                    )}
                  </div>
                </button>

                {/* Cliente */}
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {task.client && (
                    <>
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: task.client.brand_primary ?? "#8a8a8a",
                        }}
                      />
                      <span className="truncate">{task.client.name}</span>
                    </>
                  )}
                </span>

                {/* Status */}
                <span className="flex items-center gap-1.5 text-xs">
                  <span className={cn("size-2 rounded-full", STATUS_DOT[task.status])} />
                  <span className="truncate text-muted-foreground">
                    {STATUS_LABELS[task.status]}
                  </span>
                </span>

                {/* Prazo */}
                <span
                  className={cn(
                    "text-xs tabular-nums text-muted-foreground",
                    due.tone === "overdue" && "font-medium text-negative",
                    due.tone === "today" && "font-medium text-warning",
                  )}
                >
                  {due.label || "—"}
                </span>

                {/* Equipe */}
                <span className="flex -space-x-1.5 md:justify-end">
                  {task.assignees.slice(0, 3).map((person) => (
                    <span
                      key={person.id}
                      title={person.full_name}
                      className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold ring-2 ring-card"
                    >
                      {initials(person.full_name)}
                    </span>
                  ))}
                </span>

                {/* Edição rápida: salvam no clique, sem abrir a gaveta.
                    Quem está na lista veio ajustar vários itens em
                    sequência. */}
                <CriticalityCell taskId={task.id} value={task.criticality} />
                <ColorTagCell taskId={task.id} value={task.color_tag} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
