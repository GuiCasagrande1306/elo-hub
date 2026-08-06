"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KanbanSquare, List, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskDialog } from "./task-dialog";
import { createTask, moveTask } from "@/app/(app)/tarefas/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, TASK_COLUMNS } from "./task-meta";
import type { Client, TaskStatus, TaskWithRelations } from "@/types/database";

/**
 * Área de trabalho do módulo de tarefas.
 *
 * Concentra o que é estado de INTERFACE (visão, busca, filtro, tarefa
 * aberta). O dado em si continua vindo do servidor já filtrado por RLS,
 * e as mutações são Server Actions. O componente não sabe o que o
 * usuário pode ver — só desenha o que recebeu.
 *
 * A tarefa aberta vive na URL (`?tarefa=<id>`): link direto para uma
 * tarefa funciona, e o botão voltar fecha o modal em vez de sair da
 * página.
 */

const ALL = "__all__";

interface TasksWorkspaceProps {
  tasks: TaskWithRelations[];
  clients: Client[];
  /** Data ISO (YYYY-MM-DD) do corte de tarefas concluídas recentes. */
  corteConcluidas: string;
}

export function TasksWorkspace({
  tasks,
  clients,
  corteConcluidas,
}: TasksWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [view, setView] = useState<"board" | "list" | "done">("board");
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  /* Faixa, não valor exato: ninguém filtra por "criticidade 7". A
     pergunta real é "o que está crítico". */
  const [critFilter, setCritFilter] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  /* Um colega mexeu numa tarefa → a página revalida sozinha.

     `task_assignees` NÃO é opcional aqui, e o motivo não é óbvio: o
     Supabase respeita RLS no broadcast, e a atribuição acontece DEPOIS
     do insert da tarefa. No instante em que a linha de `tasks` nasce, o
     colaborador ainda não é responsável — `can_access_task` devolve
     falso e o evento nunca chega nele. Quem carrega a novidade é o
     insert em `task_assignees`, um instante depois.

     Sem esta linha, o admin cria e atribui, e o card só aparece na tela
     do colaborador quando ele recarrega a página à mão. */
  useRealtimeRefresh("tasks");
  useRealtimeRefresh("task_assignees");
  useRealtimeRefresh("task_checklist_items");
  // Contador de comentários no card fica vivo junto.
  useRealtimeRefresh("task_comments");

  const openTaskId = searchParams.get("tarefa");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (clientFilter !== ALL && task.client_id !== clientFilter) return false;
      if (statusFilter !== ALL && task.status !== statusFilter) return false;
      if (critFilter === "alta" && task.criticality < 7) return false;
      if (critFilter === "critica" && task.criticality < 9) return false;
      if (!needle) return true;
      return (
        task.title.toLowerCase().includes(needle) ||
        (task.client?.name.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tasks, query, clientFilter, statusFilter, critFilter]);

  /* Concluída some do quadro e da lista depois de 7 dias.

     Não é arquivamento — a tarefa continua no banco e na aba
     "Concluídas". É que uma coluna que só cresce transforma o quadro
     numa lista de histórico, e o que importa no dia a dia é o que ainda
     está em aberto. Sete dias porque a retrospectiva da semana ainda
     precisa enxergar o que foi entregue.

     O corte vem do SERVIDOR: calcular a data aqui seria impuro no render
     e divergiria entre servidor e cliente na hidratação.

     Sem `completed_at` a tarefa fica visível: é dado antigo, anterior ao
     trigger que carimba a data, e sumir com ela seria perder tarefa. */
  const concluidas = useMemo(
    () =>
      filtered
        .filter((t) => t.status === "done")
        .sort((a, b) =>
          (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
        ),
    [filtered],
  );

  const emAndamento = useMemo(
    () =>
      filtered.filter((t) => {
        if (t.status !== "done") return true;
        if (!t.completed_at) return true;
        return t.completed_at.slice(0, 10) >= corteConcluidas;
      }),
    [filtered, corteConcluidas],
  );

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  function setOpenTask(taskId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (taskId) params.set("tarefa", taskId);
    else params.delete("tarefa");

    // `scroll: false` mantém a posição do quadro ao abrir/fechar.
    router.replace(`/tarefas${params.size ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  function handleMove(taskId: string, status: TaskStatus, position: number) {
    startTransition(async () => {
      const result = await moveTask({ taskId, status, position });
      if (!result.ok) toast.error(result.error);
    });
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setNewTitle("");
    setCreating(false);

    startTransition(async () => {
      const result = await createTask({
        title,
        clientId: clientFilter === ALL ? null : clientFilter,
      });
      if (result.ok) toast.success("Tarefa criada.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de ferramentas ------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline">
          <ViewButton
            active={view === "board"}
            onClick={() => setView("board")}
            icon={KanbanSquare}
            label="Quadro"
          />
          <ViewButton
            active={view === "list"}
            onClick={() => setView("list")}
            icon={List}
            label="Lista"
          />
          <ViewButton
            active={view === "done"}
            onClick={() => setView("done")}
            icon={CheckCircle2}
            label={`Concluídas${concluidas.length ? ` (${concluidas.length})` : ""}`}
          />
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar tarefa…"
            className="h-9 pl-8"
          />
        </div>

        {/* Base UI entrega `string | null` (null = seleção limpa). */}
        <Select
          value={clientFilter}
          onValueChange={(value) => setClientFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48">
            {/* Base UI renderiza o VALOR selecionado, não o rótulo do
                item. Sem esta função o gatilho mostraria "__all__" ou o
                UUID do cliente. */}
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os clientes"
                  : (clients.find((c) => c.id === value)?.name ??
                    "Todos os clientes")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os clientes</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os status"
                  : (STATUS_LABELS[value as TaskStatus] ?? "Todos os status")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {TASK_COLUMNS.map(({ status }) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={critFilter}
          onValueChange={(value) => setCritFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue>
              {(value: string) =>
                value === "alta"
                  ? "Criticidade 7+"
                  : value === "critica"
                    ? "Criticidade 9+"
                    : "Toda criticidade"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toda criticidade</SelectItem>
            <SelectItem value="alta">Criticidade 7+</SelectItem>
            <SelectItem value="critica">Criticidade 9+</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="sm"
          className="ml-auto h-9"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus className="size-4" />
          Nova tarefa
        </Button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="surface-card flex gap-2 p-2">
          <Input
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder="O que precisa ser feito?"
            className="h-9 border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            Criar
          </Button>
        </form>
      )}

      {/* Conteúdo -------------------------------------------------- */}
      {view === "board" && (
        <TaskBoard
          tasks={emAndamento}
          onOpenTask={setOpenTask}
          onMove={handleMove}
        />
      )}

      {view === "list" && (
        <TaskList tasks={emAndamento} onOpenTask={setOpenTask} />
      )}

      {view === "done" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Tudo que já foi entregue, do mais recente para o mais antigo. No
            quadro e na lista, uma tarefa concluída some depois de 7 dias —
            aqui ela fica.
          </p>

          {concluidas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline py-14 text-center">
              <CheckCircle2 className="mx-auto size-7 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhuma tarefa concluída ainda.
              </p>
            </div>
          ) : (
            <TaskList tasks={concluidas} onOpenTask={setOpenTask} />
          )}
        </div>
      )}

      <TaskDialog
        task={openTask}
        open={Boolean(openTask)}
        onOpenChange={(open) => {
          if (!open) setOpenTask(null);
        }}
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground ring-1 ring-hairline"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
