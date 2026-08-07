"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateTask } from "@/app/(app)/tarefas/actions";
import { cn } from "@/lib/utils";
import {
  COLOR_TAG_CLASSES,
  COLOR_TAG_LABELS,
  STATUS_DOT,
  STATUS_LABELS,
  TASK_COLUMNS,
  criticalityTone,
} from "./task-meta";
import {
  TASK_COLOR_TAGS,
  type TaskColorTag,
  type TaskStatus,
} from "@/types/database";

/* =====================================================================
   Edição rápida na tabela
   ---------------------------------------------------------------------
   Duas células que salvam no clique, sem abrir a gaveta. É o que separa
   a tabela do Kanban: quem está na lista veio ajustar vários itens em
   sequência, e abrir e fechar uma gaveta por tarefa mata esse fluxo.

   Ambas fazem atualização OTIMISTA — o valor muda na tela antes da
   resposta do servidor e volta atrás se falhar. Numa edição de um
   clique, esperar o round-trip faz a interface parecer travada.

   Vivem fora da linha da tabela porque ela era um `<button>`: seletor
   dentro de botão é HTML inválido e o clique interno nunca chega.
   ===================================================================== */

export function CriticalityCell({
  taskId,
  value,
}: {
  taskId: string;
  value: number;
}) {
  const [nivel, setNivel] = useState(value);
  const [aberto, setAberto] = useState(false);
  const [, startTransition] = useTransition();

  function escolher(novo: number) {
    const anterior = nivel;
    setNivel(novo);
    setAberto(false);

    startTransition(async () => {
      const r = await updateTask({ taskId, criticality: novo });
      if (!r.ok) {
        setNivel(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Criticidade ${nivel} de 10`}
            className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
          />
        }
      >
        {/* Número primeiro e com peso: é o que se lê na varredura. A
            barra é reforço, não a informação principal. */}
        <span
          className={cn(
            "text-xs font-semibold tabular-nums transition-colors",
            nivel >= 9
              ? "text-negative"
              : nivel >= 7
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {nivel}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300",
              criticalityTone(nivel),
            )}
            style={{ width: `${nivel * 10}%` }}
          />
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-1.5" align="start">
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => escolher(n)}
              className={cn(
                "size-8 rounded-md text-xs font-medium tabular-nums transition-all",
                n === nivel
                  ? "scale-110 bg-foreground text-background"
                  : n >= 9
                    ? "text-negative hover:bg-negative-muted"
                    : n >= 7
                      ? "text-warning hover:bg-warning-muted"
                      : "text-muted-foreground hover:bg-accent",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-2xs text-muted-foreground">
          A prioridade do card acompanha sozinha.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Seletor de cor da tarefa.
 *
 * CONTROLADO PELA LINHA, não dono do próprio estado. A cor deixou de
 * pintar só a bolinha e passou a lavar a linha inteira — então quem
 * precisa saber a cor atual é a linha, e um estado local aqui dentro
 * criaria duas verdades: a bolinha trocaria na hora e o fundo só depois
 * do revalidate do servidor.
 *
 * O otimismo e a reversão em caso de erro vivem no mesmo lugar do
 * estado, no `TaskRow`.
 */
export function ColorTagCell({
  taskId,
  value,
  onChange,
}: {
  taskId: string;
  value: TaskColorTag | null;
  onChange: (nova: TaskColorTag | null) => void;
}) {
  const cor = value;
  const [aberto, setAberto] = useState(false);
  const [, startTransition] = useTransition();

  function escolher(nova: TaskColorTag | null) {
    const anterior = cor;
    onChange(nova);
    setAberto(false);

    startTransition(async () => {
      const r = await updateTask({ taskId, colorTag: nova });
      if (!r.ok) {
        onChange(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={cor ? `Cor ${COLOR_TAG_LABELS[cor]}` : "Sem cor"}
            className="grid size-7 place-items-center rounded-md transition-colors hover:bg-accent"
          />
        }
      >
        <span
          className={cn(
            "size-4 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 dark:ring-white/15",
            cor
              ? COLOR_TAG_CLASSES[cor]
              : "border border-dashed border-muted-foreground/50 ring-0",
          )}
        />
      </PopoverTrigger>

      <PopoverContent className="w-auto p-1.5" align="start">
        <div className="flex gap-1">
          {TASK_COLOR_TAGS.map((c) => (
            <button
              key={c}
              type="button"
              title={COLOR_TAG_LABELS[c]}
              onClick={() => escolher(c)}
              className={cn(
                "grid size-8 place-items-center rounded-md transition-all hover:scale-110 hover:bg-accent",
                c === cor && "bg-accent ring-2 ring-foreground/60",
              )}
            >
              <span className={cn("size-4 rounded-full", COLOR_TAG_CLASSES[c])} />
            </button>
          ))}

          {/* Limpar é uma escolha legítima: cor é organização pessoal, e
              quem marcou precisa poder desmarcar sem abrir a gaveta. */}
          <button
            type="button"
            title="Sem cor"
            onClick={() => escolher(null)}
            className={cn(
              "grid size-7 place-items-center rounded transition-colors hover:bg-accent",
              cor === null && "ring-2 ring-foreground/60",
            )}
          >
            <span className="size-3.5 rounded-full border border-dashed border-muted-foreground/60" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Status editável em linha.
 *
 * O Kanban move por arraste; a lista não tem para onde arrastar. Sem
 * isto, mudar o status de uma tarefa na tabela obrigava a abrir a
 * gaveta — três cliques para o que é a mudança mais frequente do dia.
 */
export function StatusCell({
  taskId,
  value,
}: {
  taskId: string;
  value: TaskStatus;
}) {
  const [status, setStatus] = useState(value);
  const [aberto, setAberto] = useState(false);
  const [, startTransition] = useTransition();

  function escolher(novo: TaskStatus) {
    const anterior = status;
    setStatus(novo);
    setAberto(false);

    startTransition(async () => {
      const r = await updateTask({ taskId, status: novo });
      if (!r.ok) {
        setStatus(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent"
          />
        }
      >
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />
        <span className="truncate text-muted-foreground">
          {STATUS_LABELS[status]}
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-44 p-1" align="start">
        {TASK_COLUMNS.map(({ status: s }) => (
          <button
            key={s}
            type="button"
            onClick={() => escolher(s)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
              s === status ? "bg-accent font-medium" : "hover:bg-accent/60",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s])} />
            {STATUS_LABELS[s]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Cliente da tarefa, editável na própria linha.
 *
 * Antes o vínculo só existia no momento da criação, e só através do
 * filtro que estivesse ativo — quem criava a tarefa sem filtro ficava
 * com ela órfã e sem caminho de conserto na lista. Trocar o cliente
 * exigia abrir a gaveta.
 *
 * BUSCA POR NOME, não `<select>`: a carteira passou de quarenta contas,
 * e uma lista rolável desse tamanho é pior que um campo de digitar.
 */
export function ClientCell({
  taskId,
  value,
  clients,
  onChange,
}: {
  taskId: string;
  value: { id: string; name: string } | null;
  clients: { id: string; name: string }[];
  onChange: (novo: { id: string; name: string } | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [, startTransition] = useTransition();

  function escolher(novo: { id: string; name: string } | null) {
    const anterior = value;
    onChange(novo);
    setAberto(false);
    setBusca("");

    startTransition(async () => {
      const r = await updateTask({ taskId, clientId: novo?.id ?? null });
      if (!r.ok) {
        onChange(anterior);
        toast.error(r.error);
      }
    });
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? clients.filter((c) => c.name.toLowerCase().includes(termo))
    : clients;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={value ? `Cliente: ${value.name}` : "Definir cliente"}
            className="inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-2xs transition-colors hover:bg-accent"
          />
        }
      >
        {value ? (
          <span className="font-medium text-signal">{value.name}</span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-60 p-0" align="start">
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente…"
          className="w-full border-b border-hairline bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50"
        />

        <div className="max-h-56 overflow-y-auto p-1">
          {/* Desvincular é escolha legítima: tarefa interna da agência
              não pertence a cliente nenhum. */}
          <button
            type="button"
            onClick={() => escolher(null)}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            Sem cliente
          </button>

          {filtrados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => escolher({ id: c.id, name: c.name })}
              className={cn(
                "w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                c.id === value?.id && "bg-accent font-medium",
              )}
            >
              {c.name}
            </button>
          ))}

          {filtrados.length === 0 && (
            <p className="px-2 py-3 text-center text-2xs text-muted-foreground">
              Nenhum cliente com esse nome.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
