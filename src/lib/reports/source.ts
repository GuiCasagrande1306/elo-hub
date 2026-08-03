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
        currentTotals: m.currentTotals,
        previousTotals: m.previousTotals,
        period: m.period,
      };
    },
    creatives: (clientId, limit) => getCreatives(clientId, limit),
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
        return {
          current,
          currentTotals: sumMetrics(current),
          previousTotals: sumMetrics(janela(prev.start, prev.end)),
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

      return {
        current,
        currentTotals: sumMetrics(current),
        previousTotals: sumMetrics((anterior.data ?? []) as DailyMetric[]),
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

    db: async () => createSupabaseAdminClient() as unknown as ReportWriter,

    // Ninguém disparou: o autor é o sistema.
    actorId: async () => null,
  };
}
