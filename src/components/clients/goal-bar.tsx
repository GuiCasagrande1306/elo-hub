import {
  AlertTriangle,
  CheckCircle2,
  CornerDownRight,
  MinusCircle,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  GOAL_TONE_CLASSES,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/metrics/goals";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

      <PacingLine progress={progress} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Linha de fechamento                                                 */
/* ------------------------------------------------------------------ */

/**
 * UMA LINHA, E ELA RESPONDE "ONDE ISSO VAI FECHAR?".
 *
 * A versão anterior escrevia o diagnóstico do dia por extenso — "Gasto
 * acelerado — 125% do previsto para hoje, a verba acaba antes do mês".
 * Correto e ilegível em grade: duas dessas por card, dezenas de cards, e
 * o olho para de ler todas. Pior, respondia a pergunta errada: quem abre
 * a lista quer saber onde o mês fecha, não a aritmética de hoje.
 *
 * A aritmética não sumiu — ela inteira está no tooltip, junto com o
 * status que saiu daqui. E o status também continua visível no chip do
 * rodapé do card, então a leitura de relance não perdeu nada.
 *
 * A COR É DA PROJEÇÃO, não do ritmo, e as duas podem discordar de
 * propósito: uma conta 15% acelerada no dia 20 ainda fecha dentro da
 * verba, e pintar essa linha de amarelo contradiria o número que ela
 * mesma mostra.
 */
const PACE_ICONS: Record<GoalStatus, typeof CheckCircle2> = {
  "sem-meta": MinusCircle,
  "no-ritmo": CheckCircle2,
  acelerado: TrendingUp,
  atrasado: TrendingDown,
  estourou: AlertTriangle,
  batida: CheckCircle2,
};

function PacingLine({ progress }: { progress: GoalProgress }) {
  const { projection, pacing } = progress;

  /* Sem projeção, a linha não pode ficar vazia: "sem meta definida" e
     "começo de ciclo" são estados que precisam aparecer, senão o card
     parece quebrado. Cai para o rótulo curto do status — sem a frase
     longa, que é justamente o que esta refatoração tira da grade. */
  if (!projection) {
    const tone = GOAL_TONE_CLASSES[progress.tone];
    const Icon = PACE_ICONS[progress.status];

    return (
      <span
        className={cn(
          "flex items-center gap-1.5 text-2xs leading-snug",
          tone.text,
        )}
      >
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{progress.statusLabel}</span>
      </span>
    );
  }

  const tone = GOAL_TONE_CLASSES[projection.tone];

  const linha = (
    <span
      className={cn(
        "flex items-center gap-1.5 text-left text-2xs leading-snug",
        tone.text,
      )}
    >
      <CornerDownRight className="size-3 shrink-0 opacity-70" />
      <span className="truncate">
        <span className="text-muted-foreground">Projeção: </span>
        <span className="font-medium tabular-nums">{projection.label}</span>
      </span>
    </span>
  );

  return (
    <Tooltip>
      {/* `render` e não `asChild`: este shadcn roda sobre Base UI. Um
          `span` no lugar do botão padrão — a frase é informativa, e um
          botão sem ação poluiria a navegação por teclado. */}
      <TooltipTrigger render={<span className="w-fit cursor-help" />}>
        {linha}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        <span className="font-medium">
          {progress.statusLabel} — {progress.message}
        </span>

        {pacing && (
          <>
            <span className="mt-1">
              Esperado até hoje: <strong>{pacing.expectedLabel}</strong>
            </span>
            <span>
              Realizado: <strong>{progress.executedLabel}</strong>
            </span>
          </>
        )}

        <span className="mt-1">
          Fecha em <strong>{projection.label}</strong> de{" "}
          {progress.plannedLabel} ({formatPercent(projection.ratio, 0)})
        </span>

        <span className="opacity-70">
          {pacing ? `${formatPercent(pacing.ratio, 0)} do ritmo · ` : ""}
          {formatPercent(progress.elapsed ?? 0, 0)} do período · mantido o
          ritmo atual
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
