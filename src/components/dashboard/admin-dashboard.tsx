import Link from "next/link";
import { Activity, CalendarClock, CircleDollarSign, Target, TrendingDown, TrendingUp } from "lucide-react";

import { StatCard } from "./stat-card";
import { MetaPorGrupo } from "./meta-por-grupo";
import { SyncButton } from "@/components/admin/sync-button";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { getAgencyDashboard, getVisaoDaCarteira } from "@/lib/data";
import { formatCurrencyCompact, formatDueDate, formatPercent } from "@/lib/format";
import { agrupar, pontas, resumir, textoDoRitmo, type ContaNaMeta } from "@/lib/metrics/visao-geral";
import { PersonAvatar } from "@/components/team/person-avatar";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/database";

/* =====================================================================
   Torre de controle — meta x executado
   ---------------------------------------------------------------------
   Refeita em 21/11/2026: saíram os totais de investimento, faturamento e
   retorno e o gráfico dia a dia ("não faço nada com isso"). A tela agora
   responde onde a carteira está contra a META: quantas contas estão no
   ritmo, quanto da verba já saiu, quais grupos e quais contas puxam
   cada ponta. A régua é a do card do cliente — `lib/metrics/visao-geral.ts`.

   O radar da equipe continua: o admin pergunta "onde está o problema e
   quem eu cobro", e o nome de quem responde é metade da resposta.
   ===================================================================== */

/** Acima disto, o card do dia vira alerta. */
const TAREFAS_DEMAIS = 8;

export async function AdminDashboard({ user }: { user: Profile }) {
  const [painel, contas] = await Promise.all([getAgencyDashboard(), getVisaoDaCarteira()]);
  const primeiroNome = user.full_name.split(" ")[0];

  const r = resumir(contas);
  const grupos = {
    segmento: agrupar(contas, "segmento"),
    squad: agrupar(contas, "squad"),
    agencia: agrupar(contas, "agencia"),
  };
  const { adiantadas, atrasadas } = pontas(contas);
  const pctVerba = r.verbaPlanejada > 0 ? r.gasto / r.verbaPlanejada : null;
  const pctEsperado = r.verbaPlanejada > 0 ? r.verbaEsperada / r.verbaPlanejada : null;

  return (
    <PageContainer>
      <PageHeader
        title={`Olá, ${primeiroNome}`}
        description="Torre de controle: a carteira contra a meta do mês."
        actions={<SyncButton />}
      />

      {/* Quatro números de decisão ------------------------------------- */}
      <div className="mt-7 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          icon={Activity}
          label="Contas no ritmo da meta"
          value={`${r.noRitmo} de ${r.comMeta}`}
          hint={`${r.atrasadas} ${r.atrasadas === 1 ? "atrasada" : "atrasadas"} contra o esperado para hoje`}
          tone={r.atrasadas > r.noRitmo ? "alerta" : "neutro"}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Verba do mês"
          value={
            r.verbaPlanejada > 0
              ? `${formatCurrencyCompact(r.gasto)} de ${formatCurrencyCompact(r.verbaPlanejada)}`
              : formatCurrencyCompact(r.gasto)
          }
          hint={
            pctVerba !== null && pctEsperado !== null
              ? `${formatPercent(pctVerba, 0)} gasto · esperado hoje ${formatPercent(pctEsperado, 0)}`
              : "nenhuma conta com verba planejada"
          }
        />
        <StatCard
          icon={Target}
          label="Contas sem meta"
          value={r.semMeta}
          hint="sem meta não há ritmo para medir"
          tone={r.semMeta > 0 ? "alerta" : "neutro"}
        />
        <StatCard
          icon={CalendarClock}
          label="Tarefas hoje"
          value={painel.tasksToday}
          hint="da equipe, incluindo atrasadas"
          /* Alerta só quando o volume é grande: marcar dois itens de
             vermelho ensinaria a ignorar a cor. */
          tone={painel.tasksToday > TAREFAS_DEMAIS ? "alerta" : "neutro"}
        />
      </div>
      {r.semMeta > 0 && (
        <p className="mt-2 text-2xs text-muted-foreground">
          Contas sem meta ficam fora do ritmo.{" "}
          <Link href="/clientes" className="underline underline-offset-2 hover:text-foreground">
            Definir em Clientes
          </Link>
          . Verba soma só contas em real.
        </p>
      )}

      <div className="mt-8">
        <MetaPorGrupo grupos={grupos} />
      </div>

      {/* As duas pontas -------------------------------------------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Pontas titulo="Mais adiantadas" icone={TrendingUp} contas={adiantadas} vazio="Nenhuma conta com meta e ritmo para ler." />
        <Pontas titulo="Mais atrasadas" icone={TrendingDown} contas={atrasadas} vazio="Nenhuma conta atrasada." />
      </div>

      <div className="mt-6">
        <section className="surface-card p-5">
          {/* `min-w-0` no filho de flex, senão ele se recusa a encolher.
              Sem isso, no celular a frase empurrava o "ver quadro" para
              fora do cartão e o link aparecia cortado como "ver qua…" —
              um link truncado no meio da palavra parece defeito, e é. */}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
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
    </PageContainer>
  );
}

/** Uma ponta do ranking: conta, executado x meta e o ritmo. */
function Pontas({
  titulo,
  icone: Icone,
  contas,
  vazio,
}: {
  titulo: string;
  icone: typeof TrendingUp;
  contas: ContaNaMeta[];
  vazio: string;
}) {
  return (
    <section className="surface-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icone className="size-4 text-muted-foreground" />
        {titulo}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Executado contra a meta do mês, e o ritmo contra o esperado hoje.</p>
      {contas.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-hairline">
          {contas.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0">
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                style={{ backgroundColor: c.cor ?? "#8a8a8a" }}
              />
              <div className="min-w-0 flex-1">
                <Link href={`/clientes/${c.slug}`} className="block truncate text-sm font-medium hover:underline">
                  {c.nome}
                </Link>
                <span className="text-2xs text-muted-foreground">
                  {c.executadoLabel} de {c.metaLabel} · {c.segmento}
                </span>
              </div>
              <span className={cn("shrink-0 text-sm font-semibold tabular-nums", textoDoRitmo(c.ritmo))}>
                {c.ritmo === null ? "—" : formatPercent(c.ritmo, 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
