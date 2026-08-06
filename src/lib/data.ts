import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTrend, previousPeriod, sumMetrics } from "@/lib/metrics/kpi";
import { buildGoalProgress } from "@/lib/metrics/goals";
import {
  goalExecutedFrom,
  goalMetricFor,
  type GoalMetric,
  type GoalMetricKey,
} from "@/lib/metrics/goal-metric";
import {
  dataNoBrasil,
  diaDaSemanaNoBrasil,
  inicioDoDiaBR,
  intervaloDoMes,
  mesCorrenteBR,
  segundaDestaSemana,
} from "@/lib/date-br";
import type {
  AdCreative,
  Client,
  ClientGoal,
  ClientSegment,
  DailyMetric,
  FinancialTransaction,
  MonthlySummary,
  OptimizationEntry,
  Profile,
  ReportHistory,
  ReportTemplate,
  TaskWithRelations,
} from "@/types/database";

/**
 * Camada de acesso a dados (DAL).
 *
 * Ponto único onde a aplicação lê do banco. Duas razões:
 *
 *  1. Alternância demo/real fica isolada aqui — nenhuma página precisa
 *     saber se existe Supabase configurado.
 *  2. Toda leitura passa pelo cliente com RLS. Não há caminho "por
 *     fora": o filtro de permissão é do Postgres, não da aplicação, e
 *     por isso não dá para esquecer de aplicá-lo numa query nova.
 *
 * Em demo, os filtros de permissão são simulados em memória para que a
 * diferença entre admin e colaborador seja visível na interface.
 */

/* ------------------------------------------------------------------ */
/* Clientes                                                            */
/* ------------------------------------------------------------------ */

export async function getClients(agency?: string): Promise<Client[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return agency
      ? demoClients.filter((c) => c.agency_partner === agency)
      : demoClients;
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("clients").select("*").order("name");

  /* Filtro no BANCO, não em memória: os totais do topo somam sobre esta
     mesma lista, então filtrar depois faria os cards mostrarem uma
     carteira e o resumo somar outra. */
  if (agency) query = query.eq("agency_partner", agency);

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as Client[];
}

export async function getClientBySlug(slug: string): Promise<Client | null> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.find((c) => c.slug === slug) ?? null;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  return (data as Client) ?? null;
}

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

