"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, Circle, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";

import { criticalityBadge } from "./task-meta";
import { cn } from "@/lib/utils";
import { ColorTagCell, CriticalityCell, StatusCell } from "./task-quick-edit";
import { createTask, updateTask } from "@/app/(app)/tarefas/actions";
import { formatDueDate, initials } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/* =====================================================================
   Visão em lista — grupos expansíveis
   ---------------------------------------------------------------------
   Complementa o Kanban: o quadro responde "em que pé está?", a lista
   responde "o que vence primeiro?". Por isso a ordenação padrão é por
   prazo, não pela posição no quadro.

   NÃO HÁ COLUNA DE TEMPO. A referência mostrava `00:00:00` em toda
   linha, e o sistema não tem rastreamento de tempo — nem campo, nem
   cronômetro. Coluna com número que ninguém alimenta é a mesma armadilha
   do saldo simulado e da métrica inventada: parece dado, não é.

   No mobile a grade vira cartões empilhados — tabela com scroll
   horizontal em tela pequena é o pior dos dois mundos.
   ===================================================================== */

const GRID =
  "grid-cols-[28px_1fr_150px_44px_128px_92px_96px_44px_28px]";

/** Tarefa criada pelo sistema, não por uma pessoa. */
function isAlerta(title: string): boolean {
  return /^\s*(🚨|⚠️)?\s*ALERTA:/i.test(title);
}

