import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getClientBySlug,
  getCreatives,
  getMetricsWithComparison,
  getReportTemplates,
} from "@/lib/data";
import { tiposDeConversaoDoCliente } from "@/lib/ads/conversao-do-cliente";
import { previousPeriod, sumMetrics } from "@/lib/metrics/kpi";
import type {
  AdCreative,
  Client,
  DailyMetric,
  ReportTemplate,
} from "@/types/database";

/* =====================================================================
   Origem de dados do relatório
   ---------------------------------------------------------------------
   O MESMO pipeline serve dois chamadores com autorizações opostas:

   • A tela: usuário logado, leitura sob RLS. Um colaborador que não
     enxerga o cliente recebe `null` e o relatório nem começa.
   • O cron: não existe usuário. Não há cookie, não há JWT, e o RLS
     devolveria vazio para tudo — o job rodaria "com sucesso" gerando
     zero relatórios, que é a pior falha possível: silenciosa.

   Em vez de duplicar a máquina de estados do orquestrador para o cron,
   a ORIGEM é injetada. A máquina não sabe qual das duas está usando.

   A separação é proposital e visível: `systemSource()` ignora RLS, e
   quem a chama tem que ter autorizado por outro meio — no caso do cron,
   o CRON_SECRET validado na rota. Nenhum caminho de input de usuário
   deve construir uma `systemSource`.
   ===================================================================== */

export interface MetricsWindow {
  current: DailyMetric[];
  /**
   * Linhas do período ANTERIOR, não só o total.
   *
   * As duas origens já as tinham em memória para calcular
   * `previousTotals` e simplesmente as descartavam. Expor custa zero e
   * é o que permite comparar plataforma a plataforma — sem elas, a
   * seção do Meta mostraria números sem variação, ou exigiria uma
   * segunda consulta ao banco para o mesmo dado.
   */
  previous: DailyMetric[];
  currentTotals: ReturnType<typeof sumMetrics>;
  previousTotals: ReturnType<typeof sumMetrics>;
  period: { start: string; end: string; days: number };
}

export interface ReportSource {
  /** Aparece nas mensagens de erro; ajuda a distinguir cron de tela. */
  readonly kind: "session" | "system";
  findClient(slug: string): Promise<Client | null>;
  listTemplates(): Promise<ReportTemplate[]>;
  metrics(clientId: string, start: string, end: string): Promise<MetricsWindow>;
  creatives(clientId: string, limit: number): Promise<AdCreative[]>;
  /**
   * A meta que cobre o período do relatório.
   *
   * Existe por causa da MENSAGEM, não do documento: é `results_metric`
   * que decide se a conta chama o resultado de "Pedidos" ou de
   * "Faturamento", e sem isso o texto enviado sairia com o rótulo
   * genérico enquanto a tela mostra o específico.
   *
   * `null` quando não há meta no período — aí o segmento decide o
   * rótulo, que é o mesmo que a tela faz.
   */
  goal(
    clientId: string,
    start: string,
    end: string,
  ): Promise<{ results_metric: "count" | "revenue" | null } | null>;
  /** Cliente Supabase usado para gravar em `report_history`. */
  db(): Promise<ReportWriter>;
  /** Quem fica em `generated_by`. O cron não tem ninguém: null. */
  actorId(): Promise<string | null>;
}

/**
 * Só o que o orquestrador usa de fato para escrever o histórico.
 *
 * Tipado por estrutura em vez de importar `SupabaseClient`: os dois
 * clientes vêm de pacotes diferentes (`@supabase/ssr` e
 * `@supabase/supabase-js`) e seus tipos genéricos não se unificam sem
 * um cast que esconderia divergências reais.
 */
export interface ReportWriter {
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: unknown }>;
    };
  };
}

/* ------------------------------------------------------------------ */
/* Origem da tela — RLS                                                */
/* ------------------------------------------------------------------ */

