import { Suspense } from "react";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { getClients, getTasks, getTeam } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tarefas" };

export default async function TasksPage() {
  const [tasks, clients, team, user] = await Promise.all([
    getTasks(),
    getClients(),
    /* A equipe vem de `profiles`, e não dos responsáveis já existentes:
       derivar de quem já está atribuído impediria atribuir a primeira
       tarefa de alguém — a pessoa nunca apareceria na lista. */
    getTeam(),
    getCurrentUser(),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Tarefas"
        description={
          user?.role === "admin"
            ? "Toda a operação da agência, por conta e por responsável."
            : "As tarefas atribuídas a você."
        }
      />

      <div className="mt-6">
        {/* `TasksWorkspace` usa `useSearchParams` (a tarefa aberta vive na
            URL), e o Next exige que isso fique sob um limite de Suspense
            para não desabilitar a renderização estática da rota inteira. */}
        <Suspense fallback={<BoardSkeleton />}>
          <TasksWorkspace
            tasks={tasks}
            clients={clients}
          team={team}
            corteConcluidas={corteConcluidas()}
          />
        </Suspense>
      </div>
    </PageContainer>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 4 }).map((_, column) => (
        <div key={column} className="flex w-[288px] shrink-0 flex-col gap-2">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          {Array.from({ length: 3 }).map((_, card) => (
            <div
              key={card}
              className="h-24 animate-pulse rounded-xl bg-muted/60"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Data a partir da qual uma tarefa concluída ainda aparece no quadro.
 *
 * Calculada no SERVIDOR e em granularidade de DIA. `Date.now()` dentro
 * do componente cliente daria valores diferentes no render do servidor e
 * no do navegador — divergência de hidratação — além de ser impuro
 * durante o render. Comparar strings ISO de data é estável.
 */
function corteConcluidas(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}
