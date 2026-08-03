import type { PlatformSplit as PlatformSplitData } from "@/lib/metrics/kpi";
import { deriveMetric } from "@/lib/metrics/kpi";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

/**
 * Quebra de investimento por canal.
 *
 * Escolhi barras horizontais em vez de donut: comparar comprimento é
 * mais preciso que comparar ângulo, e a barra ainda acomoda os números
 * exatos na mesma linha — que é o que o gestor realmente lê.
 */
export function PlatformSplitList({ data }: { data: PlatformSplitData[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum investimento registrado no período.
      </p>
    );
  }

  const palette: Record<string, string> = {
    meta_ads: "var(--chart-4)",
    google_ads: "var(--chart-2)",
    tiktok_ads: "var(--chart-3)",
    linkedin_ads: "var(--chart-5)",
    organic: "var(--chart-1)",
  };

  return (
    <ul className="flex flex-col gap-5">
      {data.map((row) => {
        const results = deriveMetric("results", row.totals);
        const color = palette[row.platform] ?? "var(--chart-1)";

        return (
          <li key={row.platform} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {row.label}
              </span>
              <span className="text-sm tabular-nums">
                {formatCurrency(row.totals.spendCents)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatPercent(row.spendShare, 0)}
                </span>
              </span>
            </div>

            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="presentation"
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${Math.max(row.spendShare * 100, 1.5)}%`,
                  backgroundColor: color,
                }}
              />
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {formatNumber(Math.round(results))} resultados
              </span>
              <span aria-hidden className="text-hairline">
                •
              </span>
              <span className="tabular-nums">
                {formatCurrency(row.cpa)} por resultado
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
