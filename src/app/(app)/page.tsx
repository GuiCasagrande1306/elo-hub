import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CalendarClock, ListChecks, Users } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { GoalHealthChart } from "@/components/dashboard/goal-health-chart";
import { UrgentTasks } from "@/components/dashboard/urgent-tasks";
import { Sparkline } from "@/components/dashboard/sparkline";
import { SyncButton } from "@/components/admin/sync-button";
import {
  getClients,
  getMetricsWithComparison,
  getMyDashboard,
  lastNDays,
} from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildTrend, computeKpi, deriveMetric } from "@/lib/metrics/kpi";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Painel individual.
 *
 * ⚠️ MUDANÇA DE PREMISSA: esta página consolidava "o portfólio inteiro
 * que o usuário pode ver", contando com o RLS para filtrar. Isso deixou
 * de valer quando `clients` virou legível por toda a equipe — de lá para
 * cá, `getClients()` devolve a agência inteira para qualquer um, e o
 * "consolidado" de um colaborador passou a somar contas que não são
 * dele.
 *
 * Agora a carteira é explícita: `getMyDashboard` resolve por `owner_id`
 * e `client_members`, não pelo que o RLS deixa ler.
 */
export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [clients, painel] = await Promise.all([
    getClients(),
    getMyDashboard(user.id),
  ]);

  const minhasContas = clients.filter((c) => painel.myClientIds.includes(c.id));
  const { start, end } = lastNDays(30);

  // Uma consulta por conta, em paralelo — e só das minhas.
  const porConta = await Promise.all(
    minhasContas.map(async (client) => {
      const metrics = await getMetricsWithComparison(client.id, start, end);
      return { client, metrics, trend: buildTrend(metrics.current) };
    }),
  );

  const primeiroNome = user.full_name.split(" ")[0];

  return (
    <PageContainer>
      <PageHeader
        title={`Olá, ${primeiroNome}`}
        description="Sua operação de hoje: contas sob sua responsabilidade e o que vence."
        actions={user.role === "admin" ? <SyncButton /> : undefined}
      />

      {/* Linha 1 — produtividade -------------------------------------- */}
      <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:gap-4">
        <StatCard
          icon={Users}
          label="Minhas contas"
          value={painel.myClientIds.length}
          hint={
            painel.myClientIds.length === 0
              ? "nenhuma atribuída a você"
              : "sob sua responsabilidade"
          }
        />
        <StatCard
          icon={CalendarClock}
          label="Para hoje"
          value={painel.tasksToday}
          hint="inclui as atrasadas"
          /* Destaque só quando há o que fazer. Card vermelho marcando
             zero treina a pessoa a ignorar a cor. */
          tone={painel.tasksToday > 0 ? "alerta" : "neutro"}
        />
        <StatCard
          icon={ListChecks}
          label="Próximos 7 dias"
          value={painel.tasksWeek}
          hint="tarefas com prazo"
        />
      </div>

      {/* Linha 2 — análise e ação ------------------------------------- */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="surface-card p-5">
          <h2 className="text-sm font-semibold">Saúde das metas</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Resultados do período contra o previsto, nas suas contas.
          </p>

          <div className="mt-5">
            <GoalHealthChart health={painel.health} />
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">O que vence primeiro</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Suas cinco tarefas mais urgentes. Marque como feita sem sair
                daqui.
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
            <UrgentTasks tasks={painel.urgent} />
          </div>
        </section>
      </div>

      {/* Minhas contas ------------------------------------------------ */}
      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Minhas contas
          </h2>
          <Link
            href="/clientes"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            ver todas
          </Link>
        </div>

        {porConta.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline py-14 text-center">
            <Users className="mx-auto size-7 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">
              Nenhuma conta atribuída a você
            </p>
            <p className="mx-auto mt-1 max-w-[46ch] text-xs text-muted-foreground">
              Um administrador precisa vincular você às contas que vai
              atender. Enquanto isso, você continua vendo a carteira inteira
              em Clientes.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {porConta.map(({ client, metrics, trend }) => {
              const spend = metrics.currentTotals.spendCents;
              const results = deriveMetric("results", metrics.currentTotals);
              const cpaKpi = computeKpi(
                "cpa",
                metrics.currentTotals,
                metrics.previousTotals,
              );

              return (
                <Link
                  key={client.id}
                  href={`/clientes/${client.slug}`}
                  className="surface-card group flex flex-col p-4 transition-shadow hover:ring-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-6 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: client.brand_primary ?? "#8a8a8a" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {client.name}
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="eyebrow">Investido</p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-[-0.02em]">
                        {formatCurrency(spend)}
                      </p>
                    </div>
                    <Sparkline
                      id={`ov-${client.id}`}
                      data={trend.map((p) => p.spend)}
                      stroke="var(--chart-2)"
                      className="h-8 w-24 shrink-0"
                    />
                  </div>

                  <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatNumber(Math.round(results))} resultados
                    </span>
                    <span aria-hidden>•</span>
                    <span className="tabular-nums">CPA {cpaKpi.formatted}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </PageContainer>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutro",
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
  tone?: "neutro" | "alerta";
}) {
  return (
    <div
      className={cn(
        "surface-card flex items-start gap-3 p-4",
        tone === "alerta" && "ring-warning/35",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone === "alerta"
            ? "bg-warning-muted text-warning"
            : "bg-surface-2 text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none tracking-[-0.02em]">
          {value}
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
