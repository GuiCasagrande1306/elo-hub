"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";

import { TaskCard, TaskCardShell } from "./task-card";
import { STATUS_DOT, TASK_COLUMNS } from "./task-meta";
import { cn } from "@/lib/utils";
import type { TaskStatus, TaskWithRelations } from "@/types/database";

/**
 * Quadro Kanban.
 *
 * Ordenação por índice fracionário: soltar um card entre dois vizinhos
 * grava a média das posições deles. Uma linha alterada por movimento,
 * em vez de reindexar a coluna inteira — o que, com o Realtime ligado,
 * faria cada arraste disparar N eventos para todos os conectados.
 *
 * A atualização é otimista: o card muda de coluna na hora e a action
 * roda em segundo plano. Se o servidor recusar (por RLS, por exemplo),
 * o `router.refresh()` do Realtime devolve o estado verdadeiro.
 */

interface TaskBoardProps {
  tasks: TaskWithRelations[];
  onOpenTask: (taskId: string) => void;
  onMove: (taskId: string, status: TaskStatus, position: number) => void;
}

const GAP = 1000;

export function TaskBoard({ tasks, onOpenTask, onMove }: TaskBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Estado otimista sobreposto aos dados do servidor.
  const [overrides, setOverrides] = useState<
    Record<string, { status: TaskStatus; position: number }>
  >({});

  const sensors = useSensors(
    // 6px de tolerância: sem isso, um clique para abrir a tarefa é
    // interpretado como início de arraste e o modal nunca abre.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const merged = useMemo(
    () => tasks.map((task) => ({ ...task, ...(overrides[task.id] ?? {}) })),
    [tasks, overrides],
  );

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, TaskWithRelations[]>();
    for (const { status } of TASK_COLUMNS) map.set(status, []);
    for (const task of merged) map.get(task.status)?.push(task);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [merged]);

  const activeTask = merged.find((t) => t.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const taskId = String(active.id);
    const task = merged.find((t) => t.id === taskId);
    if (!task) return;

    // O alvo pode ser a coluna vazia (id = status) ou outro card.
    const overId = String(over.id);
    const overTask = merged.find((t) => t.id === overId);
    const targetStatus = (overTask?.status ??
      (over.data.current?.status as TaskStatus | undefined) ??
      (TASK_COLUMNS.find((c) => c.status === overId)?.status as TaskStatus)) as
      | TaskStatus
      | undefined;

    if (!targetStatus) return;
    if (targetStatus === task.status && overId === taskId) return;

    const columnTasks = (columns.get(targetStatus) ?? []).filter(
      (t) => t.id !== taskId,
    );

    // Índice fracionário entre os vizinhos do ponto de soltura.
    const dropIndex = overTask
      ? columnTasks.findIndex((t) => t.id === overTask.id)
      : columnTasks.length;

    const before = columnTasks[dropIndex - 1]?.position;
    const after = columnTasks[dropIndex]?.position;

    let position: number;
    if (before === undefined && after === undefined) position = GAP;
    else if (before === undefined) position = after! - GAP;
    else if (after === undefined) position = before + GAP;
    else position = (before + after) / 2;

    setOverrides((prev) => ({
      ...prev,
      [taskId]: { status: targetStatus, position },
    }));

    onMove(taskId, targetStatus, position);
  }

  return (
    <DndContext
      /* `id` fixo: sem ele o dnd-kit gera um contador próprio, que sai
         diferente no render do servidor e no do cliente. O resultado é
         um aviso de hidratação em `aria-describedby` a cada carga da
         página — inofensivo para o usuário, mas ruído permanente no
         console que esconde erro de verdade. */
      id="quadro-tarefas"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Rolagem horizontal com scroll-snap: em telas menores o quadro
          "encaixa" coluna a coluna em vez de parar no meio de uma. */}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
        {TASK_COLUMNS.map(({ status, label }) => (
          <Column
            key={status}
            status={status}
            label={label}
            tasks={columns.get(status) ?? []}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
        {activeTask ? (
          <div className="w-[288px]">
            <TaskCardShell task={activeTask} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  label,
  tasks,
  onOpenTask,
}: {
  status: TaskStatus;
  label: string;
  tasks: TaskWithRelations[];
  onOpenTask: (id: string) => void;
}) {
  // Torna a coluna um alvo válido mesmo quando está vazia.
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });

  return (
    <section className="flex w-[288px] shrink-0 snap-start flex-col">
      <header className="mb-3 flex items-center gap-2 px-1">
        <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
        <h3 className="text-sm font-medium">{label}</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[140px] flex-1 flex-col gap-2 rounded-xl p-1.5 transition-colors",
          isOver ? "bg-signal-muted/45" : "bg-surface-2/40",
        )}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground/70">
            Arraste tarefas para cá
          </p>
        )}
      </div>
    </section>
  );
}
