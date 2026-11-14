"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CalendarClock, FileDown, Globe, ListPlus, ShieldAlert, SquarePen } from "lucide-react";

import { KpiCard } from "./kpi-card";
import { AdGallery } from "./ad-gallery";
import { ClientSettingsCard } from "@/components/clients/client-settings-card";
import { LinkDoRelatorio } from "@/components/clients/link-do-relatorio";
import { ClientSettingsDialog } from "@/components/clients/client-settings-dialog";
import { AdStructure } from "@/components/dashboard/ad-structure";
import { CamposEditaveis } from "@/components/clients/ficha/campos-editaveis";
import { ListaEditavel, NovoItemDialog } from "@/components/clients/ficha/lista-editavel";
import { LinhaDoTempo, RegistrarNaLinhaDoTempo } from "@/components/clients/ficha/linha-do-tempo";
import { NovaTarefa, TarefasAbertas } from "@/components/clients/ficha/tarefas-do-cliente";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtimeRefresh, useRefreshAoVoltar } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { MoedaProvider } from "@/lib/moeda";
import { DateRangePicker } from "./date-range-picker";
import { formatDate, formatPeriod } from "@/lib/format";
import type { KpiResult } from "@/lib/metrics/kpi";
import type { GoalProgressPair } from "@/lib/metrics/goals";
import type { GoalHistoryEntry, IntegrationStatus, MonthlyGoalStatus } from "@/lib/data";
import type { SaudeAtual } from "@/lib/clientes/dados";
import { SECOES_DE_CAMPOS, SECOES_DE_LISTA } from "@/lib/clientes/ficha";
import { GoalBar } from "@/components/clients/goal-bar";
import { GoalHistory } from "@/components/clients/goal-history";
import { MonthlyGoalAlert } from "@/components/clients/monthly-goal-alert";
import type {
  AdCreative,
  Client,
  EntradaDaLinhaDoTempo,
  Profile,
  TaskWithRelations,
} from "@/types/database";

/* =====================================================================
   ClientDashboard — página do cliente em abas
   ---------------------------------------------------------------------
   Reorganizada em 14/11/2026 a pedido da equipe: saíram os gráficos que
   ninguém consultava (evolução diária, canais, sparklines) e entrou a
   FICHA do cliente — o que é preciso saber para atender a conta.

     Topo: identidade, squad, briefing, cliente desde, saúde da conta.
     Abas: Resumo · Mapa do Negócio · Metas e resultados · Regras da
           conta · Preferências · Linha do tempo · Acessos e ativos.

   Componente DE APRESENTAÇÃO: recebe tudo calculado. Números vêm de
   `lib/metrics`, a ficha de `clients.ficha` (`lib/clientes/ficha.ts`).
   ===================================================================== */

export interface ClientDashboardProps {
  client: Client;
  /** Agências do cadastro, para o seletor do diálogo de configurações. */
  agencias: string[];
  /** Investimento, Resultados e Custo por Resultado — nesta ordem. */
  kpis: KpiResult[];
  creatives: AdCreative[];
  period: {
    start: string;
    end: string;
    days: number;
    /** Intervalo escolhido no calendário, não um preset. */
    custom?: boolean;
  };
  /** Dias disponíveis no seletor. */
  presets?: number[];
  integrations: IntegrationStatus[];
  goal: {
    plannedBudgetCents: number;
    plannedResults: number;
    resultsMetric: "count" | "revenue" | null;
  } | null;
  /** Meta do mês corrente e se ela ainda precisa ser preenchida. */
  goalStatus: MonthlyGoalStatus;
  goalHistory: GoalHistoryEntry[];
  /** Progresso e projeção do mês da meta. `null` = sem meta no período. */
  goalProgress: {
    progress: GoalProgressPair | null;
    period: { start: string; end: string } | null;
  } | null;
  /* Rótulos do que a conta mede — "Visitas ao perfil"/"Custo por
     visita". Vêm prontos do servidor, da mesma função que nomeia os KPIs. */
  resultLabel: string;
  costLabel: string;
  linhaDoTempo: EntradaDaLinhaDoTempo[];
  saude: SaudeAtual | null;
  responsaveis: Pick<Profile, "id" | "full_name" | "role">[];
  tarefas: TaskWithRelations[];
}

