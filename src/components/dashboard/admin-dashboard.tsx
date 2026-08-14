import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Target,
  Users,
} from "lucide-react";

import { GoalHealthChart } from "./goal-health-chart";
import { StatCard } from "./stat-card";
import { AgencyTrendChart } from "./agency-trend-chart";
import { SyncButton } from "@/components/admin/sync-button";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { getAgencyDashboard, getAgencyOverview } from "@/lib/data";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatDueDate } from "@/lib/format";
import { PersonAvatar } from "@/components/team/person-avatar";
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
  const [painel, agencia] = await Promise.all([
    getAgencyDashboard(),
    getAgencyOverview(),
  ]);
  const primeiroNome = user.full_name.split(" ")[0];

  return (
    <PageContainer>
      <PageHeader
        title={`Olá, ${primeiroNome}`}
        description="Torre de controle: a operação da agência inteira."
        actions={<SyncButton />}
      />

      {/* KPIs ---------------------------------------------------------- */}
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {/* Dinheiro primeiro: é a pergunta que o dono faz ao abrir. Os
            dois vêm somados de `daily_metrics`, não de coluna guardada —
            não existe `actual_spent` neste sistema, e um total congelado
            passaria a contradizer o painel do cliente assim que a Meta
            reatribuísse uma conversão. */}
        <StatCard
          icon={CircleDollarSign}
          label="Investimento gerenciado"
          value={formatCurrency(agencia.spendCents)}
          hint="somado no mês corrente"
        />
        <StatCard
          icon={Target}
          label="Resultados gerados"
          value={formatNumber(Math.round(agencia.results))}
          hint="conversões de todas as contas"
        />
        <StatCard
          icon={Activity}
          label="Ritmo das metas"
          value={`${agencia.noRitmo} no ritmo · ${agencia.atrasadas} abaixo`}
          hint={
            agencia.semMeta > 0
              ? `${agencia.semMeta} ${agencia.semMeta === 1 ? "conta sem meta" : "contas sem meta"} definida`
              : "todas as contas com meta"
          }
          tone={agencia.atrasadas > 0 ? "alerta" : "neutro"}
        />
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
      </div>

      {/* Investimento contra retorno, agência inteira ------------------
          Dado REAL, somado por dia de `daily_metrics`. Gráfico com série
          inventada é a armadilha que este projeto já pagou três vezes —
          e aqui seria pior, porque é a tela que decide onde mexer. */}
      <section className="surface-card mt-8 p-5">
        <h2 className="text-sm font-semibold">Investimento contra retorno</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Todas as contas somadas, dia a dia no mês corrente.
        </p>

        {agencia.trend.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-hairline px-4 py-10 text-center text-xs text-muted-foreground">
            Sem métrica sincronizada neste mês.
          </p>
        ) : (
          <div className="mt-5">
            <AgencyTrendChart data={agencia.trend} />
          </div>
        )}
      </section>

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
                            <PersonAvatar
                              key={p.id}
                              name={p.full_name}
                              avatarUrl={p.avatar_url}
                              className="size-6 ring-1 ring-hairline"
                              fallbackClassName="text-[10px]"
                            />
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
