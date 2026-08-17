"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Clock } from "lucide-react";

import { OptimizationSheet } from "./optimization-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtimeRefresh, useRefreshAoVoltar } from "@/hooks/use-realtime";
import { WEEKDAY_LABELS } from "@/lib/validation/client";
import { cn } from "@/lib/utils";
import type {
  Client,
  OptimizationEntry,
  Profile,
} from "@/types/database";
import type { PipelineClient } from "@/lib/data";

/* =====================================================================
   Esteira — agrupamento por dia
   ---------------------------------------------------------------------
   Cinco blocos fixos, segunda a sexta, mesmo os vazios. Esconder o dia
   sem conta faria a lista "pular" de terça para quinta, e quem usa a
   esteira lê pela posição: o bloco de hoje precisa estar sempre no
   mesmo lugar.
   ===================================================================== */

const TODOS = "__todos__";

export function PipelineWorkspace({
  pipeline,
  team,
  currentUserId,
  ehAdmin,
  historyByClient,
  todayWeekday,
}: {
  pipeline: PipelineClient[];
  team: Profile[];
  currentUserId: string;
  /** Admin edita otimização de qualquer pessoa; colaborador, só a sua. */
  ehAdmin: boolean;
  historyByClient: Record<string, OptimizationEntry[]>;
  /** Dia útil de hoje (1-5), ou null no fim de semana. */
  todayWeekday: number | null;
}) {
  const [aberta, setAberta] = useState<Client | null>(null);
  const [responsavel, setResponsavel] = useState(TODOS);
  const [visao, setVisao] = useState<"todos" | "meus">("todos");

  // Alguém do time registrou uma rodada → a lista se atualiza sozinha.
  /* Rede de segurança independente do socket: evento perdido enquanto
     a aba esteve escondida não chega por Realtime nenhum. Uma tela
     aberta desde quinta já mostrou três dias de dado velho. */
  useRefreshAoVoltar();
  useRealtimeRefresh("optimization_history");

  const filtrada = useMemo(
    () =>
      pipeline.filter((p) => {
        if (visao === "meus" && p.client.owner_id !== currentUserId) {
          return false;
        }
        if (responsavel !== TODOS && p.client.owner_id !== responsavel) {
          return false;
        }
        return true;
      }),
    [pipeline, visao, responsavel, currentUserId],
  );

  /* O dia vem do SERVIDOR. Calcular aqui seria impuro no render e
     divergiria na virada da meia-noite entre o HTML servido e o
     navegador — o mesmo erro que já apareceu no corte de tarefas
     concluídas e no marcador de ritmo das metas. */
  const diaDeHoje = todayWeekday;

  return (
    <>
      {/* Filtros ---------------------------------------------------- */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Select value={visao} onValueChange={(v) => setVisao(v as "todos" | "meus")}>
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue>
              {(v: string) => (v === "meus" ? "Minhas contas" : "Todas as contas")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as contas</SelectItem>
            <SelectItem value="meus">Minhas contas</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={responsavel}
          onValueChange={(v) => setResponsavel(v ?? TODOS)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-52">
            <SelectValue>
              {(v: string) =>
                v === TODOS
                  ? "Todos os responsáveis"
                  : (team.find((p) => p.id === v)?.full_name ??
                    "Todos os responsáveis")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
            {team.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Blocos por dia --------------------------------------------- */}
      <div className="mt-6 flex flex-col gap-4">
        {[1, 2, 3, 4, 5].map((dia) => {
          const doDia = filtrada.filter(
            (p) => p.client.optimization_day === dia,
          );
          const ehHoje = dia === diaDeHoje;

          return (
            <section
              key={dia}
              className={cn(
                "surface-card overflow-hidden",
                ehHoje && "ring-2 ring-signal/45",
              )}
            >
              <header className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
                <h2 className="text-sm font-semibold">{WEEKDAY_LABELS[dia]}</h2>

                {ehHoje && (
                  <span className="rounded-full bg-signal-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal">
                    Hoje
                  </span>
                )}

                <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                  {doDia.filter((p) => p.doneThisWeek).length}/{doDia.length}
                </span>
              </header>

              {doDia.length === 0 ? (
                <p className="px-4 py-5 text-xs text-muted-foreground">
                  Nenhuma conta neste dia.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {doDia.map((p) => (
                    <li key={p.client.id}>
                      <button
                        type="button"
                        onClick={() => setAberta(p.client)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                      >
                        <span
                          aria-hidden
                          className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                          style={{
                            backgroundColor: p.client.brand_primary ?? "#8a8a8a",
                          }}
                        />

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {p.client.name}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                            {p.last
                              ? `última: ${p.last.collaborator?.full_name ?? "—"}`
                              : "sem registro"}
                          </span>
                        </span>

                        {/* Estado da semana, não do dia: a esteira é
                            semanal, e uma conta feita na terça continua
                            feita na quinta. */}
                        {p.doneThisWeek ? (
                          <span className="flex shrink-0 items-center gap-1 text-2xs font-medium text-positive">
                            <CheckCircle2 className="size-3.5" />
                            feito
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "flex shrink-0 items-center gap-1 text-2xs",
                              diaDeHoje !== null && dia < diaDeHoje
                                ? "font-medium text-negative"
                                : "text-muted-foreground",
                            )}
                          >
                            <Clock className="size-3.5" />
                            {diaDeHoje !== null && dia < diaDeHoje
                              ? "atrasado"
                              : "pendente"}
                          </span>
                        )}

                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <OptimizationSheet
        client={aberta}
        history={aberta ? (historyByClient[aberta.id] ?? []) : []}
        usuarioId={currentUserId}
        ehAdmin={ehAdmin}
        equipe={team}
        open={Boolean(aberta)}
        onOpenChange={(o) => {
          if (!o) setAberta(null);
        }}
      />
    </>
  );
}
