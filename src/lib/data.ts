import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTrend, previousPeriod, sumMetrics } from "@/lib/metrics/kpi";
import { buildGoalProgress } from "@/lib/metrics/goals";
import type {
  AdCreative,
  Client,
  ClientGoal,
  DailyMetric,
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

export async function getClients(): Promise<Client[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name");

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
  computedResults: number;
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

export async function getClientsWithGoals(): Promise<ClientWithGoal[]> {
  const [clients, goals] = await Promise.all([getClients(), getCurrentGoals()]);

  return Promise.all(
    clients.map(async (client) => {
      const goal = goals.get(client.id) ?? null;

      // Sem meta, mostramos o mês corrente só para a conta não ficar muda.
      const start = goal?.period_start ?? monthStartISO();
      const end = goal?.period_end ?? todayISO();

      const rows = await getMetrics(client.id, start, end);
      const totals = sumMetrics(rows);

      return {
        client,
        goal,
        computedSpendCents: totals.spendCents,
        computedResults: totals.conversions,
        trend: buildTrend(rows).map((p) => p.spend),
        progress: buildGoalProgress({
          goal,
          computedSpendCents: totals.spendCents,
          computedResults: totals.conversions,
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
  return (
    templates.find((t) => t.segment === client.segment && t.is_default) ??
    templates.find((t) => t.segment === null && t.is_default) ??
    templates[0] ??
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
/* Utilitários de período                                              */
/* ------------------------------------------------------------------ */

/** Últimos N dias terminando ontem (hoje ainda não fechou nas plataformas). */
export function lastNDays(n: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
