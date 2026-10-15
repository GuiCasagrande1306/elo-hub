"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCompact, formatCurrency } from "@/lib/format";
import type { MonthlySummary } from "@/types/database";

const config = {
  entradas: { label: "Entradas", color: "var(--primary)" },
  saidas:   { label: "Saídas",   color: "var(--chart-4)" },
} satisfies ChartConfig;

const brl = (v: number) => formatCurrency(Math.round(v * 100));

export function GraficoFluxo({ meses }: { meses: MonthlySummary[] }) {
  const data = [...meses]
    .reverse()
    .slice(-6)
    .map((m) => ({
      label: new Date(`${m.month.slice(0, 7)}-15`).toLocaleDateString("pt-BR", {
        month: "short",
        year: "2-digit",
      }),
      entradas: m.income_cents  / 100,
      saidas:   m.expense_cents / 100,
    }));

  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickFormatter={(v: number) => `R$ ${formatCompact(v)}`}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {config[name as keyof typeof config]?.label ?? name}
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
        <Bar dataKey="entradas" fill="var(--color-entradas)" radius={[4,4,0,0]} isAnimationActive={false} />
        <Bar dataKey="saidas"   fill="var(--color-saidas)"   radius={[4,4,0,0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
