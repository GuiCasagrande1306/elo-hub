"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCompact, formatCurrency } from "@/lib/format";
import type { CashflowPoint } from "@/lib/finance/kpi";

/* =====================================================================
   Gráficos financeiros
   ---------------------------------------------------------------------
   SOBRE AS CORES

   O pedido era usar `--primary` e `--secondary`. Uso `--primary` (é a
   cor da marca), mas NÃO `--secondary`: nesta base de tokens ela é uma
   superfície de interface, não uma cor de dado —
   `oklch(0.96 …)` no claro (quase branco) e `oklch(0.31 …)` no escuro
   (navy fechado). Barra de saída pintada com ela ficaria invisível
   sobre o próprio card, nos dois temas.

   Saídas usam `--chart-4` (âmbar): matiz bem afastado do azul, legível
   nos dois temas, e sem a carga de "erro" que o vermelho traria — uma
   despesa prevista não é um problema.

   As cores entram via `ChartConfig`, que o ChartContainer converte em
   `--color-<chave>`. É assim que o gráfico segue o tema sem nenhum
   JavaScript lendo `document.documentElement.classList`.
   ===================================================================== */

const cashflowConfig = {
  entradas: { label: "Entradas", color: "var(--primary)" },
  saidas: { label: "Saídas", color: "var(--chart-4)" },
} satisfies ChartConfig;

const growthConfig = {
  acumulado: { label: "Caixa acumulado", color: "var(--primary)" },
} satisfies ChartConfig;

const brl = (value: number) =>
  formatCurrency(Math.round(value * 100));

/* ------------------------------------------------------------------ */
/* Fluxo de caixa — barras                                             */
/* ------------------------------------------------------------------ */

export function CashflowChart({ data }: { data: CashflowPoint[] }) {
  return (
    <ChartContainer config={cashflowConfig} className="aspect-auto h-[280px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />

        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickFormatter={(v: number) => `R$ ${formatCompact(v)}`}
          tickLine={false}
          axisLine={false}
          width={64}
        />

        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {cashflowConfig[name as keyof typeof cashflowConfig]?.label ??
                      name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {brl(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />

        <ChartLegend content={<ChartLegendContent />} />

        {/* `isAnimationActive={false}`: o Recharts anima a entrada por
            requestAnimationFrame, e em aba em segundo plano o relógio
            congela — as barras ficam com altura zero e o gráfico parece
            quebrado. Mesma decisão dos cards de KPI. */}
        <Bar
          dataKey="entradas"
          fill="var(--color-entradas)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="saidas"
          fill="var(--color-saidas)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Tendência — área suave                                              */
/* ------------------------------------------------------------------ */

export function GrowthChart({ data }: { data: CashflowPoint[] }) {
  return (
    <ChartContainer config={growthConfig} className="aspect-auto h-[280px] w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-acumulado)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--color-acumulado)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" />

        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickFormatter={(v: number) => `R$ ${formatCompact(v)}`}
          tickLine={false}
          axisLine={false}
          width={64}
        />

        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {brl(Number(value))}
                </span>
              )}
            />
          }
        />

        {/* `type="monotone"` é o que dá a curva suave sem inventar
            oscilação entre os pontos, ao contrário de `natural`, que
            extrapola e cria vales que não existem no dado. */}
        <Area
          dataKey="acumulado"
          type="monotone"
          stroke="var(--color-acumulado)"
          strokeWidth={2}
          fill="url(#growth-fill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
