"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, CircleAlert, MessageSquare } from "lucide-react";

import { PersonAvatar } from "@/components/team/person-avatar";
import { ORIGEM_LABEL, valorDoNegocio } from "@/lib/crm/stages";
import { dataNoBrasil } from "@/lib/date-br";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealWithRelations } from "@/types/database";

/**
 * Cartão do funil.
 *
 * `DealCardShell` é a parte visual; `DealCard` a envolve com o
 * comportamento de arrastar. Separar permite reusar a mesma aparência
 * dentro do `DragOverlay` — sem isso, o cartão fantasma que segue o
 * cursor fica diferente do original e o arraste parece quebrado. Mesma
 * divisão do quadro de tarefas, pelo mesmo motivo.
 */

/** Deslocamento máximo, em px, que ainda conta como clique e não arraste. */
const CLICK_SLOP = 6;

export function DealCard({
  deal,
  onOpen,
}: {
  deal: DealWithRelations;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: deal.id, data: { stage: deal.stage } });

  const origem = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent) {
    origem.current = { x: event.clientX, y: event.clientY };
    listeners?.onPointerDown?.(event);
  }

  function handlePointerUp(event: React.PointerEvent) {
    const inicio = origem.current;
    origem.current = null;
    if (!inicio) return;

    const moveu =
      Math.abs(event.clientX - inicio.x) > CLICK_SLOP ||
      Math.abs(event.clientY - inicio.y) > CLICK_SLOP;

    if (!moveu) onOpen(deal.id);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    // Enter abre; Espaço fica reservado ao arraste por teclado do dnd-kit.
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(deal.id);
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        origem.current = null;
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Abrir negócio: ${deal.title}`}
      className={cn(
        "cursor-grab touch-none rounded-xl outline-none active:cursor-grabbing",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-0",
      )}
    >
      <DealCardShell deal={deal} />
    </div>
  );
}

export function DealCardShell({
  deal,
  dragging,
}: {
  deal: DealWithRelations;
  dragging?: boolean;
}) {
  const acao = estadoDaAcao(deal);
  const valor = valorDoNegocio(deal);

  return (
    <article
      className={cn(
        "surface-card flex flex-col gap-2.5 p-3 transition-shadow",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
        dragging && "rotate-1 shadow-2xl ring-signal/45",
      )}
    >
      <h3 className="text-sm font-medium leading-snug">{deal.title}</h3>

      {deal.company && deal.company !== deal.title && (
        <p className="-mt-1.5 truncate text-2xs text-muted-foreground">
          {deal.company}
        </p>
      )}

      {/* VALOR ZERO NÃO É "R$ 0,00".
          Lead novo ainda não tem proposta, e imprimir zero ali afirma que
          o negócio não vale nada — some do total, some da média e, pior,
          parece dado conferido. Sem valor, o campo diz que falta. */}
      <div className="flex items-center justify-between gap-2">
        {valor > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(valor)}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground/70">sem valor</span>
        )}

        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {ORIGEM_LABEL[deal.origem]}
        </span>
      </div>

      {/* ⚠️ A LINHA MAIS IMPORTANTE DO CARTÃO.
          Um CRM só se distingue de uma planilha quando responde "de que
          eu preciso cuidar hoje?". Por isso a próxima ação vem antes do
          responsável e da origem em peso visual: atrasada em vermelho,
          hoje em âmbar, e a AUSÊNCIA dela sinalizada — negócio sem
          próximo passo é negócio esquecido, e é o estado que mais custa
          dinheiro justamente por não parecer um problema. */}
      <div className="flex items-center justify-between gap-2">
        {acao.tipo === "nenhuma" ? (
          <span className="flex items-center gap-1 text-2xs text-muted-foreground/70">
            <CircleAlert className="size-3" />
            sem próxima ação
          </span>
        ) : (
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 text-2xs",
              acao.tipo === "atrasada" && "font-medium text-negative",
              acao.tipo === "hoje" && "font-medium text-warning",
              acao.tipo === "futura" && "text-muted-foreground",
            )}
            title={deal.next_action ?? undefined}
          >
            <CalendarClock className="size-3 shrink-0" />
            <span className="truncate">{acao.rotulo}</span>
          </span>
        )}

        <span className="flex shrink-0 items-center gap-1.5">
          {(deal.activityCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
              <MessageSquare className="size-3" />
              {deal.activityCount}
            </span>
          )}
          {deal.owner && (
            <PersonAvatar
              name={deal.owner.full_name}
              avatarUrl={deal.owner.avatar_url}
              className="size-5"
            />
          )}
        </span>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

export type EstadoDaAcao =
  | { tipo: "nenhuma" }
  | { tipo: "atrasada" | "hoje" | "futura"; rotulo: string; dias: number };

/**
 * Em que pé está a próxima ação, no fuso de São Paulo.
 *
 * ⚠️ A conta é ancorada ao MEIO-DIA dos dois lados. Comparar as strings
 * de data direto funcionaria, mas a diferença em DIAS é o que a tela
 * mostra ("atrasada 5d"), e subtrair meia-noite de meia-noite atravessa
 * a fronteira do dia em qualquer arredondamento de fuso. Mesmo padrão
 * de `formatDueDate` e `resolvePeriod`.
 */
export function estadoDaAcao(deal: {
  next_action: string | null;
  next_action_at: string | null;
}): EstadoDaAcao {
  if (!deal.next_action || !deal.next_action_at) return { tipo: "nenhuma" };

  const hoje = dataNoBrasil();
  const alvo = deal.next_action_at.slice(0, 10);

  const dias = Math.round(
    (Date.parse(`${alvo}T12:00:00-03:00`) -
      Date.parse(`${hoje}T12:00:00-03:00`)) /
      86_400_000,
  );

  if (dias < 0) {
    return { tipo: "atrasada", dias, rotulo: `atrasada ${Math.abs(dias)}d` };
  }
  if (dias === 0) return { tipo: "hoje", dias, rotulo: "hoje" };
  if (dias === 1) return { tipo: "futura", dias, rotulo: "amanhã" };
  return { tipo: "futura", dias, rotulo: `em ${dias}d` };
}
