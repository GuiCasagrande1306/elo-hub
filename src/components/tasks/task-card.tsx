"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckSquare, MessageSquare } from "lucide-react";

import { PRIORITY_LABELS, PRIORITY_STYLES } from "./task-meta";
import { cn } from "@/lib/utils";
import { COLOR_TAG_CLASSES, criticalityTone } from "./task-meta";
import { formatDueDate, initials } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/**
 * Card do Kanban.
 *
 * `TaskCardShell` é a parte puramente visual; `TaskCard` a envolve com o
 * comportamento de arrastar. Separar os dois permite reusar exatamente a
 * mesma aparência dentro do `DragOverlay` — sem isso, o card "fantasma"
 * que segue o cursor fica diferente do original e o arraste parece
 * quebrado.
 */

interface TaskCardProps {
  task: TaskWithRelations;
  onOpen: (taskId: string) => void;
}

/** Deslocamento máximo, em px, que ainda conta como clique e não arraste. */
const CLICK_SLOP = 6;

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { status: task.status } });

  // Origem do gesto, para distinguir clique de arraste.
  const origin = useRef<{ x: number; y: number } | null>(null);

  // Abrir a tarefa é decidido pelo deslocamento do ponteiro, não pelo
  // evento `click`. Num elemento arrastável, `click` dispara também ao
  // fim de um arraste curto — e o dnd-kit chama preventDefault no
  // pointerdown para bloquear a seleção de texto, o que torna o `click`
  // subsequente dependente do navegador. Medir o deslocamento é
  // determinístico: abaixo de CLICK_SLOP é clique, acima é arraste.
  function handlePointerDown(event: React.PointerEvent) {
    origin.current = { x: event.clientX, y: event.clientY };
    listeners?.onPointerDown?.(event);
  }

  function handlePointerUp(event: React.PointerEvent) {
    const start = origin.current;
    origin.current = null;
    if (!start) return;

    const moved =
      Math.abs(event.clientX - start.x) > CLICK_SLOP ||
      Math.abs(event.clientY - start.y) > CLICK_SLOP;

    if (!moved) onOpen(task.id);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    // Enter abre; Espaço fica reservado ao arraste por teclado do dnd-kit.
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(task.id);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        origin.current = null;
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Abrir tarefa: ${task.title}`}
      className={cn(
        "cursor-grab touch-none rounded-xl outline-none active:cursor-grabbing",
        "focus-visible:ring-2 focus-visible:ring-ring",
        // O original some enquanto o overlay é arrastado; sem isso ficam
        // dois cards visíveis ao mesmo tempo.
        isDragging && "opacity-0",
      )}
    >
      <TaskCardShell task={task} />
    </div>
  );
}

export function TaskCardShell({
  task,
  dragging,
}: {
  task: TaskWithRelations;
  dragging?: boolean;
}) {
  const due = formatDueDate(task.due_date);
  const doneItems = task.checklist.filter((c) => c.is_done).length;

  return (
    <article
      className={cn(
        "surface-card flex flex-col gap-2.5 p-3 transition-shadow",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
        dragging && "rotate-1 ring-signal/45 shadow-2xl",
      )}
    >
      {/* Faixa da cor pessoal no topo, largura inteira: é marcação de
          quem organiza, não estado da tarefa — fica visível na varredura
          do quadro sem competir com prioridade ou prazo. */}
      {task.color_tag && (
        <span
          aria-hidden
          className={cn(
            "-mx-3 -mt-3 h-1 rounded-t-[inherit]",
            COLOR_TAG_CLASSES[task.color_tag],
          )}
        />
      )}

      <div className="flex items-start gap-2">
        <span
          title={`Criticidade ${task.criticality}/10`}
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            PRIORITY_STYLES[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.client && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: task.client.brand_primary ?? "#8a8a8a" }}
            />
            <span className="truncate">{task.client.name}</span>
          </span>
        )}
      </div>

      <h3 className="text-sm font-medium leading-snug">{task.title}</h3>

      {/* Barra de progresso: só aparece quando há checklist e ele já
          começou. Barra em 0% em toda tarefa nova vira poluição. */}
      {task.checklist.length > 0 && task.progress > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                task.progress === 100 ? "bg-signal" : "bg-foreground/45",
              )}
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {task.progress}%
          </span>
        </div>
      )}

      {/* Criticidade só aparece de 7 para cima. Barra em toda tarefa
          faria as urgentes deixarem de saltar aos olhos — que é a única
          coisa que a barra precisa fazer. */}
      {task.criticality >= 7 && (
        <div className="flex items-center gap-2">
          <div className="h-1 w-14 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", criticalityTone(task.criticality))}
              style={{ width: `${task.criticality * 10}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {task.criticality}/10
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 text-2xs text-muted-foreground">
        {task.checklist.length > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <CheckSquare className="size-3" />
            {doneItems}/{task.checklist.length}
          </span>
        )}

        {(task.comment_count ?? 0) > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <MessageSquare className="size-3" />
            {task.comment_count}
          </span>
        )}

        {due.label && (
          <span
            className={cn(
              "tabular-nums",
              due.tone === "overdue" && "font-medium text-negative",
              due.tone === "today" && "font-medium text-warning",
            )}
          >
            {due.label}
          </span>
        )}

        {task.assignees.length > 0 && (
          <div className="ml-auto flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((person) => (
              <span
                key={person.id}
                title={person.full_name}
                className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold ring-2 ring-card"
              >
                {initials(person.full_name)}
              </span>
            ))}
            {task.assignees.length > 3 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold ring-2 ring-card">
                +{task.assignees.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
