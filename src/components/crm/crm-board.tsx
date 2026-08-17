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

import { DealCard, DealCardShell } from "./deal-card";
import { ETAPAS, valorDoNegocio } from "@/lib/crm/stages";
import { formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealStage, DealWithRelations } from "@/types/database";

/**
 * O quadro do funil.
 *
 * Mesma mecânica do quadro de tarefas — índice fracionário e atualização
 * otimista —, e de propósito: são dois quadros no mesmo produto, e um
 * arraste que se comporta diferente em cada um é o tipo de detalhe que
 * faz o sistema parecer costurado de pedaços.
 *
 * O QUE ESTE QUADRO TEM A MAIS: total por coluna no cabeçalho. É o que
 * transforma "cinco cartões em Proposta" em "R$ 84 mil em proposta", que
 * é a pergunta que uma reunião comercial faz de verdade.
 */

const GAP = 1000;

export function CrmBoard({
  deals,
  onOpen,
  onMove,
}: {
  deals: DealWithRelations[];
  onOpen: (id: string) => void;
  /** Devolve `false` quando o movimento é recusado — a tela desfaz. */
  onMove: (id: string, stage: DealStage, position: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, { stage: DealStage; position: number }>
  >({});

  const sensors = useSensors(
    // 6px de tolerância: sem isso, clicar para abrir vira início de
    // arraste e a ficha do negócio nunca abre.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const merged = useMemo(
    () => deals.map((d) => ({ ...d, ...(overrides[d.id] ?? {}) })),
    [deals, overrides],
  );

  const colunas = useMemo(() => {
    const mapa = new Map<DealStage, DealWithRelations[]>();
    for (const e of ETAPAS) mapa.set(e.id, []);
    for (const d of merged) mapa.get(d.stage)?.push(d);
    // Maior posição no topo: o que entrou por último aparece primeiro.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => b.position - a.position);
    }
    return mapa;
  }, [merged]);

  const ativo = merged.find((d) => d.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const dealId = String(active.id);
    const deal = merged.find((d) => d.id === dealId);
    if (!deal) return;

    const overId = String(over.id);
    const overDeal = merged.find((d) => d.id === overId);

    // O alvo pode ser a coluna vazia (id = etapa) ou outro cartão.
    const destino = (overDeal?.stage ??
      (over.data.current?.stage as DealStage | undefined) ??
      ETAPAS.find((e) => e.id === overId)?.id) as DealStage | undefined;

    if (!destino) return;
    if (destino === deal.stage && overId === dealId) return;

    const naColuna = (colunas.get(destino) ?? []).filter((d) => d.id !== dealId);

    const indice = overDeal
      ? naColuna.findIndex((d) => d.id === overDeal.id)
      : naColuna.length;

    /* Índice fracionário entre os vizinhos. A coluna está em ordem
       DECRESCENTE de posição, então "antes" na lista é o de valor MAIOR
       — inverter isso aqui faria o cartão pular de lugar ao soltar. */
    const acima = naColuna[indice - 1]?.position;
    const abaixo = naColuna[indice]?.position;

    let position: number;
    if (acima === undefined && abaixo === undefined) position = Date.now();
    else if (acima === undefined) position = abaixo! + GAP;
    else if (abaixo === undefined) position = acima - GAP;
    else position = (acima + abaixo) / 2;

    setOverrides((prev) => ({ ...prev, [dealId]: { stage: destino, position } }));
    onMove(dealId, destino, position);
  }

  return (
    <DndContext
      /* `id` fixo pelo mesmo motivo do quadro de tarefas: sem ele o
         dnd-kit gera um contador próprio, que sai diferente no servidor e
         no cliente e produz aviso de hidratação a cada carga. */
      id="quadro-comercial"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4">
        {ETAPAS.map((etapa) => (
          <Coluna
            key={etapa.id}
            stage={etapa.id}
            label={etapa.label}
            dot={etapa.dot}
            deals={colunas.get(etapa.id) ?? []}
            onOpen={onOpen}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}
      >
        {ativo ? (
          <div className="w-[288px]">
            <DealCardShell deal={ativo} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Coluna({
  stage,
  label,
  dot,
  deals,
  onOpen,
}: {
  stage: DealStage;
  label: string;
  dot: string;
  deals: DealWithRelations[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } });
  const total = deals.reduce((soma, d) => soma + valorDoNegocio(d), 0);

  return (
    <section className="flex w-[288px] shrink-0 snap-start flex-col">
      <header className="flex items-center gap-2 px-1 pb-2.5">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
        <h2 className="truncate text-sm font-semibold">{label}</h2>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
          {deals.length}
        </span>
        {/* Compacto porque a coluna tem 288px e o total pode passar de
            um milhão. "R$ 1,2 mi" cabe; o número por extenso empurraria
            a contagem para fora. */}
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
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onOpen={onOpen} />
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <p className="px-2 py-6 text-center text-2xs text-muted-foreground/60">
            nada aqui
          </p>
        )}
      </div>
    </section>
  );
}
