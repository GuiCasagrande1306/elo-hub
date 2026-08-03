"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrendPoint } from "@/lib/metrics/kpi";
import { formatCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Evolução diária: investimento (área, eixo esquerdo) contra resultados
 * (linha, eixo direito).
 *
 * Duas grandezas de ordem muito diferente — reais e unidades — exigem
 * eixos independentes. Forçar as duas no mesmo eixo achata a série menor
 * numa reta colada no zero, que é o defeito mais comum desse gráfico.
 */

type SeriesKey = "spend" | "results" | "revenue";

interface TrendChartProps {
  data: TrendPoint[];
  /** Segunda série. `revenue` para e-commerce, `results` para lead gen. */
  secondary?: Extract<SeriesKey, "results" | "revenue">;
  className?: string;
}

const LABELS: Record<SeriesKey, string> = {
  spend: "Investimento",
  results: "Resultados",
  revenue: "Receita",
};

export function TrendChart({
  data,
  secondary = "results",
  className,
}: TrendChartProps) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Em janelas longas o eixo X vira uma mancha de texto: mostramos no
  // máximo ~8 marcações, escolhidas por passo regular.
  const tickInterval = useMemo(
    () => Math.max(0, Math.ceil(data.length / 8) - 1),
    [data.length],
  );

  const isCurrency = secondary === "revenue";

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {(["spend", secondary] as SeriesKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-opacity",
              hidden.has(key) ? "opacity-40" : "opacity-100",
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor:
                  key === "spend" ? "var(--chart-2)" : "var(--signal)",
              }}
            />
            <span className="text-muted-foreground">{LABELS[key]}</span>
          </button>
        ))}
      </div>

      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: -8 }}
          >
            <defs>
              <linearGradient id="trend-spend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Só linhas horizontais: a grade vertical compete com os
                dados e não ajuda a ler magnitude. */}
            <CartesianGrid
              vertical={false}
              stroke="var(--hairline)"
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDate(`${value}T12:00:00`)}
              interval={tickInterval}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              dy={8}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={(value: number) => `R$ ${formatCompact(value)}`}
              tickLine={false}
              axisLine={false}
              width={62}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(value: number) =>
                isCurrency ? `R$ ${formatCompact(value)}` : formatCompact(value)
              }
              tickLine={false}
              axisLine={false}
              width={isCurrency ? 58 : 40}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />

            <Tooltip
              cursor={{ stroke: "var(--hairline)", strokeWidth: 1 }}
              content={<ChartTooltip secondary={secondary} />}
            />

            {!hidden.has("spend") && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="spend"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#trend-spend)"
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
              />
            )}

            {!hidden.has(secondary) && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={secondary}
                stroke="var(--signal)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TooltipPayloadItem {
  dataKey: string;
  value: number;
}

function ChartTooltip({
  active,
  payload,
  label,
  secondary,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  secondary: SeriesKey;
}) {
  if (!active || !payload?.length) return null;

  const value = (key: string) =>
    payload.find((p) => p.dataKey === key)?.value ?? 0;

  const currency = (n: number) =>
    n.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });

  return (
    <div className="rounded-lg border border-hairline bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-medium">
        {label ? formatDate(`${label}T12:00:00`) : ""}
      </p>
      <dl className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-chart-2" />
            {LABELS.spend}
          </dt>
          <dd className="font-medium tabular-nums">{currency(value("spend"))}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full bg-signal" />
            {LABELS[secondary]}
          </dt>
          <dd className="font-medium tabular-nums">
            {secondary === "revenue"
              ? currency(value(secondary))
              : value(secondary).toLocaleString("pt-BR", {
                  maximumFractionDigits: 0,
                })}
          </dd>
        </div>
      </dl>
    </div>
  );
}
