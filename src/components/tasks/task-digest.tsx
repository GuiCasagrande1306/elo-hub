import Link from "next/link";

import { PRIORITY_STYLES, PRIORITY_WEIGHT } from "./task-meta";
import { cn } from "@/lib/utils";
import { formatDueDate } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/**
 * "Minhas tarefas" na visão geral.
 *
 * Mostra o que está atribuído ao usuário e ainda não foi concluído,
 * ordenado por urgência e depois por prazo. Máximo de 6 itens: uma lista
 * longa aqui rouba a atenção dos KPIs, que são o assunto da página.
 */
export function TaskDigest({
  tasks,
  currentUserId,
}: {
  tasks: TaskWithRelations[];
  currentUserId: string;
}) {
  const mine = tasks
    .filter(
      (task) =>
        task.status !== "done" &&
        task.assignees.some((a) => a.id === currentUserId),
    )
    .sort((a, b) => {
      const byPriority =
        PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (byPriority !== 0) return byPriority;
      return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
    })
    .slice(0, 6);

  return (
    <section className="surface-card flex flex-col p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-[-0.01em]">
          Minhas tarefas
        </h2>
        <Link
          href="/tarefas"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ver quadro
        </Link>
      </header>

      {mine.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nada pendente para você. 🎉
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {mine.map((task) => {
            const due = formatDueDate(task.due_date);
            return (
              <li key={task.id}>
                <Link
                  href={`/tarefas?tarefa=${task.id}`}
                  className="flex flex-col gap-1.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/60"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        PRIORITY_STYLES[task.priority],
                      )}
                    >
                      {task.priority === "urgent" ? "!" : task.priority === "high" ? "↑" : "–"}
                    </span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      {task.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pl-7 text-2xs text-muted-foreground">
                    {task.client && (
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: task.client.brand_primary ?? "#8a8a8a",
                          }}
                        />
                        {task.client.name}
                      </span>
                    )}
                    {due.label && (
                      <>
                        <span aria-hidden>•</span>
                        <span
                          className={cn(
                            due.tone === "overdue" && "font-medium text-negative",
                            due.tone === "today" && "font-medium text-warning",
                          )}
                        >
                          {due.label}
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
