"use client";

import { useEffect, useState, useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { startTaskTimer, stopTaskTimer } from "@/app/(app)/tarefas/actions";
import { cn } from "@/lib/utils";

/* =====================================================================
   Cronômetro da tarefa
   ---------------------------------------------------------------------
   `tracked_seconds` guarda o tempo FECHADO; `timer_started_at` marca o
   início do trecho em curso. O que aparece na tela é a soma dos dois, e
   só o segundo precisa de um relógio rodando.

   O TICKER NÃO PODE ENTRAR NO PRIMEIRO RENDER. Calcular
   `agora − timer_started_at` durante a renderização é impuro: servidor
   e navegador produziriam segundos diferentes e a hidratação
   divergiria. Esse erro já apareceu três vezes neste projeto — no
   marcador de ritmo das metas, no corte de tarefas concluídas e no dia
   da esteira. Aqui o valor inicial é SEMPRE o acumulado fechado, e o
   trecho em curso só é somado depois que o componente monta.
   ===================================================================== */

/** "1h 12m 30s", "12m 30s", "30s" — sem zeros à esquerda inúteis. */
function formatar(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;

  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function TimeCell({
  taskId,
  trackedSeconds,
  startedAt,
}: {
  taskId: string;
  trackedSeconds: number;
  /** ISO, ou null quando o cronômetro está parado. */
  startedAt: string | null;
}) {
  const [rodando, setRodando] = useState(Boolean(startedAt));
  const [base, setBase] = useState(trackedSeconds);
  /* Segundos do trecho em curso. Começa em 0 e só cresce depois da
     montagem — ver a nota acima sobre hidratação. */
  const [corrido, setCorrido] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Sem âncora não há o que contar. `corrido` é ignorado na soma
    // quando o relógio está parado, então não precisa ser zerado aqui —
    // e zerá-lo dentro do efeito dispararia um render em cascata.
    if (!startedAt) return;

    const inicio = new Date(startedAt).getTime();
    const tick = () =>
      setCorrido(Math.max(0, Math.floor((Date.now() - inicio) / 1000)));

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  function alternar() {
    if (rodando) {
      // Otimista: soma o corrido ao acumulado e para o relógio.
      setBase((b) => b + corrido);
      setCorrido(0);
      setRodando(false);

      startTransition(async () => {
        const r = await stopTaskTimer(taskId);
        if (!r.ok) toast.error(r.error);
      });
      return;
    }

    setRodando(true);
    startTransition(async () => {
      const r = await startTaskTimer(taskId);
      if (!r.ok) {
        setRodando(false);
        toast.error(r.error);
      }
    });
  }

  const total = base + (rodando ? corrido : 0);

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={rodando ? "Parar cronômetro" : "Iniciar cronômetro"}
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs tabular-nums transition-colors hover:bg-accent",
        rodando ? "text-signal" : "text-muted-foreground",
      )}
    >
      {rodando ? (
        <Pause className="size-3 shrink-0 fill-current" />
      ) : (
        <Play className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}

      {/* Zero aparece como travessão: "0s" numa tarefa que ninguém
          cronometrou sugere que alguém mediu e deu zero. */}
      <span className={cn(rodando && "font-medium")}>
        {total > 0 ? formatar(total) : "—"}
      </span>
    </button>
  );
}
