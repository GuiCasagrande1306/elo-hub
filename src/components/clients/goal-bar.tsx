import { GOAL_TONE_CLASSES, type GoalProgress } from "@/lib/metrics/goals";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";

/**
 * Barra de progresso de meta, com MARCADOR DE RITMO.
 *
 * Escrita à mão em vez de usar o `Progress` do shadcn por três razões
 * que o componente pronto não cobre:
 *
 *  1. O marcador vertical de ritmo — o traço que mostra onde o valor
 *     DEVERIA estar dado o tempo já decorrido. É ele que transforma
 *     "52% gasto" (número solto) em "52% gasto com 45% do mês" (leitura
 *     acionável). Sem ele a barra é decorativa.
 *
 *  2. Estouro. Passar de 100% precisa de tratamento visual próprio:
 *     a barra satura e ganha listras, em vez de vazar do container ou
 *     mentir mostrando 100%.
 *
 *  3. A cor vem do TOM já resolvido em `lib/metrics/goals.ts`, onde
 *     orçamento e resultados têm semântica oposta.
 *
 * Mantém a semântica ARIA que o componente do shadcn traria.
 */
export function GoalBar({ progress }: { progress: GoalProgress }) {
  const tone = GOAL_TONE_CLASSES[progress.tone];
  const overflow = progress.ratio > 1;
  const percentLabel = formatPercent(progress.ratio, 0);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Rótulo + números ---------------------------------------- */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{progress.label}</span>
        <span className={cn("text-2xs font-medium tabular-nums", tone.text)}>
          {percentLabel}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums">
          {progress.executedLabel}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          de {progress.plannedLabel}
        </span>
        {progress.isOverride && (
          <span
            title="Valor ajustado manualmente — não vem direto da plataforma."
            className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            ajustado
          </span>
        )}
      </div>

      {/* Trilho --------------------------------------------------- */}
      <div
        role="progressbar"
        aria-label={progress.label}
        aria-valuenow={Math.round(progress.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${progress.executedLabel} de ${progress.plannedLabel} (${percentLabel})`}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            tone.bar,
          )}
          style={{ width: `${Math.max(progress.barPercent, 1.5)}%` }}
        />

        {/* Listras diagonais quando passou de 100%: comunica estouro
            sem precisar de uma barra que vaze do container. */}
        {overflow && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-35"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,.85) 4px 6px)",
            }}
          />
        )}

        {/* Marcador de ritmo: onde o valor deveria estar agora.
            Escondido quando não há período (meta sem data) ou quando o
            marcador coincidiria com a borda. */}
        {progress.elapsed !== null &&
          progress.elapsed > 0.02 &&
          progress.elapsed < 0.98 && (
            <span
              aria-hidden
              title={`Ritmo esperado: ${formatPercent(progress.elapsed, 0)} do período decorrido`}
              className="absolute top-0 h-full w-px bg-foreground/55"
              style={{ left: `${progress.elapsed * 100}%` }}
            />
          )}
      </div>

      <p className={cn("text-2xs leading-snug", tone.text)}>{progress.message}</p>
    </div>
  );
}