export function TaskList({
  tasks,
  onOpenTask,
  title,
  tone,
  /** Só no grupo de concluídos: filtra pela data de conclusão. */
  dateFilter,
  onDateFilterChange,
  defaultClientId = null,
}: {
  tasks: TaskWithRelations[];
  onOpenTask: (id: string) => void;
  title: string;
  tone: "aberto" | "concluido";
  dateFilter?: string;
  onDateFilterChange?: (valor: string) => void;
  defaultClientId?: string | null;
}) {
  const [aberto, setAberto] = useState(true);
  const concluido = tone === "concluido";

  const ordenadas = [...tasks].sort((a, b) =>
    concluido
      ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
  );

  return (
    <section className="surface-card overflow-hidden">
      {/* Cabeçalho do grupo ----------------------------------------- */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-accent"
        >
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              !aberto && "-rotate-90",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              concluido ? "bg-positive" : "bg-signal",
            )}
          />
          <span className="text-sm font-semibold">{title}</span>
        </button>

        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs tabular-nums text-muted-foreground">
          {ordenadas.length}
        </span>

        {concluido && onDateFilterChange && (
          <label className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
            Filtrar por dia
            <input
              type="date"
              value={dateFilter ?? ""}
              onChange={(e) => onDateFilterChange(e.target.value)}
              className="rounded-md border border-hairline bg-surface-2 px-2 py-1 text-xs text-foreground"
            />
          </label>
        )}
      </header>

      {aberto && (
        <>
          {/* Cabeçalho de colunas — só no desktop. */}
          <div
            className={cn(
              "hidden gap-3 border-y border-hairline px-4 py-2 md:grid",
              GRID,
            )}
          >
            <span />
            {["Tarefa", "Cliente", "Resp.", "Status", "Criticidade"].map((l) => (
              <span key={l} className="eyebrow">
                {l}
              </span>
            ))}
            <span className="eyebrow">{concluido ? "Concluído" : "Prazo"}</span>
            <span />
            <span />
          </div>

          <ul className="divide-y divide-hairline">
            {ordenadas.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                concluido={concluido}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>

          {/* Linha fantasma: criar sem sair da tabela. Só nos grupos
              abertos — criar uma tarefa já concluída não faz sentido. */}
          {!concluido && <GhostRow defaultClientId={defaultClientId} />}

          {ordenadas.length === 0 && concluido && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma tarefa concluída neste dia.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TaskRow({
  task,
  concluido,
  onOpenTask,
}: {
  task: TaskWithRelations;
  concluido: boolean;
  onOpenTask: (id: string) => void;
}) {
  const [feito, setFeito] = useState(concluido);
  const [, startTransition] = useTransition();

  const due = formatDueDate(task.due_date);
  const badge = criticalityBadge(task.criticality);
  const alerta = isAlerta(task.title);

  function alternar() {
    const anterior = feito;
    setFeito(!feito);

    startTransition(async () => {
      const r = await updateTask({
        taskId: task.id,
        status: !feito ? "done" : "todo",
      });
      if (!r.ok) {
        setFeito(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <li>
      <div
        className={cn(
          "grid grid-cols-1 items-center gap-x-3 gap-y-2 px-4 py-2 transition-colors hover:bg-accent/40 md:grid",
          GRID,
        )}
      >
        {/* Concluir */}
        <button
          type="button"
          onClick={alternar}
          aria-label={feito ? "Reabrir tarefa" : "Concluir tarefa"}
          className="grid size-7 place-items-center rounded-md transition-colors hover:bg-accent"
        >
          {feito ? (
            <CheckCircle2 className="size-4 text-positive" />
          ) : (
            <Circle className="size-4 text-muted-foreground/45" />
          )}
        </button>

        {/* Tarefa */}
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          {alerta && (
            <AlertTriangle className="size-3.5 shrink-0 text-negative" />
          )}
          <span
            className={cn(
              "truncate text-sm",
              feito
                ? "text-muted-foreground/70 line-through"
                : "font-medium",
            )}
          >
            {task.title}
          </span>
        </button>

        {/* Cliente */}
        <span className="min-w-0">
          {task.client ? (
            <span className="inline-block max-w-full truncate rounded-md bg-signal-muted/60 px-1.5 py-0.5 text-2xs font-medium text-signal">
              {task.client.name}
            </span>
          ) : (
            <span className="text-2xs text-muted-foreground/60">—</span>
          )}
        </span>

        {/* Responsável — só o primeiro. Os demais aparecem na gaveta. */}
        <span className="flex">
          {task.assignees[0] ? (
            <span
              title={task.assignees[0].full_name}
              className="grid size-6 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold ring-1 ring-hairline"
            >
              {initials(task.assignees[0].full_name)}
            </span>
          ) : (
            <span className="text-2xs text-muted-foreground/60">—</span>
          )}
        </span>

        <StatusCell taskId={task.id} value={task.status} />

        {/* Criticidade: badge derivada + edição no clique. */}
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </span>

        {/* Prazo ou conclusão */}
        <span className="text-2xs tabular-nums">
          {concluido ? (
            task.completed_at ? (
              <ConcluidoEm iso={task.completed_at} />
            ) : (
              <span className="text-muted-foreground/60">—</span>
            )
          ) : (
            <span
              className={cn(
                due.tone === "overdue" && "font-medium text-negative",
                due.tone === "today" && "font-medium text-warning",
                (due.tone === "soon" || due.tone === "normal") &&
                  "text-muted-foreground",
                !due.label && "text-muted-foreground/60",
              )}
            >
              {due.label || "—"}
            </span>
          )}
        </span>

        <CriticalityCell taskId={task.id} value={task.criticality} />
        <ColorTagCell taskId={task.id} value={task.color_tag} />
      </div>
    </li>
  );
}

/** "19:25" sobre "30/07" — hora primeiro, que é o que distingue no dia. */
function ConcluidoEm({ iso }: { iso: string }) {
  const d = new Date(iso);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  const dia = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);

  return (
    <span className="block leading-tight">
      <span className="block font-medium">{hora}</span>
      <span className="block text-muted-foreground/70">{dia}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Linha fantasma.
 *
 * Criar sem abrir modal é o que muda o ritmo de uso: numa reunião de
 * planejamento entram dez tarefas seguidas, e dez modais matam o fluxo.
 * Enter cria e mantém o campo aberto para a próxima; Escape desiste.
 */
function GhostRow({ defaultClientId }: { defaultClientId: string | null }) {
  const [titulo, setTitulo] = useState("");
  const [salvando, startTransition] = useTransition();

  function criar() {
    const limpo = titulo.trim();
    if (limpo.length < 2) return;

    startTransition(async () => {
      const r = await createTask({ title: limpo, clientId: defaultClientId });
      if (r.ok) {
        // Limpa e SEGUE aberto: quem digitou uma vai digitar a próxima.
        setTitulo("");
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2 border-t border-hairline px-4 py-2">
      <Plus className="size-3.5 shrink-0 text-muted-foreground/50" />
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") criar();
          if (e.key === "Escape") setTitulo("");
        }}
        onBlur={criar}
        disabled={salvando}
        placeholder="Adicionar tarefa"
        className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}
