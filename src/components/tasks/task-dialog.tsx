"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarDays, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { RichTextEditor } from "./rich-text-editor";
import {
  PRIORITY_LABELS,
  STATUS_DOT,
  STATUS_LABELS,
  TASK_COLUMNS,
} from "./task-meta";
import {
  addChecklistItem,
  toggleChecklistItem,
  updateTask,
} from "@/app/(app)/tarefas/actions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDueDate, initials } from "@/lib/format";
import type {
  RichTextDoc,
  TaskPriority,
  TaskStatus,
  TaskWithRelations,
} from "@/types/database";

/**
 * Detalhe da tarefa — o "documento" no estilo Notion.
 *
 * Padrão de salvamento: campo estruturado (status, prioridade) salva no
 * ato; texto livre (título, corpo) salva com debounce de 700ms. Salvar
 * a cada tecla inundaria o Realtime e faria a tela dos colegas piscar a
 * cada letra digitada.
 */

interface TaskDialogProps {
  task: TaskWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDialog({ task, open, onOpenChange }: TaskDialogProps) {
  if (!task) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        {/* `key` força remontagem ao trocar de tarefa, zerando os
            estados locais de rascunho. */}
        <TaskDialogBody key={task.id} task={task} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TaskDialogBody({
  task,
  onClose,
}: {
  task: TaskWithRelations;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState<RichTextDoc>(task.content);
  const [newItem, setNewItem] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const due = formatDueDate(task.due_date);
  const doneItems = task.checklist.filter((c) => c.is_done).length;

  /** Agenda a gravação de texto livre; cancela a anterior. */
  function scheduleSave(patch: { title?: string; content?: RichTextDoc }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);

    saveTimer.current = setTimeout(async () => {
      const result = await updateTask({
        taskId: task.id,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined
          ? { content: patch.content as unknown as Record<string, unknown> }
          : {}),
      });
      setSaving(false);
      if (!result.ok) toast.error(result.error);
    }, 700);
  }

  // Grava o que estiver pendente ao desmontar — fechar o modal no meio
  // do debounce não pode descartar a edição.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function commitField(patch: {
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
  }) {
    startTransition(async () => {
      const result = await updateTask({ taskId: task.id, ...patch });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <>
      {/* Cabeçalho ------------------------------------------------- */}
      <header className="flex items-start gap-3 border-b border-hairline px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            {task.client && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: task.client.brand_primary ?? "#8a8a8a" }}
                />
                {task.client.name}
              </span>
            )}
            {task.project && (
              <>
                <span aria-hidden>/</span>
                <span>{task.project.name}</span>
              </>
            )}
            {saving && (
              <span className="ml-auto flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                salvando
              </span>
            )}
          </div>

          {/* O modal precisa de um título acessível, mas o título aqui é
              um campo editável. Damos ao Dialog um rótulo invisível e
              deixamos o <textarea> livre — colocar semântica de título
              num campo de formulário confunde leitor de tela. */}
          <DialogTitle className="sr-only">{title}</DialogTitle>

          {/* Título editável no lugar, sem "modo edição". */}
          <textarea
            value={title}
            rows={1}
            aria-label="Título da tarefa"
            onChange={(event) => {
              setTitle(event.target.value);
              scheduleSave({ title: event.target.value });
            }}
            className="w-full resize-none bg-transparent text-lg font-semibold leading-snug tracking-[-0.015em] outline-none placeholder:text-muted-foreground focus:outline-none"
            placeholder="Título da tarefa"
          />
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="overflow-y-auto">
        {/* Propriedades --------------------------------------------- */}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-b border-hairline px-5 py-4 sm:grid-cols-2 sm:px-6">
          <Property label="Status">
            <Select
              value={task.status}
              onValueChange={(value) =>
                commitField({ status: value as TaskStatus })
              }
            >
              <SelectTrigger size="sm" className="w-full">
                {/* Base UI entrega o valor cru ("in_progress"); traduzimos
                    para o rótulo no gatilho. */}
                <SelectValue>
                  {(value: TaskStatus) => (
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", STATUS_DOT[value])} />
                      {STATUS_LABELS[value]}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TASK_COLUMNS.map(({ status }) => (
                  <SelectItem key={status} value={status}>
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                      {STATUS_LABELS[status]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Property>

          <Property label="Prioridade">
            <Select
              value={task.priority}
              onValueChange={(value) =>
                commitField({ priority: value as TaskPriority })
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {(value: TaskPriority) => PRIORITY_LABELS[value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Property>

          <Property label="Responsáveis">
            <div className="flex items-center gap-1.5">
              {task.assignees.length === 0 && (
                <span className="text-sm text-muted-foreground">Ninguém</span>
              )}
              {task.assignees.map((person) => (
                <span
                  key={person.id}
                  title={person.full_name}
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs ring-1 ring-hairline"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-background text-[9px] font-semibold">
                    {initials(person.full_name)}
                  </span>
                  <span className="max-w-24 truncate">
                    {person.full_name.split(" ")[0]}
                  </span>
                </span>
              ))}
            </div>
          </Property>

          <Property label="Prazo">
            {/* Editável, não só exibido. `updateTask` sempre aceitou
                `dueDate`; faltava a interface, e uma tarefa sem prazo
                definível não entra em nenhuma cobrança.

                `date` nativo em vez de date picker: o campo do sistema
                traz o calendário do próprio aparelho, que no celular é
                melhor que qualquer coisa que a gente desenhe. */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={task.due_date ? task.due_date.slice(0, 10) : ""}
                onChange={(e) =>
                  commitField({ dueDate: e.target.value || null })
                }
                disabled={isPending}
                className="rounded-md border border-hairline bg-transparent px-2 py-1 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />

              {due.label && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs tabular-nums",
                    due.tone === "overdue" && "font-medium text-negative",
                    due.tone === "today" && "font-medium text-warning",
                    due.tone !== "overdue" &&
                      due.tone !== "today" &&
                      "text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-3.5" />
                  {due.label}
                </span>
              )}

              {task.due_date && (
                <button
                  type="button"
                  onClick={() => commitField({ dueDate: null })}
                  disabled={isPending}
                  className="text-2xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  remover
                </button>
              )}
            </div>
          </Property>
        </dl>

        {/* Progresso ------------------------------------------------ */}
        {task.checklist.length > 0 && (
          <div className="flex items-center gap-3 border-b border-hairline px-5 py-3 sm:px-6">
            <span className="eyebrow shrink-0">Progresso</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                  task.progress === 100 ? "bg-signal" : "bg-foreground/45",
                )}
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {doneItems}/{task.checklist.length} · {task.progress}%
            </span>
          </div>
        )}

        {/* Corpo ---------------------------------------------------- */}
        <div className="px-5 py-5 sm:px-6">
          <RichTextEditor
            content={content}
            onChange={(doc) => {
              setContent(doc);
              scheduleSave({ content: doc });
            }}
          />
        </div>

        {/* Checklist ------------------------------------------------ */}
        <div className="border-t border-hairline px-5 py-5 sm:px-6">
          <h3 className="eyebrow mb-3">Checklist</h3>

          <ul className="flex flex-col">
            {task.checklist.map((item) => (
              <li key={item.id}>
                <label
                  className={cn(
                    "-mx-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent/50",
                    item.is_done && "text-muted-foreground line-through",
                  )}
                >
                  <Checkbox
                    checked={item.is_done}
                    disabled={isPending}
                    onCheckedChange={(checked) => {
                      startTransition(async () => {
                        const result = await toggleChecklistItem(
                          item.id,
                          checked === true,
                        );
                        if (!result.ok) toast.error(result.error);
                      });
                    }}
                    className="mt-0.5"
                  />
                  <span className="leading-snug">{item.content}</span>
                </label>
              </li>
            ))}
          </ul>

          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = newItem.trim();
              if (!value) return;
              setNewItem("");
              startTransition(async () => {
                const result = await addChecklistItem({
                  taskId: task.id,
                  content: value,
                });
                if (!result.ok) toast.error(result.error);
              });
            }}
          >
            <Plus className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
              placeholder="Adicionar item…"
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </form>
        </div>
      </div>
    </>
  );
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="eyebrow w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
