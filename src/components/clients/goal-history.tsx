"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { mesCurto, nomeDoMes } from "@/lib/date-br";
import type { GoalHistoryEntry } from "@/lib/data";

/* =====================================================================
   Histórico de metas
   ---------------------------------------------------------------------
   Meta contra realizado, mês a mês. O que a tela responde é "a conta
   costuma bater?", pergunta que nenhum card do mês corrente responde —
   um mês bom esconde três ruins.

   O realizado vem SOMADO de `daily_metrics` no servidor, não de coluna
   gravada: a Meta reatribui conversão retroativamente, e um número
   congelado passaria a contradizer o painel sem avisar.
   ===================================================================== */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export function GoalHistory({ entries }: { entries: GoalHistoryEntry[] }) {
  /* Mais antigo à esquerda: gráfico de tempo lido da direita para a
     esquerda inverte a leitura de tendência. */
  const dados = [...entries]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => ({
      mes: mesCurto(e.month),
      Meta: e.plannedResults,
      Realizado: e.executedResults,
      orcamento: e.plannedBudgetCents,
      gasto: e.executedSpendCents,
    }));

  const comMeta = dados.filter((d) => d.Meta > 0);

  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold">Histórico de metas</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Planejado contra realizado, mês a mês.
      </p>

      {comMeta.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-hairline px-4 py-8 text-center text-xs text-muted-foreground">
          Nenhum mês com meta definida ainda. Assim que houver dois, o
          gráfico mostra a evolução.
        </p>
      ) : (
        <>
          <div className="mt-5 h-56">
            <ResponsiveContainer width="100%" height="100%">
              {/* `isAnimationActive={false}`: a animação do Recharts é
                  movida a requestAnimationFrame, que o navegador congela
                  em aba de segundo plano — o gráfico ficava parado no
                  meio da transição ao voltar. */}
              <BarChart data={dados} barGap={4}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--hairline)"
                  vertical={false}
                />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{
                    background: "var(--surface-1)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar
                  dataKey="Meta"
                  fill="var(--muted-foreground)"
                  fillOpacity={0.35}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Realizado"
                  fill="var(--signal)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-xs">
              <thead>
                <tr className="border-b border-hairline text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-medium">Mês</th>
                  <th className="pb-2 text-right font-medium">Meta</th>
                  <th className="pb-2 text-right font-medium">Realizado</th>
                  <th className="pb-2 text-right font-medium">Verba</th>
                  <th className="pb-2 text-right font-medium">Gasto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {[...entries]
                  .sort((a, b) => b.month.localeCompare(a.month))
                  .map((e) => {
                    const atingiu =
                      e.plannedResults > 0 &&
                      e.executedResults >= e.plannedResults;

                    return (
                      <tr key={e.month}>
                        <td className="py-2">{nomeDoMes(e.month)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {e.plannedResults || "—"}
                        </td>
                        <td
                          className={
                            atingiu
                              ? "py-2 text-right font-medium tabular-nums text-positive"
                              : "py-2 text-right tabular-nums"
                          }
                        >
                          {e.executedResults}
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">
                          {e.plannedBudgetCents
                            ? BRL.format(e.plannedBudgetCents / 100)
                            : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">
                          {BRL.format(e.executedSpendCents / 100)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
