"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { Radio, Search, SlidersHorizontal } from "lucide-react";

import { ClientCard } from "./client-card";
import { MonthFilter } from "./month-filter";
import { AgencyFilter } from "./agency-filter";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildGoalProgress, type GoalProgressPair } from "@/lib/metrics/goals";
import { goalExecutedFrom, goalMetricFor } from "@/lib/metrics/goal-metric";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { isDemoMode } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { Client, ClientGoal, ClientSegment } from "@/types/database";

/* =====================================================================
   Diretório de clientes
   ---------------------------------------------------------------------
   Estratégia de Realtime em duas camadas, porque nem todo dado se
   atualiza do mesmo jeito:

   1. `client_goals` — a linha da meta é plana e chega inteira no
      payload. Aplicamos direto no estado local: a barra se move no
      MESMO FRAME em que o evento chega, sem esperar round-trip.

   2. `daily_metrics` — o executado é uma AGREGAÇÃO de milhares de
      linhas. Recalcular isso no browser exigiria reimplementar a soma e
      o filtro de RLS no cliente. Aqui a resposta certa é revalidar no
      servidor (`router.refresh()`), que refaz a query e reconcilia só o
      que mudou, sem perder scroll nem estado dos filtros.

   O patch local é descartado assim que dados novos do servidor chegam —
   senão um valor otimista ficaria mascarando a verdade indefinidamente.
   ===================================================================== */

export interface DirectoryRow {
  client: Client;
  goal: ClientGoal | null;
  computedSpendCents: number;
  computedResults: number;
  computedRevenueCents: number;
  trend: number[];
  /** Calculado no servidor — ver a nota em `ClientCardProps.progress`. */
  progress: GoalProgressPair | null;
}

const ALL = "__all__";

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

const STATUS_LABELS: Record<Client["status"], string> = {
  active: "Ativo",
  onboarding: "Onboarding",
  paused: "Pausado",
  lead: "Lead",
  churned: "Encerrado",
};

