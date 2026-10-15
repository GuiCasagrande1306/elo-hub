"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { LeadCard, LeadCardShell } from "./lead-card";
import { corDaEtapa } from "@/lib/leads/vocabulario";
import { formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeadStage, LeadWithRelations } from "@/types/database";

/**
 * O quadro do funil de leads.
 *
 * Mesma mecânica do quadro comercial e do de tarefas — índice
 * fracionário e movimento otimista — e de propósito: são três quadros no
 * mesmo produto, e um arraste que se comporta diferente em cada um é o
 * tipo de detalhe que faz o sistema parecer costurado de pedaços.
 *
 * O QUE ESTE TEM DE DIFERENTE: as colunas vêm do BANCO, não de uma lista
 * fixa. Cada cliente desenha o próprio funil em `lead_stages`, com nome
 * e cor que ele escolheu — então a cor sai em `style`, e não como classe
 * do Tailwind. Um mapa de hex para classe só aceitaria as cores que
 * alguém previu, e o cliente que escolher outra ficaria sem marcador.
 */

const GAP = 1000;

export function LeadsBoard({
  stages,
  leads,
  onOpen,
  onMove,
}: {
  stages: LeadStage[];
  leads: LeadWithRelations[];
  onOpen: (id: string) => void;
  onMove: (id: string, stageId: string, position: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, { stage_id: string; position: number }>
  >({});

  const sensors = useSensors(
    // 6px de tolerância: sem isso, clicar para abrir vira início de
    // arraste e a ficha do lead nunca abre.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const merged = useMemo(
    () => leads.map((l) => ({ ...l, ...(overrides[l.id] ?? {}) })),
    [leads, overrides],
  );

  const colunas = useMemo(() => {
    const mapa = new Map<string, LeadWithRelations[]>();
    for (const e of stages) mapa.set(e.id, []);
    for (const l of merged) mapa.get(l.stage_id)?.push(l);
    // Maior posição no topo: o que entrou por último aparece primeiro.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => b.position - a.position);
    }
    return mapa;
  }, [merged, stages]);

  const ativo = merged.find((l) => l.id === activeId) ?? null;
  const kindDoAtivo =
    stages.find((e) => e.id === ativo?.stage_id)?.kind ?? "aberto";

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const leadId = String(active.id);
    const lead = merged.find((l) => l.id === leadId);
    if (!lead) return;

    const overId = String(over.id);
    const overLead = merged.find((l) => l.id === overId);

    // O alvo pode ser a coluna vazia (id = etapa) ou outro cartão.
    const destino =
      overLead?.stage_id ??
      (over.data.current?.stageId as string | undefined) ??
      stages.find((e) => e.id === overId)?.id;

    if (!destino) return;
    if (destino === lead.stage_id && overId === leadId) return;

    const naColuna = (colunas.get(destino) ?? []).filter((l) => l.id !== leadId);

    const indice = overLead
      ? naColuna.findIndex((l) => l.id === overLead.id)
      : naColuna.length;

    /* Índice fracionário entre os vizinhos. A coluna está em ordem
       DECRESCENTE de posição, então "antes" na lista é o de valor MAIOR
       — inverter isso faria o cartão pular de lugar ao soltar. */
    const acima = naColuna[indice - 1]?.position;
    const abaixo = naColuna[indice]?.position;

    let position: number;
    if (acima === undefined && abaixo === undefined) position = Date.now();
    else if (acima === undefined) position = abaixo! + GAP;
    else if (abaixo === undefined) position = acima - GAP;
    else position = (acima + abaixo) / 2;

    setOverrides((prev) => ({
      ...prev,
      [leadId]: { stage_id: destino, position },
    }));
    onMove(leadId, destino, position);
  }

  return (
    <DndContext
      /* `id` fixo pelo mesmo motivo dos outros quadros: sem ele o dnd-kit
         gera um contador próprio, que sai diferente no servidor e no
         cliente e produz aviso de hidratação a cada carga. */
      id="quadro-leads"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
        {stages.map((etapa) => (
          <Coluna
            key={etapa.id}
            etapa={etapa}
            leads={colunas.get(etapa.id) ?? []}
            onOpen={onOpen}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}
      >
        {ativo ? (
          <div className="w-[288px]">
            <LeadCardShell lead={ativo} kind={kindDoAtivo} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Coluna({
  etapa,
  leads,
  onOpen,
}: {
  etapa: LeadStage;
  leads: LeadWithRelations[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: etapa.id,
    data: { stageId: etapa.id },
  });

  const total = leads.reduce((soma, l) => soma + l.value_cents, 0);

  return (
    <section className="flex w-[288px] shrink-0 snap-start flex-col">
      <header className="flex items-center gap-2 px-1 pb-2.5">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: corDaEtapa(etapa.color) }}
        />
        <h2 className="truncate text-sm font-semibold">{etapa.name}</h2>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
          {leads.length}
        </span>

        {/* Compacto porque a coluna tem 288px. "R$ 1,2 mi" cabe; o número
            por extenso empurraria a contagem para fora. */}
        {total > 0 && (
          <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
            {formatCurrencyCompact(total)}
          </span>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-1 transition-colors",
          isOver && "bg-accent",
        )}
      >
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              kind={etapa.kind}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <p className="px-2 py-6 text-center text-2xs text-muted-foreground/60">
            nada aqui
          </p>
        )}
      </div>
    </section>
  );
}
