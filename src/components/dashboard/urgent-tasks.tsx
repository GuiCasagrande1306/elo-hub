"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";

import { updateTask } from "@/app/(app)/tarefas/actions";
import { formatDueDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskWithRelations } from "@/types/database";

/* =====================================================================
   Ações rápidas
   ---------------------------------------------------------------------
   Concluir sem sair da home. A tarefa some da lista assim que o servidor
   confirma — some com `revalidatePath`, não com remoção otimista: marcar
   como feito é irreversível na percepção de quem clicou, e sumir antes
   da confirmação criaria o caso em que a tarefa reaparece depois.
   ===================================================================== */

export function UrgentTasks({ tasks }: { tasks: TaskWithRelations[] }) {
  const [concluindo, setConcluindo] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function concluir(taskId: string) {
    setConcluindo(taskId);
    startTransition(async () => {
      const r = await updateTask({ taskId, status: "done" });
      if (r.ok) toast.success("Tarefa concluída.");
      else toast.error(r.error);
      setConcluindo(null);
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <CheckCircle2 className="size-7 text-positive" />
        <p className="mt-3 text-sm font-medium">Tudo limpo por aqui!</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nenhuma tarefa com prazo em aberto.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-hairline">
      {tasks.map((task) => {
        const due = formatDueDate(task.due_date);
        const ocupado = concluindo === task.id;

        return (
          <li key={task.id} className="flex items-start gap-3 py-2.5 first:pt-0">
            <button
              type="button"
              onClick={() => concluir(task.id)}
              disabled={ocupado}
              aria-label={`Concluir: ${task.title}`}
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] ring-1 ring-hairline transition-colors hover:bg-positive-muted hover:ring-positive/40 disabled:opacity-50"
            >
              {ocupado && <Loader2 className="size-3 animate-spin" />}
            </button>

            <div className="min-w-0 flex-1">
              <Link
                href={`/tarefas?tarefa=${task.id}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {task.title}
              </Link>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                {task.client && (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{
                        backgroundColor: task.client.brand_primary ?? "#8a8a8a",
                      }}
                    />
                    {task.client.name}
                  </span>
                )}
                {due.label && (
                  <span
                    className={cn(
                      due.tone === "overdue" && "font-medium text-negative",
                      due.tone === "today" && "font-medium text-warning",
                    )}
                  >
                    {due.label}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
