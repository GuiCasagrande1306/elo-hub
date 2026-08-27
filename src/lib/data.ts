import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tiposDeConversaoDoCliente } from "@/lib/ads/conversao-do-cliente";
import { buildTrend, previousPeriod, sumMetrics } from "@/lib/metrics/kpi";
import { buildGoalProgress, periodElapsed } from "@/lib/metrics/goals";
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
  somarDiasBR,
} from "@/lib/date-br";
import type {
  AdCreative,
  AgencyContract,
  Client,
  ClientFinancials,
  ClientGoal,
  ClientSegment,
  CrmActivity,
  DailyMetric,
  DealWithRelations,
  FinancialTransaction,
  MonthlySummary,
  OptimizationEntry,
  Profile,
  RecurringExpense,
  ReportHistory,
  ReportTemplate,
  SocialAccount,
  SocialPostComment,
  SocialPostTarget,
  SocialPostWithRelations,
  SocialRecurrenceWithClient,
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

/**
 * Contas da carteira.
 *
 * ENCERRADAS FICAM DE FORA por padrão. Um contrato cancelado não some do
 * sistema — o histórico continua inteiro e a conta é reaberta em um
 * clique —, mas ele também não pode continuar dividindo espaço com
 * quem está sendo operado hoje. Quem quer vê-las pede explicitamente
 * (`/clientes/encerrados`).
 */
export async function getClients(
  agency?: string,
  opts?: { onlyChurned?: boolean; search?: string; segment?: ClientSegment },
): Promise<Client[]> {
  const churn = opts?.onlyChurned ?? false;
  const busca = opts?.search?.trim() ?? "";
  const segmento = opts?.segment;

  if (isDemoMode) {
    const termo = busca.toLowerCase();
    return demoFiltrados(churn, agency, termo, segmento);
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("clients").select("*").order("name");

  query = churn
    ? query.eq("status", "churned")
    : query.neq("status", "churned");

  /* Filtro no BANCO, não em memória: os totais do topo somam sobre esta
     mesma lista, então filtrar depois faria os cards mostrarem uma
     carteira e o resumo somar outra. */
  if (agency) query = query.eq("agency_partner", agency);

  /* Busca no BANCO. Filtrar em memória traria as 46 linhas para depois
     jogar 45 fora, e — pior — os totais somados sobre a lista completa
     discordariam do que a tela mostra.

     `%` escapado: um nome com `%` viraria curinga e devolveria a
     carteira inteira. */
  if (busca) {
    const termo = busca.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike("name", `%${termo}%`);
  }

  if (segmento) query = query.eq("segment", segmento);

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as Client[];
}

/** Espelha em memória o filtro que o Postgres faz, para o modo demo. */
async function demoFiltrados(
  churn: boolean,
  agency: string | undefined,
  termo: string,
  segmento: ClientSegment | undefined,
): Promise<Client[]> {
  const { demoClients } = await import("@/lib/mock/data");
  return demoClients
    .filter((c) => (churn ? c.status === "churned" : c.status !== "churned"))
    .filter((c) => !agency || c.agency_partner === agency)
    .filter((c) => !termo || c.name.toLowerCase().includes(termo))
    .filter((c) => !segmento || c.segment === segmento);
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

/**
 * Lê TODAS as linhas de uma consulta, página por página.
 *
 * ⚠️ O POSTGREST CORTA EM 1000 LINHAS E NÃO AVISA. `max_rows` está
 * declarado em `supabase/config.toml`; ao bater no teto ele devolve mil
 * linhas com status 200, sem cabeçalho de aviso e sem erro. Quem lê o
 * resultado soma o que veio e imprime um número menor com toda a
 * confiança do mundo.
 *
 * MEDIDO em 20/08/2026, na consulta que desenha o gráfico da visão
 * geral — julho inteiro, carteira toda:
 *
 *     sem paginar   1000 linhas   R$ 19.793,58
 *     paginando     2637 linhas   R$ 58.026,98
 *
 * A tela mostrava 34% do investimento real, e a forma da curva também
 * estava errada: sem `order`, quais linhas sobrevivem ao corte muda a
 * cada carregamento.
 *
 * A ordenação por `id` não é enfeite. `metric_date` não é único — a
 * tabela é granular por campanha —, e com chave ambígua o `range` pode
 * repetir ou pular linha na virada da página, que aqui vira gasto
 * contado duas vezes ou nenhuma.
 */
async function lerPaginado(
  /* `unknown[]` e não um genérico: o construtor do Supabase devolve um
     tipo derivado do texto do `select`, e amarrá-lo a `T` faz o
     compilador recusar toda chamada. Quem chama converte no fim, que é
     onde ele sabe o formato que pediu. */
  montarConsulta: (de: number, ate: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>,
): Promise<unknown[]> {
  const PAGINA = 1000;
  const tudo: unknown[] = [];

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await montarConsulta(inicio, inicio + PAGINA - 1);

    /* Erro NÃO vira lista vazia. O Supabase devolve `{ data: null,
       error }` sem lançar, e engolir isso num `?? []` transforma uma
       consulta recusada em "não há dado" — exatamente o defeito que a
       tela de alertas de saldo já pagou. */
    if (error) {
      throw new Error(`Leitura de métricas recusada: ${error.message}`);
    }

    const pagina = data ?? [];
    tudo.push(...pagina);

    if (pagina.length < PAGINA) return tudo;
  }
}

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
  /**
   * A ação de conversão desta conta, quando quem chama JÁ TEM.
   *
   * ⚠️ QUEM CHAMA DENTRO DE UM LAÇO PRECISA PASSAR ISTO. Sem o
   * parâmetro, esta função busca segmento e integração por conta
   * própria — duas consultas —, e numa tela que percorre a carteira
   * inteira isso multiplica por 61. Medido em 26/08/2026: 245
   * consultas e 1.834ms contra 123 e 303ms.
   *
   * `tiposDeConversaoDaCarteira()` devolve o mapa inteiro em duas
   * consultas; use-o antes do laço e passe o valor daqui.
   */
  tiposDeConversao?: string[],
) {
  const prev = previousPeriod(start, end);

  /* Os tipos entram junto da busca: é o que faz o PAINEL mostrar o mesmo
     custo por resultado do PDF. Divergirem seria pior do que os dois
     estarem errados — o gestor abriria o relatório do cliente e veria um
     número que a tela dele nunca mostrou. */
  const [current, previous, tipos] = await Promise.all([
    getMetrics(clientId, start, end),
    getMetrics(clientId, prev.start, prev.end),
    tiposDeConversao ?? tiposDeConversaoDoCliente(clientId),
  ]);

  return {
    current,
    previous,
    currentTotals: sumMetrics(current, tipos),
    previousTotals: sumMetrics(previous, tipos),
    period: { start, end, days: prev.days },
    previousPeriod: prev,
    /* DEVOLVIDOS, e não só usados aqui dentro: o relatório precisa da
       MESMA lista para isolar a origem também no quadro por plataforma.
       Sem isto ele teria de buscá-la de novo — duas consultas a mais e,
       pior, a chance de as duas listas divergirem no meio do documento. */
    tiposDeConversao: tipos,
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

/**
 * Meta vigente hoje para cada cliente acessível, indexada por client_id.
 *
 * `dataNoBrasil()` e não `toISOString()`: a Vercel roda em UTC, então das
 * 21h às 24h de Brasília o `toISOString()` já devolve o dia seguinte.
 * Medido — às 21:30 BRT de 31/08 o "hoje" saía `2026-09-01`, a meta de
 * agosto (01/08 a 31/08) deixava de casar e a de setembro ainda não
 * existia: o Map voltava VAZIO. Toda meta da carteira sumia da tela nas
 * três horas finais do último dia de cada mês, em silêncio.
 */
export async function getCurrentGoals(): Promise<Map<string, ClientGoal>> {
  const today = dataNoBrasil();

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
   * A JANELA QUE FOI SOMADA — não a que alguém escolheu numa tela.
   *
   * Vem junto porque quem consome estes números precisa poder dizer de
   * que intervalo eles são. A tela de Relatórios monta com eles um texto
   * que vai para o cliente final, e sem esta informação ela rotulava a
   * mensagem com um período qualquer: "resumo dos últimos 7 dias"
   * acompanhado do gasto do mês inteiro.
   */
  period: { start: string; end: string };
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
  opts?: { onlyChurned?: boolean },
): Promise<ClientWithGoal[]> {
  const periodo = month ? intervaloDoMes(month) : null;

  const [clients, goals] = await Promise.all([
    getClients(agency, opts),
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
        period: { start, end },
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

/**
 * Progresso da meta de UM cliente, para a página dele.
 *
 * Existe separado de `getClientsWithGoals` porque a página do cliente
 * precisa de um, e aquela função varre a carteira inteira — 46 consultas
 * de métrica para usar uma.
 *
 * ⚠️ A JANELA É A DA META, não a do seletor de período da página. São
 * duas leituras diferentes convivendo na mesma tela: os cards do topo
 * respondem "como foram os últimos 30 dias" e mudam com o seletor; a
 * meta responde "onde este MÊS fecha" e não muda. Alimentar a projeção
 * com o total de 90 dias devolveria um número plausível e errado —
 * projetar o fechamento do mês a partir de três meses de gasto.
 */
export async function getClientGoalProgress(client: Client): Promise<{
  progress: ReturnType<typeof buildGoalProgress>;
  /** Início e fim da janela usada — a tela precisa dizer de qual mês fala. */
  period: { start: string; end: string } | null;
} | null> {
  const goals = await getCurrentGoals();
  const goal = goals.get(client.id) ?? null;

  // Sem meta não há projeção: a tela já mostra o alerta de meta ausente.
  if (!goal) return null;

  const rows = await getMetrics(client.id, goal.period_start, goal.period_end);
  const totals = sumMetrics(rows);
  const metric = goalMetricFor(client.segment, goal.results_metric);

  return {
    progress: buildGoalProgress({
      goal,
      metric,
      computedSpendCents: totals.spendCents,
      computedConversions: totals.conversions,
      computedRevenueCents: totals.revenueCents,
    }),
    period: { start: goal.period_start, end: goal.period_end },
  };
}

/* MESMA ARMADILHA de `getCurrentGoals`: a Vercel roda em UTC e das 21h
   às 24h de Brasília o `toISOString()` já é o dia seguinte. Como estes
   dois são o fallback do período quando não há meta, o painel passava a
   somar a partir do mês ERRADO nas últimas horas do último dia do mês —
   `setDate(1)` sobre uma data que o UTC já virou aponta para o mês que
   vem. `dataNoBrasil()` e `mesCorrenteBR()` resolvem os dois. */
function todayISO() {
  return dataNoBrasil();
}

function monthStartISO() {
  return mesCorrenteBR().start;
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

export interface ReportSetupRow {
  id: string;
  name: string;
  logoUrl: string | null;
  brandPrimary: string | null;
  /** Telefone ou JID de grupo. `null` = sem destino cadastrado. */
  whatsappPhone: string | null;
  /** Dia do mês do envio automático, 1–28. Só na cadência mensal. */
  reportDay: number | null;
  /** Hora de São Paulo em que o relatório é preparado (0–23). */
  reportHour: number;
  /** 'monthly' (dia do mês) ou 'weekly' (dia da semana). */
  /** 0=domingo a 6=sábado. Só na cadência semanal. */
  reportWeekday: number | null;
  reportEnabled: boolean;
}

/**
 * Quem está pronto para receber relatório automático — e quem não está.
 *
 * Existe porque o agendamento morava SÓ no formulário de cada cliente,
 * um diálogo por vez. Com 47 contas, o resultado medido em 08/08/2026
 * era: 0 com envio ligado, 0 com dia definido, 7 com WhatsApp. O cron
 * nunca teve o que preparar, e a fila de envio nascia vazia todo dia
 * sem que nada na tela dissesse por quê.
 *
 * Só contas ATIVAS: configurar envio para quem cancelou é trabalho que
 * o job vai ignorar.
 */
export async function getReportSetup(): Promise<ReportSetupRow[]> {
  const clients = await getClients();

  return clients
    .filter((c) => c.status === "active")
    .map((c) => ({
      id: c.id,
      name: c.name,
      logoUrl: c.logo_url,
      brandPrimary: c.brand_primary,
      whatsappPhone: c.whatsapp_phone,
      reportDay: c.report_day,
      /* Linha anterior à migration 40 não tem a coluna: cai em mensal,
         que é o default do banco e o que ela sempre foi. */
      reportWeekday: c.report_weekday ?? null,
      /* Espelha o `default 8` da migration 67 — linha anterior a ela
         não tem a coluna, e um `undefined` no seletor deixaria o campo
         em branco num controle que não aceita vazio. */
      reportHour: c.report_hour ?? 8,
      reportEnabled: c.report_enabled,
    }));
}

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

/* ---------------------------------------------------------------------
   Schema que ainda não foi aplicado

   O código sobe pelo deploy; a migration é rodada à mão no Supabase. Nos
   minutos (ou dias) entre um e outro, a tela pediria uma coluna que não
   existe.

   Sem tratamento isso vira 500 numa página de produção que o menu já
   linka — e o erro no console diz `column client_financials.billing_day
   does not exist`, que só significa alguma coisa para quem escreveu a
   migration. Virar erro TIPADO deixa a tela explicar o que fazer.
   ------------------------------------------------------------------ */

/** 42P01 = tabela não existe. 42703 = coluna não existe. */
const CODIGOS_SCHEMA_PENDENTE = new Set(["42P01", "42703"]);

export class SchemaPendenteError extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = "SchemaPendenteError";
  }
}

function lancarSeSchemaPendente(error: {
  code?: string;
  message: string;
} | null): void {
  if (!error) return;
  if (CODIGOS_SCHEMA_PENDENTE.has(error.code ?? "")) {
    throw new SchemaPendenteError(error.message);
  }
  throw error;
}

/**
 * Contrato completo por cliente: honorário E dia de vencimento.
 *
 * Separado de `getClientFees` porque os consumidores são diferentes — o
 * KPI de MRR só quer o valor, a tela de recorrência precisa do dia para
 * saber quais contratos o job consegue materializar.
 */
export async function getClientFinancials(): Promise<
  Map<string, ClientFinancials>
> {
  if (isDemoMode) {
    const { demoClientFinancials } = await import("@/lib/mock/data");
    return new Map(demoClientFinancials.map((f) => [f.client_id, f]));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_financials")
    .select("client_id, monthly_fee_cents, tax_id, billing_day");

  /* Diferente de `getClientFees`, que engole o erro de propósito (um
     colaborador vê MRR zerado em vez de a página quebrar): aqui a tela é
     de admin e existe PARA editar estes campos. Lista vazia por falta de
     coluna seria indistinguível de carteira sem contrato. */
  lancarSeSchemaPendente(error);

  return new Map(
    (data ?? []).map((f) => [f.client_id as string, f as ClientFinancials]),
  );
}

/**
 * Contrato de cada agência parceira. Admin apenas, via RLS.
 *
 * Devolve LISTA e não `Map` porque a tela precisa da ordem — e a ordem
 * aqui é alfabética, não por valor: a lista é lida procurando um nome,
 * não comparando honorários.
 *
 * A migration semeia uma linha por agência que já tem cliente na
 * carteira, então lista vazia significa migration pendente, não
 * "nenhuma agência" — daí `lancarSeSchemaPendente` valer aqui também.
 */
export async function getAgencyContracts(): Promise<AgencyContract[]> {
  if (isDemoMode) {
    const { demoAgencyContracts } = await import("@/lib/mock/data");
    return demoAgencyContracts;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agency_contracts")
    /* `*` e não a lista de colunas: `is_own` decide quem é a agência da
       casa na régua de faturamento, e uma seleção explícita esquecida
       faria a própria sair nula — todo cliente terceirizado passaria a
       ser faturado direto, em silêncio. Com `*`, coluna nova entra
       sozinha. */
    .select("*")
    .order("agency");

  lancarSeSchemaPendente(error);
  return (data ?? []) as AgencyContract[];
}

/**
 * Despesas que se repetem todo mês. Admin apenas, via RLS.
 *
 * Inclui as inativas: a tela precisa mostrar o que foi desligado para
 * que dê para religar, e esconder isso faria a assinatura cancelada
 * parecer apagada.
 */
export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  if (isDemoMode) {
    const { demoRecurringExpenses } = await import("@/lib/mock/finance");
    return demoRecurringExpenses;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("*")
    .order("is_active", { ascending: false })
    .order("amount_cents", { ascending: false });

  lancarSeSchemaPendente(error);
  return (data ?? []) as RecurringExpense[];
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
  /**
   * Plataforma em uso por este cliente.
   *
   * `false` tira a conta da sincronização, do aviso de saldo e das
   * checagens — sem apagar o histórico já coletado. É como se marca
   * "este cliente não roda Google".
   */
  isActive: boolean;
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
    /* O Meta sai CONECTADO na demonstração, e não é enfeite: metade
       deste card — escolha da conta, conta pré-paga, evento de conversão
       e o estado das permissões do Instagram — só existe dentro do
       `status.connected`. Com as duas plataformas desligadas, a
       demonstração mostrava dois botões "Autorizar" e escondia a tela
       inteira que ela deveria demonstrar.

       O Google fica desligado de propósito, para o estado "não
       conectado" continuar visível em algum lugar. */
    return plataformas.map((platform) => ({
      platform,
      connected: platform === "meta_ads",
      externalAccountId: platform === "meta_ads" ? "act_1029384756" : null,
      displayName: platform === "meta_ads" ? "Verdi — Conta principal" : null,
      lastSyncedAt: null,
      syncError: null,
      billingType: "postpaid" as const,
      conversionActionType: null,
      fundsCents: null,
      fundsRecordedAt: null,
      isActive: true,
    }));
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("client_integrations")
    .select(
      "platform, external_account_id, display_name, last_synced_at, sync_error, billing_type, conversion_action_type, funds_cents, funds_recorded_at, is_active",
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
      /* Linha ausente = plataforma nem vinculada; o cartão mostra
         "Vincular" e o interruptor não aparece. `true` para o padrão
         de quem existe. */
      isActive: (linha?.is_active as boolean) ?? true,
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

  /* "Hoje" em SÃO PAULO, não em UTC. `toISOString()` no servidor da
     Vercel adianta o dia às 21h daqui, e o contador passava a incluir as
     tarefas de AMANHÃ como "para hoje" das 21h à meia-noite — justo o
     horário em que se confere o que sobrou do dia. Ver `src/lib/date-br.ts`. */
  const hojeISO = dataNoBrasil();
  const semanaISO = somarDiasBR(hojeISO, 7);

  const abertas = tasks.filter((t) => t.status !== "done");

  /* `dataNoBrasil`, não `.slice(0, 10)`: o corte lê o prazo em UTC e
     discordaria do calendário e do selo de atraso, que já leem em SP. */
  const vence = (t: TaskWithRelations) =>
    t.due_date ? dataNoBrasil(t.due_date) : null;

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

  /* "Hoje" em SÃO PAULO, não em UTC. `toISOString()` no servidor da
     Vercel adianta o dia às 21h daqui, e o contador passava a incluir as
     tarefas de AMANHÃ como "para hoje" das 21h à meia-noite — justo o
     horário em que se confere o que sobrou do dia. Ver `src/lib/date-br.ts`. */
  const hojeISO = dataNoBrasil();
  const semanaISO = somarDiasBR(hojeISO, 7);

  const abertas = tasks.filter((t) => t.status !== "done");
  /* `dataNoBrasil`, não `.slice(0, 10)`: o corte lê o prazo em UTC e
     discordaria do calendário e do selo de atraso, que já leem em SP. */
  const vence = (t: TaskWithRelations) =>
    t.due_date ? dataNoBrasil(t.due_date) : null;

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
  const { data, error } = await supabase
    .from("optimization_history")
    /* ⚠️ O HINT `!optimization_history_collaborator_id_fkey` É
       OBRIGATÓRIO, não estilo.
       ---------------------------------------------------------------
       A migration 36 acrescenta `edited_by references profiles`, ou
       seja uma SEGUNDA chave estrangeira desta tabela para `profiles`.
       Com duas, `profiles(...)` sem hint fica ambíguo e o PostgREST
       recusa a consulta inteira com PGRST201 / HTTP 300 — medido nesta
       base em `social_posts`, que já tem as duas.

       Como esta função descartava o erro, o 300 virava `data = null` e
       a esteira voltava VAZIA, com toda conta marcada atrasada. O erro
       agora é registrado, mas o hint é o que impede o caso.

       O editor continua SEM junção: `edited_by` vem no `*` e o nome é
       resolvido na tela contra a lista da equipe, que a página já
       carrega. Assim a leitura funciona antes e depois da migration. */
    .select(
      "*, collaborator:profiles!optimization_history_collaborator_id_fkey(id, full_name)",
    )
    .gte("created_at", inicioDoDiaBR(desdeISO))
    .order("created_at", { ascending: false });

  /* Lista vazia e consulta QUEBRADA sao indistinguiveis na tela: as duas
     pintam a esteira de "sem registro" e marcam a conta atrasada. Sem
     este log, um erro de schema some por semanas parecendo rotina. */
  if (error) console.error("esteira: historico nao carregou", error);

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
  const { data, error } = await supabase
    .from("optimization_history")
    /* ⚠️ O HINT `!optimization_history_collaborator_id_fkey` É
       OBRIGATÓRIO, não estilo.
       ---------------------------------------------------------------
       A migration 36 acrescenta `edited_by references profiles`, ou
       seja uma SEGUNDA chave estrangeira desta tabela para `profiles`.
       Com duas, `profiles(...)` sem hint fica ambíguo e o PostgREST
       recusa a consulta inteira com PGRST201 / HTTP 300 — medido nesta
       base em `social_posts`, que já tem as duas.

       Como esta função descartava o erro, o 300 virava `data = null` e
       a esteira voltava VAZIA, com toda conta marcada atrasada. O erro
       agora é registrado, mas o hint é o que impede o caso.

       O editor continua SEM junção: `edited_by` vem no `*` e o nome é
       resolvido na tela contra a lista da equipe, que a página já
       carrega. Assim a leitura funciona antes e depois da migration. */
    .select(
      "*, collaborator:profiles!optimization_history_collaborator_id_fkey(id, full_name)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) console.error("esteira: historico da conta nao carregou", error);

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


/* ------------------------------------------------------------------ */
/* Torre de controle — números da agência inteira                      */
/* ------------------------------------------------------------------ */

export interface AgencyOverview {
  /** Soma do gasto de todas as contas ativas no mês corrente. */
  spendCents: number;
  /** Soma das conversões contadas no mês. */
  results: number;
  /** Receita atribuída, para o retorno global. */
  revenueCents: number;
  /** Contas com meta definida e o veredito de ritmo de cada uma. */
  noRitmo: number;
  atrasadas: number;
  semMeta: number;
  /** Série diária somada — investimento contra retorno. */
  trend: { date: string; spend: number; revenue: number }[];
}

/**
 * Os números que o dono da agência olha primeiro.
 *
 * SOMADO DE `daily_metrics`, não de coluna guardada. Não existe
 * `actual_spent` nem `actual_result` em lugar nenhum deste sistema, e
 * isso é decisão: a Meta reatribui conversão retroativamente, então um
 * total congelado passa a contradizer o dashboard do cliente sem avisar.
 *
 * O ritmo usa a MESMA razão de `lib/metrics/goals.ts` — executado ÷
 * esperado para hoje, tolerância de 10%. Duplicar a regra aqui faria a
 * torre de controle e o card do cliente discordarem sobre a mesma conta.
 */
export async function getAgencyOverview(): Promise<AgencyOverview> {
  const linhas = await getClientsWithGoals();
  const { start, end } = mesCorrenteBR();

  const decorrido = periodElapsed(start, end);

  let spendCents = 0;
  let results = 0;
  let revenueCents = 0;
  let noRitmo = 0;
  let atrasadas = 0;
  let semMeta = 0;

  for (const linha of linhas) {
    spendCents += linha.computedSpendCents;
    results += linha.computedResults;
    revenueCents += linha.computedRevenueCents;

    const meta = linha.goal?.planned_results ?? 0;
    if (meta <= 0) {
      semMeta += 1;
      continue;
    }

    /* Mesmo critério da barra do card: 90% do esperado para hoje. */
    const esperado = meta * decorrido;
    const razao = esperado > 0 ? linha.computedGoalValue / esperado : 0;
    if (razao >= 0.9) noRitmo += 1;
    else atrasadas += 1;
  }

  /* Série diária: UMA consulta somando tudo, não uma por cliente. Com 46
     contas, o laço faria 46 idas ao banco só para desenhar um gráfico. */
  const trend = await getAgencyTrend(start, end);

  return { spendCents, results, revenueCents, noRitmo, atrasadas, semMeta, trend };
}

async function getAgencyTrend(
  start: string,
  end: string,
): Promise<{ date: string; spend: number; revenue: number }[]> {
  const linhas = await (async (): Promise<DailyMetric[]> => {
    if (isDemoMode) {
      const { demoMetrics } = await import("@/lib/mock/data");
      return demoMetrics.filter(
        (m) => m.metric_date >= start && m.metric_date <= end,
      );
    }

    const supabase = await createSupabaseServerClient();

    /* PAGINADA. Esta consulta não filtra por cliente — varre a carteira
       inteira — e é a que mais sofre com o teto de mil linhas. Ver
       `lerPaginado`. */
    return (await lerPaginado((de, ate) =>
      supabase
        .from("daily_metrics")
        .select("metric_date, spend_cents, revenue_cents")
        .gte("metric_date", start)
        .lte("metric_date", end)
        .order("id")
        .range(de, ate),
    )) as DailyMetric[];
  })();

  const porDia = new Map<string, { spend: number; revenue: number }>();

  for (const linha of linhas) {
    const atual = porDia.get(linha.metric_date) ?? { spend: 0, revenue: 0 };
    atual.spend += linha.spend_cents;
    atual.revenue += linha.revenue_cents;
    porDia.set(linha.metric_date, atual);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    /* Reais, não centavos: o gráfico é apresentação, e o eixo em
       centavos marcaria "5.000.000" para R$ 50 mil. */
    .map(([date, v]) => ({
      date,
      spend: v.spend / 100,
      revenue: v.revenue / 100,
    }));
}

/* ------------------------------------------------------------------ */
/* Mídias sociais                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pauta social da carteira.
 *
 * SEM RECORTE DE PERÍODO na consulta, e isso é uma decisão, não uma
 * omissão. O calendário navega mês a mês no navegador; buscar por mês
 * significaria um round-trip a cada seta, e — pior — os posts SEM DATA
 * ficariam de fora de todo recorte, que é justamente a pauta que mais
 * precisa aparecer. O volume comporta: 47 contas com uma dúzia de peças
 * por mês é ordem de centenas de linhas, não de milhares.
 *
 * Arquivados entram. Quem filtra é a tela, porque a aba de histórico
 * precisa deles e a policy já limitou à carteira visível.
 */
/**
 * A grade semanal fixa da carteira.
 *
 * `catch` que devolve `null` no chamador, como `getSocialPosts`: a
 * diferença entre "ninguém montou grade" e "a migration 70 não rodou" é
 * a diferença entre uma tela vazia normal e um recurso que ninguém
 * descobre estar quebrado.
 */
export async function getSocialRecurrences(): Promise<
  SocialRecurrenceWithClient[]
> {
  /* O modo demonstração não tem grade: o dataset já nasce com a semana
     cheia, e uma grade fantasma ofereceria editar o que não existe. */
  if (isDemoMode) return [];

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("social_recurrences")
    .select("*, client:clients(id, name, brand_primary)")
    .eq("is_active", true)
    .order("weekday")
    .order("hora");

  if (error) throw error;
  return (data ?? []) as SocialRecurrenceWithClient[];
}

export async function getSocialPosts(options?: {
  clientId?: string;
}): Promise<SocialPostWithRelations[]> {
  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    return options?.clientId
      ? demoSocialPosts.filter((p) => p.client_id === options.clientId)
      : demoSocialPosts;
  }

  const supabase = await createSupabaseServerClient();

  /* Os dois embeds de `profiles` precisam ser desambiguados pelo NOME DA
     CONSTRAINT: há duas chaves estrangeiras da mesma tabela para a mesma
     tabela (`created_by` e `approved_by`), e sem isso o PostgREST não
     sabe por qual seguir e devolve erro em vez de escolher uma. */
  let query = supabase
    .from("social_posts")
    .select(
      `
      *,
      targets:social_post_targets(*),
      client:clients(id, name, brand_primary, logo_url),
      author:profiles!social_posts_created_by_fkey(id, full_name, avatar_url),
      approver:profiles!social_posts_approved_by_fkey(id, full_name),
      comments:social_post_comments(count)
    `,
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  if (options?.clientId) query = query.eq("client_id", options.clientId);

  const { data, error } = await query;
  if (error) throw error;

  type Linha = Record<string, unknown> & { comments?: { count: number }[] };

  return (data ?? []).map((linha) => {
    const { comments, ...post } = linha as Linha;
    return {
      ...post,
      /* O embed de contagem volta como `[{ count: 3 }]` — e como `[]`
         quando não há nenhum, não como `[{ count: 0 }]`. */
      comment_count: comments?.[0]?.count ?? 0,
      targets: (post.targets ?? []) as SocialPostTarget[],
    };
  }) as unknown as SocialPostWithRelations[];
}

/** Perfis sociais cadastrados. Cadastro editorial, não conexão de API. */
export async function getSocialAccounts(
  clientId?: string,
): Promise<SocialAccount[]> {
  if (isDemoMode) {
    const { demoSocialAccounts } = await import("@/lib/mock/social");
    return clientId
      ? demoSocialAccounts.filter((a) => a.client_id === clientId)
      : demoSocialAccounts;
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("social_accounts").select("*").order("network");

  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as SocialAccount[];
}

/** Conversa de aprovação de um post, do mais antigo para o mais novo. */
export async function getSocialComments(
  postId: string,
): Promise<SocialPostComment[]> {
  if (isDemoMode) {
    const { demoSocialComments } = await import("@/lib/mock/social");
    return demoSocialComments
      .filter((c) => c.post_id === postId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_post_comments")
    .select("*, author:profiles(id, full_name, avatar_url)")
    .eq("post_id", postId)
    .order("created_at");

  if (error) throw error;
  return (data ?? []) as unknown as SocialPostComment[];
}


/* ------------------------------------------------------------------ */
/* Agências                                                            */
/* ------------------------------------------------------------------ */

/**
 * Cadastro das agências — a lista que antes era `const` no código.
 *
 * Ordenada com a agência PRÓPRIA primeiro e o resto por nome: nos
 * seletores, a conta da casa é a escolha mais frequente e não deve exigir
 * rolagem para ser encontrada.
 */
export async function getAgencies(): Promise<AgencyContract[]> {
  if (isDemoMode) {
    const { demoAgencies } = await import("@/lib/mock/data");
    return demoAgencies.map((a) => ({
      agency: a.agency,
      monthly_fee_cents: 0,
      billing_day: null,
      notes: null,
      brand_primary: a.brand_primary,
      logo_url: a.logo_url,
      is_own: a.agency === "Elo Marketing",
    }));
  }

  const supabase = await createSupabaseServerClient();

  /* A CONSULTA NÃO CITA `is_own`, e isso é deliberado: enquanto a
     migration 39 não roda, referenciar a coluna no `.order()` faz o
     PostgREST recusar a consulta inteira — e o seletor de agência do
     cadastro de cliente ficaria VAZIO, impedindo criar conta. A
     ordenação por conta própria acontece em memória, sobre um campo que
     simplesmente não vem antes da migration. */
  const { data, error } = await supabase
    .from("agency_contracts")
    .select("*")
    .order("agency");

  const linhas = (data ?? []) as AgencyContract[];

  if (!error && linhas.length > 0) {
    // Própria primeiro: nos seletores é a escolha mais frequente.
    return [...linhas].sort(
      (a, b) => Number(Boolean(b.is_own)) - Number(Boolean(a.is_own)),
    );
  }

  /* ÚLTIMO RECURSO: os nomes que os próprios clientes já usam. Serve a
     dois casos — a tabela ainda não existir com as colunas novas, e uma
     carteira que aponta para agência que ninguém cadastrou. Um seletor
     vazio impediria cadastrar cliente; um seletor com os nomes em uso
     mantém a tela funcionando enquanto o cadastro não é preenchido. */
  const { data: usados } = await supabase
    .from("clients")
    .select("agency_partner")
    .not("agency_partner", "is", null);

  const nomes = [
    ...new Set(
      (usados ?? [])
        .map((c) => (c as { agency_partner: string | null }).agency_partner)
        .filter((n): n is string => Boolean(n)),
    ),
  ].sort();

  return nomes.map((agency) => ({
    agency,
    monthly_fee_cents: 0,
    billing_day: null,
    notes: null,
  }));
}

/* ------------------------------------------------------------------ */
/* CRM comercial                                                       */
/* ------------------------------------------------------------------ */

/**
 * Negócios do funil, com o responsável resolvido.
 *
 * SEM FILTRO DE ETAPA por padrão, e de propósito: a tela precisa dos
 * ganhos e perdidos para calcular taxa de conversão, e uma segunda
 * consulta só para eles pagaria dois round-trips para responder uma
 * pergunta só. O corte por etapa é feito na tela, que é onde o filtro
 * do usuário também mora.
 *
 * ⚠️ O PostgREST corta em `max_rows = 1000` (supabase/config.toml) e não
 * avisa. Um funil com mais de mil negócios é improvável nesta agência,
 * mas o `limit` explícito faz a truncagem virar um número visível em vez
 * de uma lista silenciosamente incompleta.
 */
export async function getDeals(): Promise<DealWithRelations[]> {
  if (isDemoMode) {
    const { demoDeals } = await import("@/lib/mock/data");
    return demoDeals;
  }

  const supabase = await createSupabaseServerClient();

  /* Hint de FK no embed de `profiles`. `crm_deals` aponta para ela DUAS
     vezes — `owner_id` e `created_by` —, e sem o hint o PostgREST recusa
     com PGRST201 por ambiguidade. Foi assim que a esteira quase voltou
     vazia quando a migration 36 criou a segunda FK dela. */
  const { data, error } = await supabase
    .from("crm_deals")
    .select(
      `
      *,
      owner:profiles!crm_deals_owner_id_fkey(id, full_name, avatar_url),
      crm_activities(count)
    `,
    )
    .order("position", { ascending: false })
    .limit(1000);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { crm_activities, ...deal } = row as unknown as Record<
      string,
      unknown
    > & { crm_activities: { count: number }[] | null };

    return {
      ...deal,
      activityCount: crm_activities?.[0]?.count ?? 0,
    };
  }) as unknown as DealWithRelations[];
}

/** Linha do tempo de um negócio, do mais recente para o mais antigo. */
export async function getDealActivities(
  dealId: string,
): Promise<(CrmActivity & { author: Pick<Profile, "id" | "full_name"> | null })[]> {
  if (isDemoMode) {
    const { demoActivities } = await import("@/lib/mock/data");
    return demoActivities.filter((a) => a.deal_id === dealId);
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("crm_activities")
    .select(
      `*, author:profiles!crm_activities_created_by_fkey(id, full_name)`,
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []) as unknown as (CrmActivity & {
    author: Pick<Profile, "id" | "full_name"> | null;
  })[];
}
