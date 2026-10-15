"use client";

import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Phone, StickyNote, XCircle } from "lucide-react";

import { PersonAvatar } from "@/components/team/person-avatar";
import { TempoDesde, tomDaEspera } from "./tempo-desde";
import {
  ORIGEM_LEAD_LABEL,
  formatarTelefone,
  rotuloDoMotivo,
} from "@/lib/leads/vocabulario";
import { formatCurrency, formatDueDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeadStageKind, LeadWithRelations } from "@/types/database";

/**
 * Cartão do funil de leads.
 *
 * `LeadCardShell` é a aparência; `LeadCard` a envolve com o arraste. A
 * divisão existe para reusar o mesmo desenho dentro do `DragOverlay` —
 * sem isso o cartão fantasma que segue o cursor sai diferente do
 * original e o arraste parece quebrado. Mesma estrutura do quadro
 * comercial e do de tarefas, pelo mesmo motivo.
 */

/** Deslocamento máximo, em px, que ainda conta como clique e não arraste. */
const CLICK_SLOP = 6;

export function LeadCard({
  lead,
  kind,
  onOpen,
}: {
  lead: LeadWithRelations;
  kind: LeadStageKind;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id, data: { stageId: lead.stage_id } });

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

    if (!moveu) onOpen(lead.id);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    // Enter abre; Espaço fica reservado ao arraste por teclado do dnd-kit.
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(lead.id);
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
      aria-label={`Abrir lead: ${lead.title}`}
      className={cn(
        "cursor-grab touch-none rounded-xl outline-none active:cursor-grabbing",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-0",
      )}
    >
      <LeadCardShell lead={lead} kind={kind} />
    </div>
  );
}

export function LeadCardShell({
  lead,
  kind,
  dragging,
}: {
  lead: LeadWithRelations;
  kind: LeadStageKind;
  dragging?: boolean;
}) {
  const telefone = formatarTelefone(lead.contact?.phone ?? null);
  const proxima = lead.openTasks[0] ?? null;
  const prazo = proxima ? formatDueDate(proxima.due_at) : null;
  const motivo = rotuloDoMotivo(lead.lost_reason);

  /* A espera só é sinal enquanto o lead está VIVO e ninguém marcou o
     próximo passo. Um lead ganho há três meses não está "frio há 90
     dias" — está fechado, e pintar isso de vermelho seria alarme falso
     permanente. */
  const esperando = kind === "aberto" && !proxima;
  const tom = tomDaEspera(lead.created_at, esperando);

  return (
    <article
      className={cn(
        "surface-card flex flex-col gap-2.5 p-3 transition-shadow",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
        dragging && "rotate-1 shadow-2xl ring-signal/45",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium leading-snug">{lead.title}</h3>
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {ORIGEM_LEAD_LABEL[lead.source]}
        </span>
      </div>

      {telefone && (
        <p className="-mt-1 flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
          <Phone className="size-3 shrink-0" />
          {telefone}
        </p>
      )}

      {/* MOTIVO DO DESCARTE ANTES DE TUDO no cartão perdido. É a única
          informação que importa num lead morto — e é ela que, somada,
          vira decisão de segmentação. */}
      {kind === "perdido" && motivo && (
        <p className="flex items-center gap-1 text-2xs font-medium text-negative">
          <XCircle className="size-3 shrink-0" />
          {motivo}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* VALOR ZERO NÃO É "R$ 0,00". Lead novo ainda não tem proposta,
            e imprimir zero afirma que ele não vale nada — some do total,
            some da média e, pior, parece dado conferido. */}
        {lead.value_cents > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(lead.value_cents)}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground/70">sem valor</span>
        )}

        <span className="flex shrink-0 items-center gap-1.5">
          {lead.noteCount > 0 && (
            <span className="flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
              <StickyNote className="size-3" />
              {lead.noteCount}
            </span>
          )}
          {lead.owner && (
            <PersonAvatar
              name={lead.owner.full_name}
              avatarUrl={lead.owner.avatar_url}
              className="size-5"
            />
          )}
        </span>
      </div>

      {/* A LINHA QUE FAZ ISTO SER UM CRM e não uma lista.
          Ou existe um próximo passo com data, ou o cartão diz há quanto
          tempo ninguém toca nele. O segundo caso é o que custa dinheiro
          justamente por não parecer um problema. */}
      {proxima && prazo ? (
        <p
          className={cn(
            "flex min-w-0 items-center gap-1 text-2xs",
            prazo.tone === "overdue" && "font-medium text-negative",
            prazo.tone === "today" && "font-medium text-warning",
            (prazo.tone === "soon" || prazo.tone === "normal") &&
              "text-muted-foreground",
          )}
          title={proxima.title}
        >
          <CalendarClock className="size-3 shrink-0" />
          <span className="truncate">
            {prazo.label} · {proxima.title}
          </span>
        </p>
      ) : (
        <p
          className={cn(
            "text-2xs",
            tom === "quente" && "text-muted-foreground",
            tom === "morno" && "font-medium text-warning",
            tom === "frio" && "font-medium text-negative",
            tom === "neutro" && "text-muted-foreground/60",
          )}
        >
          {esperando ? "esperando há " : "criado há "}
          <TempoDesde iso={lead.created_at} />
        </p>
      )}
    </article>
  );
}
