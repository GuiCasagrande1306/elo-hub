"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatCurrencyCompact, formatDate, formatNumber } from "@/lib/format";
import type { TrendPoint } from "@/lib/metrics/kpi";
import { escalaDoGrafico } from "@/lib/reports/escala-do-grafico";
import {
  ROTULO_DA_SERIE,
  unidadeComum,
  valorDaSerie,
  type SerieDoGrafico,
} from "@/lib/reports/serie-do-grafico";

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

   ⚠️ ESTE GRÁFICO E O DO PDF SÃO O MESMO GRÁFICO. A folha existe para a
   equipe conferir antes de enviar; enquanto os dois divergiam, a
   revisão aprovava um desenho e o cliente recebia outro. Quatro
   divergências foram fechadas em 25/09/2026 — série, granularidade,
   número de séries e título —, e o que as separava está listado em
   `lib/reports/serie-do-grafico.ts`.

   A ESCALA TAMBÉM É A MESMA. `escalaDoGrafico` decide topo e marcas nos
   dois; deixar o Recharts escolher sozinho faria a folha dizer 0–15 e o
   PDF 0–16 para o mesmo dado, e quem comparasse os dois desconfiaria do
   número, não da escala.
   ===================================================================== */

export function PrintWeeklyChart({
  data,
  color,
  series,
}: {
  data: TrendPoint[];
  color: string;
  series: SerieDoGrafico[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        Sem dados no período.
      </p>
    );
  }

  const max = Math.max(
    ...series.flatMap((s) => data.map((p) => valorDaSerie(p, s))),
    0,
  );

  if (max <= 0) {
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        Sem {ROTULO_DA_SERIE[series[0]].toLowerCase()} no período.
      </p>
    );
  }

  /* Eixo numérico só quando as séries dividem a mesma unidade — com
     dinheiro e contagem no mesmo quadro, um "200" na lateral não diz se
     são reais ou pedidos. Mesma regra do PDF. */
  const unidade = unidadeComum(series);
  const escala = unidade ? escalaDoGrafico(max, unidade) : null;

  /* O Recharts precisa de chaves planas; `valorDaSerie` é quem sabe ler
     cada série do ponto, e é dele que o PDF também lê. */
  const pontos = data.map((p) => ({
    dia: formatDate(`${p.date}T12:00:00`),
    ...Object.fromEntries(series.map((s) => [s, valorDaSerie(p, s)])),
  }));

  const rotulo = (v: number) =>
    unidade === "contagem"
      ? formatNumber(v)
      : formatCurrencyCompact(Math.round(v * 100));

  return (
    <div className="flex flex-col items-center">
    <BarChart
      width={620}
      height={220}
      data={pontos}
      margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
    >
      <CartesianGrid vertical={false} stroke="#e6e8ec" strokeDasharray="3 3" />
      <XAxis
        dataKey="dia"
        tickLine={false}
        axisLine={false}
        tick={{ fill: "#64707d", fontSize: 11 }}
        /* Com trinta dias, trinta rótulos viram uma tarja cinza. O
           Recharts corta sozinho os que não cabem. */
        interval="preserveStartEnd"
        minTickGap={18}
      />
      {escala && (
        <YAxis
          domain={[0, escala.topo]}
          ticks={[...escala.marcas].reverse()}
          tickFormatter={rotulo}
          tickLine={false}
          axisLine={false}
          // 84, não 70: com a largura justa o Recharts quebra "R$ 3.000" em
          // duas linhas. Ele mede o texto e parte a palavra quando o rótulo
          // encosta no limite — e a medição em headless difere o suficiente
          // para acontecer só em alguns ticks, o que parece defeito de dado.
          width={84}
          tick={{ fill: "#64707d", fontSize: 11 }}
        />
      )}
      {series.map((s, i) => (
        <Bar
          key={s}
          dataKey={s}
          /* A primeira série leva a cor da marca; a segunda, o cinza do
             texto secundário. É a mesma dupla do PDF. */
          fill={i === 0 ? color : "#64707d"}
          radius={[5, 5, 0, 0]}
          isAnimationActive={false}
        />
      ))}
    </BarChart>

      {/* LEGENDA PRÓPRIA, e não a do Recharts. Esta versão da biblioteca
          não aceita `payload`, e sem ele ela listava "Faturamento ·
          Investimento" enquanto o PDF imprime "Investimento ·
          Faturamento" — a mesma dupla em ordem trocada nos dois
          documentos que deveriam ser um só. Dois quadrados e dois
          rótulos não valem uma divergência. */}
      {series.length > 1 && (
        <div className="mt-1 flex items-center gap-3 text-[11px] text-[#64707d]">
          {series.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="inline-block size-[7px] rounded-[1px]"
                style={{ backgroundColor: i === 0 ? color : "#64707d" }}
              />
              {ROTULO_DA_SERIE[s]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
