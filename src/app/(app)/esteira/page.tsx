import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, Repeat } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { PipelineWorkspace } from "@/components/pipeline/pipeline-workspace";
import {
  getClientOptimizations,
  getOptimizationPipeline,
  getTeam,
} from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { WEEKDAY_LABELS } from "@/lib/validation/client";
import type { OptimizationEntry } from "@/types/database";

export const metadata: Metadata = { title: "Esteira" };

/**
 * Esteira de otimizações.
 *
 * A rotina de tráfego é semanal: cada conta tem um dia fixo em que
 * alguém entra, mexe e registra. Esta tela é a lista do que precisa ser
 * tocado e a prova do que já foi.
 *
 * Sem cache: duas pessoas usam a esteira ao mesmo tempo, e uma lista
 * velha faz alguém refazer o que o colega acabou de entregar.
 */
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [pipeline, team] = await Promise.all([
    getOptimizationPipeline(),
    getTeam(),
  ]);

  /* Histórico de todas as contas da esteira, carregado junto.
     Buscar sob demanda ao abrir a gaveta daria um "carregando" a cada
     clique numa tela feita para percorrer conta a conta. */
  const historico = await Promise.all(
    pipeline.clients.map(async (p) => [
      p.client.id,
      await getClientOptimizations(p.client.id, 10),
    ] as const),
  );

  const historyByClient: Record<string, OptimizationEntry[]> =
    Object.fromEntries(historico);

  const hojeLabel = pipeline.todayWeekday
    ? WEEKDAY_LABELS[pipeline.todayWeekday]
    : "fim de semana";

  return (
    <PageContainer>
      <PageHeader
        title="Esteira de otimizações"
        description={`Rotina semanal por conta. Hoje é ${hojeLabel.toLowerCase()}.`}
      />

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <StatCard
          icon={Repeat}
          label="Com rotina"
          value={pipeline.counts.comRotina}
          hint="contas ativas na esteira"
        />
        <StatCard
          icon={CalendarCheck}
          label="Hoje"
          value={pipeline.counts.hoje}
          hint={
            pipeline.todayWeekday
              ? "meta do dia"
              : "sem rotina no fim de semana"
          }
        />
        <StatCard
          icon={CheckCircle2}
          label="Feitos hoje"
          value={pipeline.counts.feitosHoje}
          hint="rodadas registradas"
        />
        <StatCard
          icon={AlertTriangle}
          label="Atrasados"
          value={pipeline.counts.atrasados}
          hint="dia já passou nesta semana"
          /* Destaque só quando há atraso. Card vermelho marcando zero
             ensina a ignorar a cor. */
          tone={pipeline.counts.atrasados > 0 ? "alerta" : "neutro"}
        />
      </div>

      {pipeline.counts.comRotina === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-hairline py-16 text-center">
          <Repeat className="mx-auto size-7 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Nenhuma conta na esteira</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-xs text-muted-foreground">
            Defina o dia de otimização no cadastro do cliente para ele
            aparecer aqui.
          </p>
        </div>
      ) : (
        <PipelineWorkspace
          pipeline={pipeline.clients}
          team={team}
          currentUserId={user.id}
          ehAdmin={user.role === "admin"}
          historyByClient={historyByClient}
          todayWeekday={pipeline.todayWeekday}
        />
      )}
    </PageContainer>
  );
}