export function sessionSource(): ReportSource {
  return {
    kind: "session",
    findClient: (slug) => getClientBySlug(slug),
    listTemplates: () => getReportTemplates(),
    metrics: async (clientId, start, end) => {
      const m = await getMetricsWithComparison(clientId, start, end);
      return {
        current: m.current,
        previous: m.previous,
        currentTotals: m.currentTotals,
        previousTotals: m.previousTotals,
        period: m.period,
      };
    },
    creatives: (clientId, limit) => getCreatives(clientId, limit),
    goal: async (clientId, start, end) => {
      if (isDemoMode) {
        const { demoGoals } = await import("@/lib/mock/data");
        return metaQueCobre(demoGoals, clientId, start, end);
      }
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase
        .from("client_goals")
        .select("client_id, period_start, period_end, results_metric")
        .eq("client_id", clientId);
      return metaQueCobre(data ?? [], clientId, start, end);
    },
    db: async () => (await createSupabaseServerClient()) as unknown as ReportWriter,
    actorId: async () => {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Origem do cron — service_role                                       */
/* ------------------------------------------------------------------ */

export function systemSource(): ReportSource {
  return {
    kind: "system",

    findClient: async (slug) => {
      if (isDemoMode) {
        const { demoClients } = await import("@/lib/mock/data");
        return demoClients.find((c) => c.slug === slug) ?? null;
      }
      const { data } = await createSupabaseAdminClient()
        .from("clients")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      return (data as Client) ?? null;
    },

    listTemplates: async () => {
      if (isDemoMode) {
        const { demoTemplates } = await import("@/lib/mock/data");
        return demoTemplates;
      }
      const { data } = await createSupabaseAdminClient()
        .from("report_templates")
        .select("*")
        .order("name");
      return (data ?? []) as ReportTemplate[];
    },

    metrics: async (clientId, start, end) => {
      const prev = previousPeriod(start, end);

      /* A mesma lista que o sync usou para escrever `conversions`. É ela
         que diz qual família de campanha é a origem do resultado, e sem
         ela `sumMetrics` volta a dividir pelo gasto da conta inteira. */
      const tipos = await tiposDeConversaoDoCliente(clientId);

      if (isDemoMode) {
        const { demoMetrics } = await import("@/lib/mock/data");
        const janela = (a: string, b: string) =>
          demoMetrics.filter(
            (m) =>
              m.client_id === clientId &&
              m.metric_date >= a &&
              m.metric_date <= b,
          );
        const current = janela(start, end);
        const previous = janela(prev.start, prev.end);
        return {
          current,
          previous,
          currentTotals: sumMetrics(current, tipos),
          previousTotals: sumMetrics(previous, tipos),
          period: { start, end, days: prev.days },
        };
      }

      const admin = createSupabaseAdminClient();
      const janela = (a: string, b: string) =>
        admin
          .from("daily_metrics")
          .select("*")
          .eq("client_id", clientId)
          .gte("metric_date", a)
          .lte("metric_date", b)
          .order("metric_date");

      const [atual, anterior] = await Promise.all([
        janela(start, end),
        janela(prev.start, prev.end),
      ]);

      const current = (atual.data ?? []) as DailyMetric[];
      const previous = (anterior.data ?? []) as DailyMetric[];

      return {
        current,
        previous,
        currentTotals: sumMetrics(current, tipos),
        previousTotals: sumMetrics(previous, tipos),
        period: { start, end, days: prev.days },
      };
    },

    creatives: async (clientId, limit) => {
      if (isDemoMode) {
        const { demoCreatives } = await import("@/lib/mock/data");
        return demoCreatives
          .filter((c) => c.client_id === clientId && c.is_active)
          .sort((a, b) => b.spend_cents - a.spend_cents)
          .slice(0, limit);
      }
      const { data } = await createSupabaseAdminClient()
        .from("ad_creatives")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .order("spend_cents", { ascending: false })
        .limit(limit);
      return (data ?? []) as AdCreative[];
    },

    goal: async (clientId, start, end) => {
      if (isDemoMode) {
        const { demoGoals } = await import("@/lib/mock/data");
        return metaQueCobre(demoGoals, clientId, start, end);
      }
      const { data } = await createSupabaseAdminClient()
        .from("client_goals")
        .select("client_id, period_start, period_end, results_metric")
        .eq("client_id", clientId);
      return metaQueCobre(data ?? [], clientId, start, end);
    },

    db: async () => createSupabaseAdminClient() as unknown as ReportWriter,

    // Ninguém disparou: o autor é o sistema.
    actorId: async () => null,
  };
}

/* ------------------------------------------------------------------ */

interface LinhaDeMeta {
  client_id: string;
  period_start: string;
  period_end: string;
  results_metric: "count" | "revenue" | null;
}

/**
 * A meta que cobre a janela do relatório — e não a vigente hoje.
 *
 * A diferença aparece no dia 3, gerando o fechamento do mês passado: a
 * meta de hoje já é a do mês novo, e se a conta trocou de unidade entre
 * os dois (contagem → faturamento) o número de agosto sairia rotulado
 * com a unidade de setembro. Rotular o passado com a régua do presente
 * é o mesmo defeito que a coluna `results_metric` foi criada para
 * evitar — ver a migration 20260806000025.
 *
 * "Cobre" é sobreposição, não contenção: relatório de 20 a 21 de agosto
 * está dentro da meta de agosto, e uma janela que atravessa a virada do
 * mês pega a primeira que encostar. Sem nenhuma, devolve `null` e quem
 * chama cai no padrão do segmento — que é o que a tela faz.
 */
function metaQueCobre(
  linhas: LinhaDeMeta[],
  clientId: string,
  start: string,
  end: string,
): { results_metric: "count" | "revenue" | null } | null {
  const daConta = linhas.filter((g) => g.client_id === clientId);

  const cobre = daConta.find(
    (g) => g.period_start <= end && g.period_end >= start,
  );

  if (cobre) return { results_metric: cobre.results_metric };

  /* Sem meta no período, a mais recente ainda diz em que unidade esta
     conta pensa. É melhor que o padrão do segmento, que chutaria
     "Faturamento" numa pizzaria que sempre mediu pedidos. */
  const maisRecente = daConta.sort((a, b) =>
    b.period_start.localeCompare(a.period_start),
  )[0];

  return maisRecente ? { results_metric: maisRecente.results_metric } : null;
}