const ABAS = [
  { valor: "resumo", rotulo: "Resumo" },
  { valor: "mapa", rotulo: "Mapa do Negócio" },
  { valor: "metas", rotulo: "Metas e resultados" },
  { valor: "regras", rotulo: "Regras da conta" },
  { valor: "preferencias", rotulo: "Preferências" },
  { valor: "linha", rotulo: "Linha do tempo" },
  { valor: "acessos", rotulo: "Acessos e ativos" },
];

export function ClientDashboard({
  agencias,
  client,
  kpis,
  creatives,
  period,
  presets = [7, 30, 90],
  integrations,
  goal,
  goalStatus,
  goalHistory,
  goalProgress,
  resultLabel,
  costLabel,
  linhaDoTempo,
  saude,
  responsaveis,
  tarefas,
}: ClientDashboardProps) {
  // Qualquer sync de métricas revalida esta página para quem está nela.
  /* Rede de segurança independente do socket: evento perdido enquanto
     a aba esteve escondida não chega por Realtime nenhum. */
  useRefreshAoVoltar();
  useRealtimeRefresh("daily_metrics", { filter: `client_id=eq.${client.id}` });

  const ficha = client.ficha ?? {};
  const perfil = ficha.perfil ?? {};
  const regrasCriticas = (ficha.regras ?? []).filter(
    (r) => r.categoria === "nao_pode" || r.categoria === "obrigatorio",
  );

  return (
    /* Toda formatação de dinheiro abaixo usa a moeda da conta de anúncio
       (US$ para conta cadastrada nos EUA). Ver `lib/moeda.tsx`. */
    <MoedaProvider value={client.ad_currency}>
    <div className="flex flex-col">
      {/* ================= TOPO ================= */}
      <section className="glow-signal relative overflow-hidden border-b border-hairline">
        <div className="grid-hairline pointer-events-none absolute inset-0 opacity-[0.35]" />

        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-6 pt-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <ClientMark client={client} />

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">
                    {client.name}
                  </h1>
                  <StatusPill status={client.status} />
                  {perfil.squad && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-medium ring-1 ring-hairline">
                      {perfil.squad}
                    </span>
                  )}
                </div>

                <p className="mt-1.5 text-sm text-muted-foreground">
                  {[perfil.briefing || SEGMENT_LABELS[client.segment], perfil.cidade]
                    .filter(Boolean)
                    .join(" · ")}
                  {client.website && (
                    <>
                      {" · "}
                      <a
                        href={client.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        <Globe className="size-3.5" />
                        site
                      </a>
                    </>
                  )}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs">
                  {client.contract_start && (
                    <span className="text-muted-foreground">
                      Cliente desde {formatDate(`${client.contract_start}T12:00:00`)}
                    </span>
                  )}
                  <SeloDaSaude saude={saude} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PeriodSelector
                slug={client.slug}
                presets={presets}
                start={period.start}
                end={period.end}
                custom={Boolean(period.custom)}
                current={period.days}
              />
              <ClientSettingsDialog
                agencias={agencias}
                client={client}
                integrations={integrations}
                segment={client.segment}
              />
              {/* Ao lado de "Gerar relatório" de propósito: são as duas
                  formas de entregar o MESMO documento. */}
              <LinkDoRelatorio clientId={client.id} />
              {/* `nativeButton={false}` é obrigatório ao renderizar como <a>. */}
              <Button
                size="sm"
                className="h-9"
                nativeButton={false}
                /* LEVA A CONTA JUNTO: sem o slug a estação abria na
                   primeira conta da carteira. */
                render={<Link href={`/relatorios?cliente=${client.slug}`} />}
              >
                <FileDown className="size-4" />
                Gerar relatório
              </Button>
            </div>
          </div>

          {/* Ações do dia a dia ---------------------------------------- */}
          <div className="mt-5 flex flex-wrap gap-2">
            <RegistrarNaLinhaDoTempo clientId={client.id}>
              {(abrir) => (
                <Button size="sm" variant="outline" onClick={abrir}>
                  <CalendarClock className="size-3.5" />
                  Registrar reunião
                </Button>
              )}
            </RegistrarNaLinhaDoTempo>
            <NovoItemDialog
              clientId={client.id}
              secao="regras"
              definicao={SECOES_DE_LISTA.regras}
              titulo="Nova regra da conta"
            >
              {(abrir) => (
                <Button size="sm" variant="outline" onClick={abrir}>
                  <ShieldAlert className="size-3.5" />
                  Nova regra
                </Button>
              )}
            </NovoItemDialog>
            <NovaTarefa clientId={client.id}>
              {(abrir) => (
                <Button size="sm" onClick={abrir}>
                  <ListPlus className="size-3.5" />
                  Nova tarefa
                </Button>
              )}
            </NovaTarefa>
          </div>
        </div>
      </section>

      {/* ================= ABAS ================= */}
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <Tabs defaultValue="resumo">
          {/* Rola na horizontal no celular: 7 abas não cabem em 375px. */}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="w-max">
              {ABAS.map((a) => (
                <TabsTrigger key={a.valor} value={a.valor} className="flex-none px-3">
                  {a.rotulo}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ---------------- RESUMO ---------------- */}
          <TabsContent value="resumo" className="mt-6 flex flex-col gap-6">
            {goalStatus.needsGoal && (
              <MonthlyGoalAlert
                clientId={client.id}
                segment={client.segment}
                referenceMonth={goalStatus.referenceMonth}
              />
            )}

            <div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                {kpis.map((kpi, index) => (
                  <KpiCard key={kpi.key} kpi={kpi} index={index} emphasis={index === 0} />
                ))}
              </div>
              <p className="mt-2 text-2xs text-muted-foreground">
                {formatPeriod(period.start, period.end)} · comparação com os {period.days} dias anteriores
              </p>
            </div>

            <MetaDoMes goalProgress={goalProgress} />

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="surface-card p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="size-4 text-warning" />
                  Antes de mexer na conta
                </h2>
                {regrasCriticas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma regra de &ldquo;não pode&rdquo; ou &ldquo;obrigatório&rdquo; registrada.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {regrasCriticas.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-sm">
                        <span
                          className={cn(
                            "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium",
                            r.categoria === "nao_pode"
                              ? "bg-negative-muted text-negative"
                              : "bg-warning-muted text-warning",
                          )}
                        >
                          {r.categoria === "nao_pode" ? "Não pode" : "Obrigatório"}
                        </span>
                        <span className="min-w-0 break-words">{r.texto}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <ListaEditavel
                clientId={client.id}
                secao="pendencias"
                titulo="Pendências do cliente"
                descricao="O que o cliente ficou de enviar ou liberar."
                definicao={SECOES_DE_LISTA.pendencias}
                itens={ficha.pendencias}
                vazio="Nenhuma pendência."
              />

              <TarefasAbertas tarefas={tarefas} />

              <section className="surface-card p-5">
                <h2 className="mb-3 text-sm font-semibold">Responsáveis</h2>
                {responsaveis.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ninguém vinculado a esta conta.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {responsaveis.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>{r.full_name}</span>
                        {r.id === client.owner_id && (
                          <span className="text-2xs text-muted-foreground">Dono da conta</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <LinhaDoTempo clientId={client.id} entradas={linhaDoTempo.slice(0, 3)} compacta />

            <section>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.015em]">Anúncios ativos</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Criativos no ar agora, com o desempenho individual de cada um.
                  </p>
                </div>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {creatives.length} criativos
                </span>
              </div>
              <AdGallery creatives={creatives} moeda={client.ad_currency} />
            </section>

            <AdStructure
              clientId={client.id}
              since={period.start}
              until={period.end}
              resultLabel={resultLabel}
              costLabel={costLabel}
            />
          </TabsContent>

          {/* ---------------- MAPA DO NEGÓCIO ---------------- */}
          <TabsContent value="mapa" className="mt-6 flex flex-col gap-6">
            <CamposEditaveis
              clientId={client.id}
              secao="perfil"
              titulo="Perfil"
              descricao="Aparece no topo da página."
              definicao={SECOES_DE_CAMPOS.perfil}
              valores={ficha.perfil}
            />
            <CamposEditaveis
              clientId={client.id}
              secao="mapa"
              titulo="Mapa do Negócio"
              descricao="Levantado na reunião de onboarding."
              definicao={SECOES_DE_CAMPOS.mapa}
              valores={ficha.mapa}
            />
          </TabsContent>

          {/* ---------------- METAS E RESULTADOS ---------------- */}
          <TabsContent value="metas" className="mt-6 flex flex-col gap-6">
            <CamposEditaveis
              clientId={client.id}
              secao="metas"
              titulo="Metas combinadas"
              descricao="KPI principal, metas de 30, 60 e 90 dias e a verba acertada com o cliente."
              definicao={SECOES_DE_CAMPOS.metas}
              valores={ficha.metas}
            />
            <MetaDoMes goalProgress={goalProgress} />
            <GoalHistory entries={goalHistory} />
            {/* Meta do mês (orçamento e resultados) e a zona de risco. */}
            <div id="ajustes" className="scroll-mt-20" />
            <ClientSettingsCard client={client} goal={goal} />
          </TabsContent>

          {/* ---------------- REGRAS DA CONTA ---------------- */}
          <TabsContent value="regras" className="mt-6">
            <ListaEditavel
              clientId={client.id}
              secao="regras"
              titulo="Regras da conta"
              descricao="O que não pode, o que é obrigatório e o que o cliente prefere."
              definicao={SECOES_DE_LISTA.regras}
              itens={ficha.regras}
              rotuloDoNovo="Nova regra"
              filtrarPor="categoria"
              vazio="Nenhuma regra registrada."
            />
          </TabsContent>

          {/* ---------------- PREFERÊNCIAS ---------------- */}
          <TabsContent value="preferencias" className="mt-6 flex flex-col gap-6">
            <CamposEditaveis
              clientId={client.id}
              secao="atendimento"
              titulo="Como atender"
              definicao={SECOES_DE_CAMPOS.atendimento}
              valores={ficha.atendimento}
              colunas={2}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <ListaEditavel
                clientId={client.id}
                secao="contatos"
                titulo="Contatos no cliente"
                definicao={SECOES_DE_LISTA.contatos}
                itens={ficha.contatos}
                rotuloDoNovo="Novo contato"
                vazio="Nenhum contato registrado."
              />
              <ListaEditavel
                clientId={client.id}
                secao="datas"
                titulo="Datas para lembrar"
                definicao={SECOES_DE_LISTA.datas}
                itens={ficha.datas}
                rotuloDoNovo="Nova data"
                vazio="Nenhuma data registrada."
              />
            </div>
          </TabsContent>

          {/* ---------------- LINHA DO TEMPO ---------------- */}
          <TabsContent value="linha" className="mt-6">
            <LinhaDoTempo clientId={client.id} entradas={linhaDoTempo} />
          </TabsContent>

          {/* ---------------- ACESSOS E ATIVOS ---------------- */}
          <TabsContent value="acessos" className="mt-6 flex flex-col gap-6">
            <ListaEditavel
              clientId={client.id}
              secao="acessos"
              titulo="Acessos"
              descricao="Onde cada acesso está guardado. Senha NUNCA vai aqui — só o lugar onde ela está."
              definicao={SECOES_DE_LISTA.acessos}
              itens={ficha.acessos}
              rotuloDoNovo="Novo acesso"
              vazio="Nenhum acesso registrado."
            />
            <CamposEditaveis
              clientId={client.id}
              secao="ativos"
              titulo="Ativos"
              definicao={SECOES_DE_CAMPOS.ativos}
              valores={ficha.ativos}
              colunas={2}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
    </MoedaProvider>
  );
}

/* Saúde da última otimização da esteira, e há quanto tempo está nessa cor. */
const SAUDE: Record<SaudeAtual["cor"], { rotulo: string; ponto: string }> = {
  green: { rotulo: "Conta verde", ponto: "bg-emerald-500" },
  yellow: { rotulo: "Conta amarela", ponto: "bg-amber-400" },
  red: { rotulo: "Conta vermelha", ponto: "bg-red-500" },
};

function SeloDaSaude({ saude }: { saude: SaudeAtual | null }) {
  if (!saude) {
    return <span className="text-muted-foreground">Saúde não marcada na esteira</span>;
  }
  const s = SAUDE[saude.cor];
  const { dias } = saude;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-medium ring-1 ring-hairline">
      <span className={cn("size-2 rounded-full", s.ponto)} aria-hidden />
      {s.rotulo}
      <span className="font-normal text-muted-foreground">
        {dias === 0 ? "desde hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`}
      </span>
    </span>
  );
}

/* Meta do mês: SEMPRE o mês da meta, não o período do seletor — por
   isso o intervalo aparece escrito. */
function MetaDoMes({ goalProgress }: { goalProgress: ClientDashboardProps["goalProgress"] }) {
  if (!goalProgress?.progress) return null;
  return (
    <section className="surface-card p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
          <SquarePen className="size-4 text-muted-foreground" />
          Meta do mês
        </h2>
        {goalProgress.period && (
          <span className="text-2xs tabular-nums text-muted-foreground">
            {formatPeriod(goalProgress.period.start, goalProgress.period.end)}
            {goalProgress.progress.cycle.daysLeft > 0 && (
              <> · faltam {goalProgress.progress.cycle.daysLeft} dias</>
            )}
          </span>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <GoalBar progress={goalProgress.progress.budget} />
        <GoalBar progress={goalProgress.progress.results} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Marca do cliente: logo quando existe, senão um monograma na cor
 * primária da marca. Evita o buraco cinza que todo CRM tem quando o
 * cliente ainda não subiu logo.
 */
function ClientMark({ client }: { client: Client }) {
  const letters = client.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (client.logo_url) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável. */}
        <img
          src={client.logo_url}
          alt={client.name}
          className="size-full object-contain"
        />
      </span>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
      style={{
        background: client.brand_primary
          ? `linear-gradient(140deg, ${client.brand_primary}, color-mix(in oklab, ${client.brand_primary} 68%, black))`
          : "var(--surface-2)",
      }}
    >
      {letters}
    </motion.div>
  );
}

const STATUS_STYLES: Record<Client["status"], { label: string; className: string }> =
  {
    active: { label: "Ativo", className: "bg-positive-muted text-positive" },
    onboarding: { label: "Onboarding", className: "bg-warning-muted text-warning" },
    paused: { label: "Pausado", className: "bg-muted text-muted-foreground" },
    lead: { label: "Lead", className: "bg-muted text-muted-foreground" },
    churned: { label: "Encerrado", className: "bg-negative-muted text-negative" },
  };

function StatusPill({ status }: { status: Client["status"] }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-2xs font-medium",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}

const SEGMENT_LABELS: Record<Client["segment"], string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

/**
 * Seletor de período por LINK, não por estado.
 * O período vive na URL: a tela fica compartilhável, o botão voltar
 * funciona, e o Server Component refaz a query já com a nova janela —
 * sem cascata de loading no cliente.
 */
function PeriodSelector({
  slug,
  presets,
  current,
  start,
  end,
  custom,
}: {
  slug: string;
  presets: number[];
  current: number;
  start: string;
  end: string;
  custom: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
    <div
      className="flex items-center gap-0.5 rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline"
      role="group"
      aria-label="Período"
    >
      {presets.map((days) => {
        /* Com intervalo do calendário, NENHUM preset acende: manter
           "30d" iluminado enquanto a tela mostra outra janela é a
           versão visual de mentir sobre o período. */
        const active = !custom && days === current;
        return (
          <Link
            key={days}
            href={`/clientes/${slug}?periodo=${days}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "relative rounded-[7px] px-2.5 py-1.5 text-xs font-medium tabular-nums transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="period-pill"
                className="absolute inset-0 rounded-[7px] bg-background ring-1 ring-hairline"
                transition={{ type: "spring", stiffness: 480, damping: 40 }}
              />
            )}
            <span className="relative">{days}d</span>
          </Link>
        );
      })}
    </div>

    <DateRangePicker slug={slug} start={start} end={end} active={custom} />
    </div>
  );
}
