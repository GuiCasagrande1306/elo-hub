import Link from "next/link";
import { AlertTriangle, CalendarClock, ListChecks, Users } from "lucide-react";

import { GoalHealthChart } from "./goal-health-chart";
import { StatCard } from "./stat-card";
import { SyncButton } from "@/components/admin/sync-button";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { getAgencyDashboard } from "@/lib/data";
import { formatDueDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

/* =====================================================================
   Torre de controle
   ---------------------------------------------------------------------
   O que muda em relação ao painel do colaborador não é o layout — é a
   PERGUNTA. O colaborador pergunta "o que eu faço agora"; o admin
   pergunta "onde está o problema e quem eu cobro".

   Por isso cada tarefa aqui mostra o responsável, e existe um bloco só
   de contas críticas: sem nome e sem recorte, a lista vira relatório
   para ler depois, não algo sobre o que agir hoje.
   ===================================================================== */

/** Acima disto, o card do dia vira alerta. */
const TAREFAS_DEMAIS = 8;

export async function AdminDashboard({ user }: { user: Profile }) {
  const painel = await getAgencyDashboard();
  const primeiroNome = user.full_name.split(" ")[0];

  return (
    <PageContainer>
      <PageHeader
        title={`Olá, ${primeiroNome}`}
        description="Torre de controle: a operação da agência inteira."
        actions={<SyncButton />}
      />

      {/* KPIs ---------------------------------------------------------- */}
      <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:gap-4">
        <StatCard
          icon={Users}
          label="Clientes ativos"
          value={painel.activeClients}
          hint="na carteira da agência"
        />
        <StatCard
          icon={CalendarClock}
          label="Tarefas hoje"
          value={painel.tasksToday}
          hint="da equipe, incluindo atrasadas"
          /* Alerta só quando o volume é grande. Um número alto de
             pendências do dia é sinal de gargalo; marcar dois itens de
             vermelho ensinaria a ignorar a cor. */
          tone={painel.tasksToday > TAREFAS_DEMAIS ? "alerta" : "neutro"}
        />
        <StatCard
          icon={ListChecks}
          label="Próximos 7 dias"
          value={painel.tasksWeek}
          hint="carga da equipe na semana"
        />
      </div>

      {/* Bloco principal ----------------------------------------------- */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="surface-card p-5">
          <h2 className="text-sm font-semibold">Saúde global das metas</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Todas as contas ativas, contra o previsto do período.
          </p>

          <div className="mt-5">
            <GoalHealthChart health={painel.health} />
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Radar da equipe</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                O que vence primeiro — e quem está com cada uma.
              </p>
            </div>
            <Link
              href="/tarefas"
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ver quadro
            </Link>
          </div>

          <div className="mt-4">
            {painel.urgent.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma tarefa com prazo em aberto na equipe.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-hairline">
                {painel.urgent.map((task) => {
                  const due = formatDueDate(task.due_date);

                  return (
                    <li
                      key={task.id}
                      className="flex items-start gap-3 py-2.5 first:pt-0"
                    >
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
                                  backgroundColor:
                                    task.client.brand_primary ?? "#8a8a8a",
                                }}
                              />
                              {task.client.name}
                            </span>
                          )}
                          {due.label && (
                            <span
                              className={cn(
                                due.tone === "overdue" &&
                                  "font-medium text-negative",
                                due.tone === "today" &&
                                  "font-medium text-warning",
                              )}
                            >
                              {due.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quem responde. É a diferença que justifica esta
                          tela existir separada da do colaborador. */}
                      <div className="flex shrink-0 items-center gap-1">
                        {task.assignees.length === 0 ? (
                          <span className="rounded-full bg-warning-muted px-2 py-0.5 text-[10px] font-medium text-warning">
                            sem responsável
                          </span>
                        ) : (
                          task.assignees.slice(0, 3).map((p) => (
                            <span
                              key={p.id}
                              title={p.full_name}
                              className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold ring-1 ring-hairline"
                            >
                              {initials(p.full_name)}
                            </span>
                          ))
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Contas em risco ----------------------------------------------- */}
      <section className="mt-6">
        <div className="surface-card p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={cn(
                "size-4",
                painel.atRisk.length > 0
                  ? "text-negative"
                  : "text-muted-foreground/50",
              )}
            />
            <h2 className="text-sm font-semibold">Contas em risco</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Abaixo de 50% da meta de resultados do período.
          </p>

          {painel.atRisk.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhuma conta crítica. Tudo dentro do previsto.
            </p>
          ) : (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {painel.atRisk.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clientes/${client.slug}`}
                    className="flex items-center gap-2.5 rounded-lg border border-negative/25 bg-negative-muted/25 px-3 py-2.5 transition-colors hover:bg-negative-muted/40"
                  >
                    <span
                      aria-hidden
                      className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{
                        backgroundColor: client.brand_primary ?? "#8a8a8a",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {client.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </PageContainer>
  );
}