export function ClientsDirectory({
  rows,
  month,
  agency,
}: {
  rows: DirectoryRow[];
  /** Mês exibido, "YYYY-MM". Vem da URL, resolvido no servidor. */
  month: string;
  /** Agência filtrada, "" = todas. Também da URL. */
  agency: string;
}) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [segmentFilter, setSegmentFilter] = useState<string>(ALL);
  const [liveAt, setLiveAt] = useState<string | null>(null);

  // Patch otimista das metas. Guarda a referência de `rows` que o
  // originou: quando o servidor devolve dados novos, `rows` muda de
  // identidade e o patch é ignorado sem precisar de setState em efeito.
  const [patch, setPatch] = useState<{
    base: DirectoryRow[];
    goals: Record<string, ClientGoal>;
  }>({ base: rows, goals: {} });

  const liveGoals = patch.base === rows ? patch.goals : {};

  // Métricas: agregação pesada demais para recalcular no browser.
  useRealtimeRefresh("daily_metrics");
  useRealtimeRefresh("clients");

  /* ---------------- Assinatura das metas ---------------------------- */
  useEffect(() => {
    if (isDemoMode) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

     
    console.log("📡 Assinando client_goals…");

    const channel = supabase
      .channel("clients-directory-goals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_goals" },
        (payload: RealtimePostgresChangesPayload<ClientGoal>) => {
          const goal = (payload.new ?? payload.old) as ClientGoal | undefined;
          if (!goal?.client_id) return;

           
          console.log(`🔄 Meta atualizada: ${goal.client_id}`, payload.eventType);

          setLiveAt(new Date().toLocaleTimeString("pt-BR"));

          if (payload.eventType === "DELETE") {
            // Sem a linha, o card volta ao estado "sem meta". Deixamos o
            // servidor resolver — patch local não representa remoção.
            router.refresh();
            return;
          }

          setPatch((prev) => ({
            base: rows,
            goals: {
              ...(prev.base === rows ? prev.goals : {}),
              [goal.client_id]: goal,
            },
          }));

          // O executado continua vindo de daily_metrics: revalida em
          // segundo plano para os números derivados acompanharem.
          router.refresh();
        },
      )
      .subscribe((status: string) => {
         
        console.log(`📶 client_goals: ${status}`);
      });

    return () => {
       
      console.log("🔌 Removendo canal client_goals.");
      supabase.removeChannel(channel);
    };
  }, [rows, router]);

  /* ---------------- Filtragem --------------------------------------- */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return rows.filter(({ client }) => {
      if (statusFilter !== ALL && client.status !== statusFilter) return false;
      if (segmentFilter !== ALL && client.segment !== segmentFilter) return false;
      if (!needle) return true;

      return (
        client.name.toLowerCase().includes(needle) ||
        (client.legal_name?.toLowerCase().includes(needle) ?? false) ||
        (client.contact_name?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [rows, query, statusFilter, segmentFilter]);

  // Só ofereço filtros que existem na carteira visível — um select com
  // opções que nunca retornam nada é ruído.
  const availableSegments = useMemo(
    () => [...new Set(rows.map((r) => r.client.segment))],
    [rows],
  );
  const availableStatuses = useMemo(
    () => [...new Set(rows.map((r) => r.client.status))],
    [rows],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de busca e filtros --------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, razão social ou contato…"
            className="h-9 pl-8"
            aria-label="Buscar cliente"
          />
        </div>

        {/* Mês primeiro: ele muda de onde os NÚMEROS vêm, enquanto
            status e nicho só escondem linhas da mesma carteira. */}
        <MonthFilter value={month} agency={agency} />

        {/* Junto do mês porque os dois vivem na URL e recarregam do
            servidor — status e nicho apenas escondem linhas já
            carregadas. */}
        <AgencyFilter value={agency} month={month} />

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Status">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os status"
                  : STATUS_LABELS[value as Client["status"]]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {availableStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={segmentFilter}
          onValueChange={(value) => setSegmentFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Nicho">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os nichos"
                  : SEGMENT_LABELS[value as ClientSegment]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os nichos</SelectItem>
            {availableSegments.map((s) => (
              <SelectItem key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="ml-auto flex items-center gap-1.5 text-2xs text-muted-foreground">
          {liveAt ? (
            <>
              <Radio className="size-3 text-signal" />
              atualizado {liveAt}
            </>
          ) : (
            <>
              {filtered.length} de {rows.length}
            </>
          )}
        </span>
      </div>

      {/* Grid ------------------------------------------------------ */}
      {filtered.length === 0 ? (
        <EmptyState hasClients={rows.length > 0} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((row, index) => {
            // Sem evento do Realtime, usa o progresso calculado no
            // servidor — é o que evita divergência de hidratação.
            // Com evento, recalcula aqui: já estamos pós-hidratação e
            // a barra precisa se mover na hora.
            const patched = liveGoals[row.client.id];

            /* A unidade vem da meta, e o Realtime pode ter acabado de
               trazer uma meta em outra unidade — salvar "faturamento"
               num cliente que era contagem chega por aqui. Por isso o
               indicador é resolvido junto do progresso, e não fixado
               uma vez no servidor. */
            const metric = goalMetricFor(
              row.client.segment,
              (patched ?? row.goal)?.results_metric,
            );

            const totals = {
              conversions: row.computedResults,
              revenueCents: row.computedRevenueCents,
            };

            const progress = patched
              ? buildGoalProgress({
                  goal: patched,
                  metric,
                  computedSpendCents: row.computedSpendCents,
                  computedConversions: row.computedResults,
                  computedRevenueCents: row.computedRevenueCents,
                })
              : row.progress;

            return (
              <ClientCard
                key={row.client.id}
                index={index}
                client={row.client}
                progress={progress}
                metric={metric}
                computedSpendCents={row.computedSpendCents}
                computedGoalValue={goalExecutedFrom(metric, totals)}
                trend={row.trend}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasClients }: { hasClients: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline py-16 text-center">
      <SlidersHorizontal className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">
        {hasClients ? "Nenhum cliente com esses filtros" : "Nenhum cliente ainda"}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {hasClients
          ? "Ajuste a busca ou limpe os filtros."
          : "Cadastre a primeira conta para começar a acompanhar metas."}
      </p>
    </div>
  );
}

export { cn };
