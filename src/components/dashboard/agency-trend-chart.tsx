"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { mesCurto } from "@/lib/date-br";

/* =====================================================================
   Investimento contra retorno — agência inteira
   ---------------------------------------------------------------------
   DUAS ESCALAS, dois eixos. Investimento e receita diferem em uma ordem
   de grandeza (R$ 2 mil contra R$ 40 mil num dia comum): num eixo só, a
   curva de gasto vira uma linha reta colada no zero e some justamente a
   informação que se veio olhar.

   `isAnimationActive={false}`: a animação do Recharts é movida a
   requestAnimationFrame, que o navegador congela em aba de segundo
   plano — o gráfico ficava parado no meio da transição ao voltar.
   ===================================================================== */

export function AgencyTrendChart({
  data,
}: {
  data: { date: string; spend: number; revenue: number }[];
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
          <defs>
            <linearGradient id="ag-spend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--signal)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--signal)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="ag-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--hairline)"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
            /* Só o dia: com 31 rótulos de data completa nenhum é legível. */
            tickFormatter={(d: string) => d.slice(8, 10)}
            minTickGap={16}
          />

          <YAxis
            yAxisId="spend"
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => formatCurrencyCompact(v * 100)}
          />
          <YAxis
            yAxisId="rev"
            orientation="right"
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => formatCurrencyCompact(v * 100)}
          />

          <Tooltip
            cursor={{ stroke: "var(--hairline)" }}
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelFormatter={(d) => mesCurto(String(d).slice(0, 7)) + " · dia " + String(d).slice(8, 10)}
            formatter={(v, name) => [formatCurrency(Number(v) * 100), name]}
          />

          <Area
            yAxisId="spend"
            type="monotone"
            dataKey="spend"
            name="Investimento"
            stroke="var(--signal)"
            strokeWidth={2}
            fill="url(#ag-spend)"
            isAnimationActive={false}
          />
          <Area
            yAxisId="rev"
            type="monotone"
            dataKey="revenue"
            name="Retorno"
            stroke="var(--positive)"
            strokeWidth={2}
            fill="url(#ag-rev)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
