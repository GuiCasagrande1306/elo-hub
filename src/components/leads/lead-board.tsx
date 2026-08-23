"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { moverLead } from "@/app/(app)/crm/actions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  posicaoEntre,
  type LeadDeal,
  type LeadStage,
} from "@/lib/crm/types";
import { LeadCard } from "./lead-card";

/* =====================================================================
   O quadro
   ---------------------------------------------------------------------
   ARRASTAR PRECISA PARECER INSTANTÂNEO. Um card que fica meio segundo
   parado no lugar antigo enquanto o servidor responde ensina a pessoa a
   arrastar duas vezes — e a segunda cria o movimento errado.

   Por isso `useOptimistic`: o card muda de coluna no mesmo quadro em que
   o dedo solta, e a gravação acontece atrás. Se o servidor recusar, o
   estado volta sozinho e um aviso diz o motivo. O que não pode acontecer
   é o contrário — parecer que salvou quando não salvou.

   `PointerSensor` com distância mínima de 6px: sem isso, um toque para
   ABRIR o card era interpretado como início de arrasto, e a ficha nunca
   abria no celular.
   ===================================================================== */

interface Props {
  stages: LeadStage[];
  deals: LeadDeal[];
  onAbrir: (deal: LeadDeal) => void;
  onNovo: (stageId: string) => void;
}

export function LeadBoard({ stages, deals, onAbrir, onNovo }: Props) {
  const router = useRouter();
  const [arrastando, setArrastando] = useState<LeadDeal | null>(null);
  const [, iniciar] = useTransition();

  /* O estado otimista guarda só o que muda: onde cada card está. */
  const [posicoes, aplicar] = useOptimistic(
    deals,
    (atual: LeadDeal[], mudanca: { dealId: string; stageId: string; position: number }) =>
      atual.map((d) =>
        d.id === mudanca.dealId
          ? { ...d, stage_id: mudanca.stageId, position: mudanca.position }
          : d,
      ),
  );

  const porEtapa = useMemo(() => {
    const mapa = new Map<string, LeadDeal[]>();
    for (const s of stages) mapa.set(s.id, []);
    for (const d of posicoes) mapa.get(d.stage_id)?.push(d);
    for (const lista of mapa.values()) lista.sort((a, b) => a.position - b.position);
    return mapa;
  }, [stages, posicoes]);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function aoComecar(e: DragStartEvent) {
    setArrastando(posicoes.find((d) => d.id === e.active.id) ?? null);
  }

  function aoSoltar(e: DragEndEvent) {
    setArrastando(null);

    const dealId = String(e.active.id);
    const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;

    const etapa = stages.find((s) => s.id === destino);
    if (!etapa) return;

    const deal = posicoes.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === etapa.id) return;

    /* Entra no topo da coluna de destino. Kommo e Pipedrive soltam onde
       o dedo largou; aqui o topo é escolha: quem move um lead para
       "Proposta" acabou de agir nele, e ele é o próximo a tratar. */
    const naColuna = porEtapa.get(etapa.id) ?? [];
    const posicao = posicaoEntre(null, naColuna[0]?.position ?? null) ?? 0;

    const fecha = etapa.kind !== "aberto";

    iniciar(async () => {
      aplicar({ dealId, stageId: etapa.id, position: posicao });

      const r = await moverLead({ dealId, stageId: etapa.id, position: posicao, fecha });

      if (!r.ok) {
        toast.error(r.error);
        /* `refresh` devolve a verdade do servidor. Sem ele o card fica
           na coluna nova para sempre, e a tela passa a mentir. */
        router.refresh();
        return;
      }

      router.refresh();
    });
  }

  return (
    /* `id` FIXO. Sem ele o dnd-kit numera seus próprios identificadores
       com um contador que começa do zero em cada ambiente, e o
       `aria-describedby` que sai do servidor ("DndDescribedBy-0") não
       bate com o que o navegador gera ("DndDescribedBy-1"). O React
       reclama de hidratação em toda abertura do quadro — medido em
       23/08/2026 — e o aviso, repetido, esconde os erros que importam.

       `id` também é o que faz dois quadros na mesma página não
       colidirem, se um dia houver. */
    <DndContext
      id="funil-de-leads"
      sensors={sensores}
      onDragStart={aoComecar}
      onDragEnd={aoSoltar}
    >
      {/* Rolagem horizontal no celular, colunas lado a lado no desktop.
          `snap` para a coluna parar inteira sob o dedo em vez de meia. */}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 lg:snap-none">
        {stages.map((etapa) => (
          <Coluna
            key={etapa.id}
            etapa={etapa}
            deals={porEtapa.get(etapa.id) ?? []}
            onAbrir={onAbrir}
            onNovo={() => onNovo(etapa.id)}
          />
        ))}
      </div>

      {/* A prévia que segue o dedo. Sem ela o card some do quadro
          durante o arrasto e a pessoa perde a referência do que move. */}
      <DragOverlay>
        {arrastando ? <LeadCard deal={arrastando} arrastando /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Coluna({
  etapa,
  deals,
  onAbrir,
  onNovo,
}: {
  etapa: LeadStage;
  deals: LeadDeal[];
  onAbrir: (d: LeadDeal) => void;
  onNovo: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });

  const total = deals.reduce((a, d) => a + d.value_cents, 0);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-[85vw] shrink-0 snap-start flex-col rounded-xl border border-hairline bg-surface-2/40 sm:w-72",
        isOver && "border-signal bg-accent/40",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: etapa.color }}
          />
          <h3 className="truncate text-sm font-medium">{etapa.name}</h3>
          <span className="shrink-0 rounded-md bg-surface-2 px-1.5 text-2xs tabular-nums text-muted-foreground">
            {deals.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onNovo}
          title={`Novo lead em ${etapa.name}`}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </header>

      {/* O SOMATÓRIO DA COLUNA é o número que faz um funil valer a pena:
          "R$ 40 mil em proposta" responde a pergunta do dono antes de
          ele abrir qualquer card. */}
      {total > 0 && (
        <p className="border-b border-hairline px-3 py-1.5 text-2xs tabular-nums text-muted-foreground">
          {formatCurrency(total)}
        </p>
      )}

      <div className="flex min-h-24 flex-col gap-2 p-2">
        {deals.length === 0 ? (
          <p className="px-1 py-4 text-center text-2xs text-muted-foreground">
            Nada aqui ainda.
          </p>
        ) : (
          deals.map((d) => <CardArrastavel key={d.id} deal={d} onAbrir={onAbrir} />)
        )}
      </div>
    </section>
  );
}

function CardArrastavel({
  deal,
  onAbrir,
}: {
  deal: LeadDeal;
  onAbrir: (d: LeadDeal) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAbrir(deal)}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <LeadCard deal={deal} />
    </div>
  );
}