export async function getMetrics(
  clientId: string,
  start: string,
  end: string,
): Promise<DailyMetric[]> {
  if (isDemoMode) {
    const { demoMetrics } = await import("@/lib/mock/data");
    return demoMetrics.filter(
      (m) =>
        m.client_id === clientId &&
        m.metric_date >= start &&
        m.metric_date <= end,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("daily_metrics")
    .select("*")
    .eq("client_id", clientId)
    .gte("metric_date", start)
    .lte("metric_date", end)
    .order("metric_date");

  if (error) throw error;
  return (data ?? []) as DailyMetric[];
}

/**
 * Métricas do período + do período anterior equivalente.
 * Uma chamada só, porque todo card de KPI precisa da comparação — pedir
 * separado dobraria o número de round-trips da página.
 */
export async function getMetricsWithComparison(
  clientId: string,
  start: string,
  end: string,
) {
  const prev = previousPeriod(start, end);

  const [current, previous] = await Promise.all([
    getMetrics(clientId, start, end),
    getMetrics(clientId, prev.start, prev.end),
  ]);

  return {
    current,
    previous,
    currentTotals: sumMetrics(current),
    previousTotals: sumMetrics(previous),
    period: { start, end, days: prev.days },
    previousPeriod: prev,
  };
}

export async function getCreatives(
  clientId: string,
  limit = 6,
): Promise<AdCreative[]> {
  if (isDemoMode) {
    const { demoCreatives } = await import("@/lib/mock/data");
    return demoCreatives
      .filter((c) => c.client_id === clientId && c.is_active)
      .sort((a, b) => b.spend_cents - a.spend_cents)
      .slice(0, limit);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("spend_cents", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AdCreative[];
}

/* ------------------------------------------------------------------ */
/* Metas                                                               */
/* ------------------------------------------------------------------ */

/** Meta vigente hoje para cada cliente acessível, indexada por client_id. */
export async function getCurrentGoals(): Promise<Map<string, ClientGoal>> {
  const today = new Date().toISOString().slice(0, 10);

  if (isDemoMode) {
    const { demoGoals } = await import("@/lib/mock/data");
    return new Map(
      demoGoals
        .filter((g) => g.period_start <= today && g.period_end >= today)
        .map((g) => [g.client_id, g]),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_goals")
    .select("*")
    .lte("period_start", today)
    .gte("period_end", today);

  if (error) throw error;
  return new Map((data ?? []).map((g) => [g.client_id, g as ClientGoal]));
}

/** Metas cujo período começa num mês específico, indexadas por cliente. */
async function getGoalsForMonth(
  monthStart: string,
): Promise<Map<string, ClientGoal>> {
  if (isDemoMode) {
    const { demoGoals } = await import("@/lib/mock/data");
    return new Map(
      demoGoals
        .filter((g) => g.period_start === monthStart)
        .map((g) => [g.client_id, g]),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("client_goals")
    .select("*")
    .eq("period_start", monthStart);

  return new Map((data ?? []).map((g) => [g.client_id, g as ClientGoal]));
}

/**
 * Clientes + meta vigente + o que já foi executado no período da meta.
 *
 * O executado é AGREGADO de `daily_metrics`, não lido de uma coluna —
 * é o que garante que o card não divirja do dashboard. A janela usada
 * é a da meta, não os últimos 30 dias, senão "planejado vs executado"
 * compararia períodos diferentes.
 */
export interface ClientWithGoal {
  client: Client;
  goal: ClientGoal | null;
  computedSpendCents: number;
  /** Conversões contadas — sempre presente, seja qual for a meta. */
  computedResults: number;
  computedRevenueCents: number;
  /**
   * O indicador desta conta. Resolvido no servidor porque depende da
   * unidade GRAVADA na meta, não só do segmento do cliente.
   */
  metric: GoalMetric;
  /** Executado já na unidade de `metric` — o que o card exibe. */
  computedGoalValue: number;
  /** Série de gasto no período da meta, para a sparkline do card. */
  trend: number[];
  /**
   * Progresso JÁ CALCULADO no servidor.
   *
   * Não é recalculado no cliente na primeira renderização de propósito:
   * o cálculo depende de "hoje", e servidor (UTC) e navegador (UTC-3)
   * discordam sobre a data durante três horas por dia — o que produzia
   * divergência de hidratação no marcador de ritmo.
   */
  progress: ReturnType<typeof buildGoalProgress>;
}

/**
 * Carteira com meta e executado.
 *
 * `month` ("2026-07") fixa o período em vez de usar a meta vigente hoje.
 * Sem ele o comportamento é o de sempre: meta que cobre a data corrente.
 *
 * A janela de métrica passa a ser SEMPRE a do mês pedido, mesmo quando
 * não há meta cadastrada — foi isso que permitiu o mês passado aparecer
 * com investimento e resultados reais e o rótulo de meta vazio, em vez
 * de um card mudo.
 */
export async function getClientsWithGoals(
  month?: string,
  agency?: string,
): Promise<ClientWithGoal[]> {
  const periodo = month ? intervaloDoMes(month) : null;

  const [clients, goals] = await Promise.all([
    getClients(agency),
    periodo ? getGoalsForMonth(periodo.start) : getCurrentGoals(),
  ]);

  return Promise.all(
    clients.map(async (client) => {
      const goal = goals.get(client.id) ?? null;

      /* Com mês escolhido, a janela é o mês — não o período da meta.
         Do contrário, um mês sem meta cairia no mês corrente e o card
         mostraria número de agosto sob o rótulo de julho. */
      const start = periodo?.start ?? goal?.period_start ?? monthStartISO();
      const end = periodo?.end ?? goal?.period_end ?? todayISO();

      const rows = await getMetrics(client.id, start, end);
      const totals = sumMetrics(rows);

      /* O segmento diz o padrão; a meta gravada diz a verdade. Sem meta
         no período cai no padrão do segmento, que é o que o card sem
         meta precisa para rotular o número que mostra. */
      const metric = goalMetricFor(client.segment, goal?.results_metric);

      return {
        client,
        goal,
        metric,
        computedSpendCents: totals.spendCents,
        computedResults: totals.conversions,
        computedRevenueCents: totals.revenueCents,
        computedGoalValue: goalExecutedFrom(metric, totals),
        trend: buildTrend(rows).map((p) => p.spend),
        progress: buildGoalProgress({
          goal,
          metric,
          computedSpendCents: totals.spendCents,
          computedConversions: totals.conversions,
          computedRevenueCents: totals.revenueCents,
        }),
      };
    }),
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

export async function getTasks(options?: {
  clientId?: string;
}): Promise<TaskWithRelations[]> {
  if (isDemoMode) {
    const { demoTasks, demoCurrentUser } = await import("@/lib/mock/data");

    // Espelha em memória o que o RLS faria: colaborador enxerga apenas
    // tarefas em que foi atribuído.
    const visible =
      demoCurrentUser.role === "admin"
        ? demoTasks
        : demoTasks.filter((t) =>
            t.assignees.some((a) => a.id === demoCurrentUser.id),
          );

    return options?.clientId
      ? visible.filter((t) => t.client_id === options.clientId)
      : visible;
  }

  const supabase = await createSupabaseServerClient();

  // O embed traz atribuídos e checklist num único round-trip. As policies
  // de RLS são aplicadas em CADA tabela do embed, inclusive nas aninhadas.
  let query = supabase
    .from("tasks")
    .select(
      `
      *,
      assignees:task_assignees(profile:profiles(*)),
      checklist:task_checklist_items(*),
      client:clients(id, name, brand_primary),
      project:projects(id, name, color)
    `,
    )
    .order("position");

  if (options?.clientId) query = query.eq("client_id", options.clientId);

  const { data, error } = await query;
  if (error) throw error;

  type AssigneeRow = { profile: Profile | null };

  // O embed devolve `[{ profile: {...} }]`; a UI quer `Profile[]`.
  return (data ?? []).map((row) => {
    const { assignees, ...task } = row as unknown as Record<string, unknown> & {
      assignees: AssigneeRow[] | null;
    };
    return {
      ...task,
      assignees: (assignees ?? [])
        .map((entry: AssigneeRow) => entry.profile)
        .filter((profile): profile is Profile => profile !== null),
    };
  }) as unknown as TaskWithRelations[];
}

export async function getTeam(): Promise<Profile[]> {
  if (isDemoMode) {
    const { demoProfiles } = await import("@/lib/mock/data");
    return demoProfiles;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .order("full_name");

  return (data ?? []) as Profile[];
}

/* ------------------------------------------------------------------ */
/* Relatórios                                                          */
/* ------------------------------------------------------------------ */

export async function getReportTemplates(): Promise<ReportTemplate[]> {
  if (isDemoMode) {
    const { demoTemplates } = await import("@/lib/mock/data");
    return demoTemplates;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("report_templates")
    .select("*")
    .eq("is_archived", false)
    .order("name");

  return (data ?? []) as ReportTemplate[];
}

/** Template do segmento do cliente, com queda para o genérico. */
export async function getTemplateForClient(
  client: Client,
): Promise<ReportTemplate | null> {
  const templates = await getReportTemplates();

  /* Só o segmento decide. O encadeamento antigo caía num
     `templates[0]` quando não achava — depois que os templates
     genéricos deixaram de existir, isso significava mandar ao cliente
     um PDF de OUTRO nicho, sem erro nenhum. Devolver null faz o
     chamador falhar com mensagem, que é o comportamento correto:
     todo segmento tem template, e não ter é defeito de dado. */
  return (
    templates.find((t) => t.segment === client.segment && t.is_default) ??
    templates.find((t) => t.segment === client.segment) ??
    null
  );
}

export async function getReports(clientId?: string): Promise<ReportHistory[]> {
  if (isDemoMode) {
    const { demoReports } = await import("@/lib/mock/data");
    return clientId
      ? demoReports.filter((r) => r.client_id === clientId)
      : demoReports;
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("report_history")
    .select("*")
    .order("created_at", { ascending: false });

  if (clientId) query = query.eq("client_id", clientId);

  const { data } = await query;
  return (data ?? []) as ReportHistory[];
}

/* ------------------------------------------------------------------ */
/* Financeiro — só admin passa pelo RLS                                */
/* ------------------------------------------------------------------ */

/**
 * Lançamentos e resumo mensal.
 *
 * Não há checagem de papel aqui: a policy `financial_admin_only` faz o
 * banco recusar. Um colaborador recebe erro de privilégio, não uma
 * lista vazia — a diferença importa, porque lista vazia sugeriria "não
 * há lançamentos".
 */
/**
 * Honorário contratado por cliente, indexado por id.
 *
 * Vive em `client_financials`, cuja policy é `app.is_admin()`. Um
 * colaborador recebe lista vazia — não erro —, então o MRR aparece
 * zerado em vez de a página quebrar. É o comportamento certo: a rota
 * `/gestao` já é de admin, e isto é a segunda barreira.
 */
export async function getClientFees(): Promise<Map<string, number>> {
  if (isDemoMode) {
    const { demoClientFinancials } = await import("@/lib/mock/data");
    return new Map(demoClientFinancials.map((f) => [f.client_id, f.monthly_fee_cents]));
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("client_financials")
    .select("client_id, monthly_fee_cents");

  return new Map(
    (data ?? []).map((f) => [f.client_id as string, f.monthly_fee_cents as number]),
  );
}

export async function getFinancialData(months = 12): Promise<{
  transactions: FinancialTransaction[];
  monthly: MonthlySummary[];
}> {
  if (isDemoMode) {
    const { demoTransactions, demoMonthlySummary } = await import(
      "@/lib/mock/finance"
    );
    return { transactions: demoTransactions, monthly: demoMonthlySummary(months) };
  }

  const supabase = await createSupabaseServerClient();

  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const [tx, summary] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select("*")
      .gte("due_date", since.toISOString().slice(0, 10))
      .order("due_date", { ascending: false }),
    supabase.rpc("financial_monthly_summary", { p_months: months }),
  ]);

  if (tx.error) throw tx.error;
  if (summary.error) throw summary.error;

  return {
    transactions: (tx.data ?? []) as FinancialTransaction[],
    monthly: (summary.data ?? []) as MonthlySummary[],
  };
}

/* ------------------------------------------------------------------ */
/* Utilitários de período                                              */
/* ------------------------------------------------------------------ */

/** Últimos N dias terminando ontem (hoje ainda não fechou nas plataformas). */
export function lastNDays(n: number) {
  /* Termina ONTEM: o dia corrente ainda está sendo veiculado e entraria
     no gráfico como uma queda que não existe.

     Ancorado no fuso de São Paulo — `new Date()` no servidor da Vercel é
     UTC, e das 21h à meia-noite "ontem" lá já é hoje aqui. */
  const fim = new Date(`${dataNoBrasil()}T12:00:00-03:00`);
  fim.setUTCDate(fim.getUTCDate() - 1);

  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (n - 1));

  return { start: dataNoBrasil(inicio), end: dataNoBrasil(fim) };
}

/* ------------------------------------------------------------------ */
/* Integrações de mídia                                                */
/* ------------------------------------------------------------------ */

export interface IntegrationStatus {
  platform: "meta_ads" | "google_ads";
  connected: boolean;
  /** `pending:*` = OAuth feito, conta de anúncios ainda não escolhida. */
  externalAccountId: string | null;
  displayName: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  /** Só 'prepaid' entra no alerta de saldo. */
  billingType: "prepaid" | "postpaid";
  /** Evento do pixel que conta como conversão. null = padrão do segmento. */
  conversionActionType: string | null;
  /** Saldo informado no painel, em centavos. null = nunca informado. */
  fundsCents: number | null;
  fundsRecordedAt: string | null;
}

/**
 * Estado das conexões de um cliente.
 *
 * Lê SÓ `client_integrations`, nunca `integration_secrets`: a tabela de
 * tokens não tem policy alguma e é inacessível fora do service_role. O
 * que a tela precisa saber é se existe conexão e para qual conta — não
 * o segredo.
 */
export async function getClientIntegrations(
  clientId: string,
): Promise<IntegrationStatus[]> {
  const plataformas = ["meta_ads", "google_ads"] as const;

  if (isDemoMode) {
    return plataformas.map((platform) => ({
      platform,
      connected: false,
      externalAccountId: null,
      displayName: null,
      lastSyncedAt: null,
      syncError: null,
      billingType: "postpaid" as const,
      conversionActionType: null,
      fundsCents: null,
      fundsRecordedAt: null,
    }));
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("client_integrations")
    .select(
      "platform, external_account_id, display_name, last_synced_at, sync_error, billing_type, conversion_action_type, funds_cents, funds_recorded_at",
    )
    .eq("client_id", clientId);

  return plataformas.map((platform) => {
    const linha = (data ?? []).find((i) => i.platform === platform);
    return {
      platform,
      connected: Boolean(linha),
      externalAccountId: (linha?.external_account_id as string) ?? null,
      displayName: (linha?.display_name as string) ?? null,
      lastSyncedAt: (linha?.last_synced_at as string) ?? null,
      syncError: (linha?.sync_error as string) ?? null,
      billingType:
        (linha?.billing_type as "prepaid" | "postpaid") ?? "postpaid",
      conversionActionType:
        (linha?.conversion_action_type as string) ?? null,
      fundsCents: (linha?.funds_cents as number) ?? null,
      fundsRecordedAt: (linha?.funds_recorded_at as string) ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Painel individual                                                   */
/* ------------------------------------------------------------------ */

export type GoalHealth = "batendo" | "atencao" | "critico";

export interface MyDashboard {
  /** Contas sob responsabilidade do usuário. */
  myClientIds: string[];
  tasksToday: number;
  tasksWeek: number;
  /** Contagem por faixa de atingimento da meta do período. */
  health: Record<GoalHealth, number>;
  /** As mais urgentes, já ordenadas: vencidas primeiro. */
  urgent: TaskWithRelations[];
}

/**
 * Resumo da operação de QUEM ESTÁ LOGADO.
 *
 * "Minha carteira" é `owner_id` OU vínculo em `client_members` — não a
 * lista de clientes visíveis. Desde que a carteira virou legível por
 * toda a equipe, `getClients()` devolve tudo para todo mundo; usá-la
 * aqui transformaria o painel pessoal num painel da agência.
 *
 * As tarefas já vêm filtradas pelo RLS: um colaborador só enxerga as
 * atribuídas a ele, então não há filtro por usuário nesta função.
 */
export async function getMyDashboard(userId: string): Promise<MyDashboard> {
  const [tasks, goals] = await Promise.all([getTasks(), getCurrentGoals()]);

  const hoje = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hojeISO = iso(hoje);

  const emSete = new Date(hoje);
  emSete.setDate(emSete.getDate() + 7);
  const semanaISO = iso(emSete);

  const abertas = tasks.filter((t) => t.status !== "done");

  const vence = (t: TaskWithRelations) => t.due_date?.slice(0, 10) ?? null;

  const tasksToday = abertas.filter((t) => {
    const d = vence(t);
    // Atrasada conta como "de hoje": ninguém resolve amanhã o que já
    // venceu, e escondê-la faria o número mentir para menos.
    return d !== null && d <= hojeISO;
  }).length;

  const tasksWeek = abertas.filter((t) => {
    const d = vence(t);
    return d !== null && d <= semanaISO;
  }).length;

  /* Urgentes: vencidas e as com prazo mais próximo. Tarefa sem prazo
     fica fora — ela não é urgente, é indefinida, e misturar as duas
     esconderia o que realmente vence hoje. */
  const urgent = abertas
    .filter((t) => vence(t) !== null)
    .sort((a, b) => (vence(a) ?? "").localeCompare(vence(b) ?? ""))
    .slice(0, 5);

  const myClientIds = await getMyClientIds(userId);

  const { health } = await computeGoalHealth(myClientIds, goals);

  return { myClientIds, tasksToday, tasksWeek, health, urgent };
}

/**
 * Contas do usuário.
 *
 * ⚠️ `client_members` está vazia hoje: nenhuma tela atribui colaborador
 * a cliente, e a RPC de cadastro só grava `owner_id`. Por isso o OR —
 * sem ele, todo colaborador veria carteira zerada.
 */
async function getMyClientIds(userId: string): Promise<string[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.filter((c) => c.owner_id === userId).map((c) => c.id);
  }

  const supabase = await createSupabaseServerClient();

  const [{ data: proprias }, { data: vinculos }] = await Promise.all([
    supabase.from("clients").select("id").eq("owner_id", userId),
    supabase.from("client_members").select("client_id").eq("profile_id", userId),
  ]);

  return [
    ...new Set([
      ...(proprias ?? []).map((c) => c.id as string),
      ...(vinculos ?? []).map((m) => m.client_id as string),
    ]),
  ];
}

/**
 * Classifica contas por atingimento da meta do período.
 *
 * O realizado sai de `daily_metrics`, NÃO de
 * `executed_results_override`. O override é a EXCEÇÃO — existe para
 * corrigir a plataforma quando ela erra (lead que era spam, venda
 * fechada por telefone) e é nulo na esmagadora maioria dos casos. Lê-lo
 * como se fosse o valor corrente pinta toda a carteira de vermelho, com
 * um gráfico que parece plausível.
 *
 * Conta sem meta, ou com meta zero, fica FORA da contagem: ela não está
 * batendo nem falhando, e somá-la a qualquer fatia distorceria a leitura.
 */
async function computeGoalHealth(
  clientIds: string[],
  goals: Map<string, ClientGoal>,
): Promise<{ health: Record<GoalHealth, number>; criticos: string[] }> {
  const health: Record<GoalHealth, number> = {
    batendo: 0,
    atencao: 0,
    critico: 0,
  };
  const criticos: string[] = [];

  await Promise.all(
    clientIds.map(async (clientId) => {
      const goal = goals.get(clientId);
      if (!goal || goal.planned_results <= 0) return;

      const rows = await getMetrics(clientId, goal.period_start, goal.period_end);
      const feito =
        goal.executed_results_override ?? sumMetrics(rows).conversions;

      const pct = (feito / goal.planned_results) * 100;

      if (pct >= 80) health.batendo += 1;
      else if (pct >= 50) health.atencao += 1;
      else {
        health.critico += 1;
        criticos.push(clientId);
      }
    }),
  );

  return { health, criticos };
}

export interface AgencyDashboard {
  activeClients: number;
  tasksToday: number;
  tasksWeek: number;
  health: Record<GoalHealth, number>;
  /** Tarefas próximas do vencimento, com quem responde por elas. */
  urgent: TaskWithRelations[];
  /** Contas abaixo de 50% da meta — o que a diretoria precisa ver. */
  atRisk: Client[];
}

/**
 * Visão da agência inteira. Só faz sentido para admin.
 *
 * Não há filtro por usuário aqui: para um admin, `getTasks()` e
 * `getClients()` já devolvem tudo pelo RLS. A separação de perfis
 * acontece em `page.tsx`, que escolhe o painel — este módulo apenas
 * assume que quem chamou tem direito de ver.
 */
export async function getAgencyDashboard(): Promise<AgencyDashboard> {
  const [tasks, clients, goals] = await Promise.all([
    getTasks(),
    getClients(),
    getCurrentGoals(),
  ]);

  const ativos = clients.filter((c) => c.status === "active");

  const hoje = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hojeISO = iso(hoje);

  const emSete = new Date(hoje);
  emSete.setDate(emSete.getDate() + 7);
  const semanaISO = iso(emSete);

  const abertas = tasks.filter((t) => t.status !== "done");
  const vence = (t: TaskWithRelations) => t.due_date?.slice(0, 10) ?? null;

  // Atrasada conta como "de hoje" — mesma regra do painel individual.
  const tasksToday = abertas.filter((t) => {
    const d = vence(t);
    return d !== null && d <= hojeISO;
  }).length;

  const tasksWeek = abertas.filter((t) => {
    const d = vence(t);
    return d !== null && d <= semanaISO;
  }).length;

  const urgent = abertas
    .filter((t) => vence(t) !== null)
    .sort((a, b) => (vence(a) ?? "").localeCompare(vence(b) ?? ""))
    .slice(0, 6);

  const { health, criticos } = await computeGoalHealth(
    ativos.map((c) => c.id),
    goals,
  );

  return {
    activeClients: ativos.length,
    tasksToday,
    tasksWeek,
    health,
    urgent,
    atRisk: ativos.filter((c) => criticos.includes(c.id)),
  };
}

/* ------------------------------------------------------------------ */
/* Esteira de otimizações                                              */
/* ------------------------------------------------------------------ */

export interface PipelineClient {
  client: Client;
  /** Última rodada registrada, se houver. */
  last: OptimizationEntry | null;
  /** Já foi otimizado nesta semana? */
  doneThisWeek: boolean;
  doneToday: boolean;
}

export interface OptimizationPipeline {
  clients: PipelineClient[];
  /** Dia útil de hoje (1-5), ou null no fim de semana. */
  todayWeekday: number | null;
  counts: {
    comRotina: number;
    hoje: number;
    feitosHoje: number;
    atrasados: number;
  };
}

export async function getOptimizationPipeline(): Promise<OptimizationPipeline> {
  /* Tudo no fuso de São Paulo. O servidor da Vercel roda em UTC: usar
     `new Date()` cru aqui viraria o dia às 21h, e quem registrasse uma
     rodada à noite a veria contada como amanhã. */
  const hoje = new Date();
  const hojeISO = dataNoBrasil(hoje);
  const inicioSemana = segundaDestaSemana(hoje);

  // 0=domingo e 6=sábado não são dia de esteira.
  const diaSemana = diaDaSemanaNoBrasil(hoje);
  const todayWeekday = diaSemana >= 1 && diaSemana <= 5 ? diaSemana : null;

  const clients = (await getClients()).filter(
    (c) => c.optimization_day !== null && c.status === "active",
  );

  const historico = await getOptimizationHistorySince(inicioSemana);

  const pipeline: PipelineClient[] = clients.map((client) => {
    const doCliente = historico.filter((h) => h.client_id === client.id);
    const last = doCliente[0] ?? null;

    return {
      client,
      last,
      doneThisWeek: doCliente.length > 0,
      /* `slice(0, 10)` daria a data em UTC — um registro das 22h de
         segunda apareceria como terça. Converte antes de comparar. */
      doneToday: doCliente.some(
        (h) => dataNoBrasil(h.created_at) === hojeISO,
      ),
    };
  });

  /* "Atrasado" é conta cujo dia JÁ PASSOU nesta semana e que ninguém
     tocou. Contas de dias futuros não são atraso — são agenda —, e
     contá-las transformaria o número num alarme permanente. */
  const atrasados = todayWeekday
    ? pipeline.filter(
        (p) =>
          (p.client.optimization_day ?? 0) < todayWeekday && !p.doneThisWeek,
      ).length
    : 0;

  return {
    clients: pipeline,
    todayWeekday,
    counts: {
      comRotina: pipeline.length,
      hoje: pipeline.filter((p) => p.client.optimization_day === todayWeekday)
        .length,
      feitosHoje: pipeline.filter((p) => p.doneToday).length,
      atrasados,
    },
  };
}

/** Rodadas registradas a partir de uma data, mais recentes primeiro. */
async function getOptimizationHistorySince(
  desdeISO: string,
): Promise<OptimizationEntry[]> {
  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    return demoOptimizations
      .filter((h) => dataNoBrasil(h.created_at) >= desdeISO)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("optimization_history")
    .select("*, collaborator:profiles(id, full_name)")
    .gte("created_at", inicioDoDiaBR(desdeISO))
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as OptimizationEntry[];
}

/** Histórico completo de uma conta, para a gaveta. */
export async function getClientOptimizations(
  clientId: string,
  limit = 20,
): Promise<OptimizationEntry[]> {
  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    return demoOptimizations
      .filter((h) => h.client_id === clientId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("optimization_history")
    .select("*, collaborator:profiles(id, full_name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as OptimizationEntry[];
}

/* ------------------------------------------------------------------ */
/* Metas mensais                                                       */
/* ------------------------------------------------------------------ */

export interface MonthlyGoalStatus {
  /** "2026-08" */
  referenceMonth: string;
  goal: ClientGoal | null;
  /**
   * Precisa ser definida.
   *
   * NÃO é só "a linha não existe". `create_client_with_setup` grava uma
   * meta zerada quando o cadastro é preenchido sem orçamento — os dois
   * clientes em produção estão assim. Uma verificação por existência
   * diria que a meta está definida e o alerta nunca apareceria.
   */
  needsGoal: boolean;
}

/** Meta do mês corrente e se ela ainda precisa ser preenchida. */
export async function getMonthlyGoalStatus(
  clientId: string,
): Promise<MonthlyGoalStatus> {
  const { referencia, start } = mesCorrenteBR();

  const goal = await (async (): Promise<ClientGoal | null> => {
    if (isDemoMode) {
      const { demoGoals } = await import("@/lib/mock/data");
      return (
        demoGoals.find(
          (g) => g.client_id === clientId && g.period_start === start,
        ) ?? null
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("client_goals")
      .select("*")
      .eq("client_id", clientId)
      .eq("period_start", start)
      .maybeSingle();

    return (data as ClientGoal) ?? null;
  })();

  const zerada =
    !goal ||
    (goal.planned_budget_cents === 0 && Number(goal.planned_results) === 0);

  return { referenceMonth: referencia, goal, needsGoal: zerada };
}

export interface GoalHistoryEntry {
  /** "2026-07" */
  month: string;
  plannedBudgetCents: number;
  plannedResults: number;
  executedSpendCents: number;
  executedResults: number;
  /**
   * A unidade DAQUELE mês, não a de hoje.
   *
   * Uma conta que virou a meta de contagem para faturamento tem meses
   * nas duas unidades, e formatar tudo pela regra atual imprimiria
   * "R$ 1,20" onde foram 120 leads. Cada linha carrega a sua.
   */
  metricKey: GoalMetricKey;
}

/**
 * Meta contra realizado, mês a mês.
 *
 * O realizado é SOMADO de `daily_metrics`, não lido de uma coluna. É a
 * mesma decisão do card: número guardado envelhece calado quando a
 * plataforma reatribui conversão retroativamente, e aí o histórico
 * passa a contar uma história que os dados não sustentam.
 */
export async function getGoalHistory(
  clientId: string,
  limite = 12,
  segment?: ClientSegment,
): Promise<GoalHistoryEntry[]> {
  const goals = await (async (): Promise<ClientGoal[]> => {
    if (isDemoMode) {
      const { demoGoals } = await import("@/lib/mock/data");
      return demoGoals.filter((g) => g.client_id === clientId);
    }

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("client_goals")
      .select("*")
      .eq("client_id", clientId)
      .order("period_start", { ascending: false })
      .limit(limite);

    return (data ?? []) as ClientGoal[];
  })();

  return Promise.all(
    goals.map(async (g) => {
      const rows = await getMetrics(clientId, g.period_start, g.period_end);
      const totals = sumMetrics(rows);
      const metric = goalMetricFor(segment, g.results_metric);

      return {
        month: g.period_start.slice(0, 7),
        metricKey: metric.key,
        plannedBudgetCents: g.planned_budget_cents,
        plannedResults: Number(g.planned_results),
        /* Override existe para corrigir um mês em que a plataforma
           mentiu. `??` e não `||`: zero é um valor legítimo, e tratá-lo
           como ausente foi o bug que fazia toda conta parecer crítica. */
        executedSpendCents:
          g.executed_budget_cents_override ?? totals.spendCents,
        executedResults: Number(
          g.executed_results_override ?? goalExecutedFrom(metric, totals),
        ),
      };
    }),
  );
}
