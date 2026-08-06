"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateTask } from "@/app/(app)/tarefas/actions";
import { cn } from "@/lib/utils";
import {
  COLOR_TAG_CLASSES,
  COLOR_TAG_LABELS,
  criticalityTone,
} from "./task-meta";
import { TASK_COLOR_TAGS, type TaskColorTag } from "@/types/database";

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
            className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-accent/60"
          />
        }
      >
        <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full", criticalityTone(nivel))}
            style={{ width: `${nivel * 10}%` }}
          />
        </span>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {nivel}
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
                "size-7 rounded text-xs tabular-nums transition-colors",
                n === nivel
                  ? "bg-foreground font-medium text-background"
                  : "hover:bg-accent",
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

export function ColorTagCell({
  taskId,
  value,
}: {
  taskId: string;
  value: TaskColorTag | null;
}) {
  const [cor, setCor] = useState<TaskColorTag | null>(value);
  const [aberto, setAberto] = useState(false);
  const [, startTransition] = useTransition();

  function escolher(nova: TaskColorTag | null) {
    const anterior = cor;
    setCor(nova);
    setAberto(false);

    startTransition(async () => {
      const r = await updateTask({ taskId, colorTag: nova });
      if (!r.ok) {
        setCor(anterior);
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
            className="grid size-6 place-items-center rounded transition-colors hover:bg-accent/60"
          />
        }
      >
        <span
          className={cn(
            "size-3 rounded-full",
            cor
              ? COLOR_TAG_CLASSES[cor]
              : "border border-dashed border-muted-foreground/50",
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
                "grid size-7 place-items-center rounded transition-colors hover:bg-accent",
                c === cor && "ring-2 ring-foreground/60",
              )}
            >
              <span className={cn("size-3.5 rounded-full", COLOR_TAG_CLASSES[c])} />
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
