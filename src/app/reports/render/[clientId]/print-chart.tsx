"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

/* =====================================================================
   Gráfico da página de impressão
   ---------------------------------------------------------------------
   Duas diferenças em relação aos gráficos de tela, e as duas são
   obrigatórias para o Puppeteer:

   1. LARGURA E ALTURA FIXAS, sem ResponsiveContainer. O Responsive mede
      o elemento pai com ResizeObserver; num navegador headless a
      medição pode acontecer antes do layout estabilizar e o gráfico sai
      com 0px — página em branco no PDF, sem erro nenhum.

   2. `isAnimationActive={false}`. A animação de entrada é movida a
      requestAnimationFrame; o Puppeteer tira a foto antes de ela
      terminar e as barras saem cortadas ou zeradas.
   ===================================================================== */

export interface WeeklyPoint {
  label: string;
  spend: number;
  results: number;
}

export function PrintWeeklyChart({
  data,
  color,
}: {
  data: WeeklyPoint[];
  color: string;
}) {
  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        Sem dados no período.
      </p>
    );
  }

  return (
    <BarChart
      width={620}
      height={220}
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
    >
      <CartesianGrid vertical={false} stroke="#e6e8ec" strokeDasharray="3 3" />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        tick={{ fill: "#64707d", fontSize: 11 }}
      />
      <YAxis
        tickFormatter={(v: number) =>
          `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
        }
        tickLine={false}
        axisLine={false}
        // 84, não 70: com a largura justa o Recharts quebra "R$ 3.000" em
        // duas linhas. Ele mede o texto e parte a palavra quando o rótulo
        // encosta no limite — e a medição em headless difere o suficiente
        // para acontecer só em alguns ticks, o que parece defeito de dado.
        width={84}
        tick={{ fill: "#64707d", fontSize: 11 }}
      />
      <Bar
        dataKey="spend"
        fill={color}
        radius={[5, 5, 0, 0]}
        isAnimationActive={false}
      />
    </BarChart>
  );
}
