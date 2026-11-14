"use client";

import { mesCorrenteBR, nomeDoMes } from "@/lib/date-br";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useMoeda } from "@/lib/moeda";
import { cn } from "@/lib/utils";
import type { GoalHistoryEntry } from "@/lib/data";

/* =====================================================================
   Histórico de metas — mês a mês, em tabela
   ---------------------------------------------------------------------
   Meta contra realizado, investimento e a situação de cada mês. Era um
   gráfico de barras; a equipe pediu a tabela (13/11/2026), que responde
   "bateu ou não?" sem precisar ler escala.

   O realizado vem SOMADO de `daily_metrics` no servidor, não de coluna
   gravada: a Meta reatribui conversão retroativamente, e um número
   congelado passaria a contradizer o painel sem avisar.
   ===================================================================== */

/**
 * Formata pela unidade DAQUELE mês. Uma conta que mudou de contagem
 * para faturamento tem linhas nas duas unidades; formatar tudo pela
 * regra de hoje imprimiria "R$ 1,20" onde foram 120 leads.
 */
function valorDoMes(entry: GoalHistoryEntry, valor: number, moeda: string): string {
  return entry.metricKey === "revenue"
    ? formatCurrency(valor, moeda)
    : formatNumber(Math.round(valor));
}

type Situacao = { rotulo: string; classe: string };

function situacao(e: GoalHistoryEntry, mesAtual: string): Situacao {
  if (e.plannedResults <= 0) return { rotulo: "Sem meta", classe: "text-muted-foreground" };
  if (e.executedResults >= e.plannedResults) return { rotulo: "Batida", classe: "text-positive" };
  if (e.month === mesAtual) return { rotulo: "Em andamento", classe: "text-warning" };
  return { rotulo: "Não batida", classe: "text-negative" };
}

export function GoalHistory({ entries }: { entries: GoalHistoryEntry[] }) {
  const moeda = useMoeda();
  const mesAtual = mesCorrenteBR().referencia;
  const linhas = [...entries].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold">Mês a mês</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Meta, realizado, investimento e se a meta foi batida.
      </p>

      {linhas.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-hairline px-4 py-8 text-center text-xs text-muted-foreground">
          Nenhum mês com meta registrada ainda.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-xs">
            <thead>
              <tr className="border-b border-hairline text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">Mês</th>
                <th className="pb-2 text-right font-medium">Meta</th>
                <th className="pb-2 text-right font-medium">Realizado</th>
                <th className="pb-2 text-right font-medium">Investimento</th>
                <th className="pb-2 text-right font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {linhas.map((e) => {
                const s = situacao(e, mesAtual);
                return (
                  <tr key={e.month}>
                    <td className="py-2">{nomeDoMes(e.month)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {e.plannedResults ? valorDoMes(e, e.plannedResults, moeda) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {valorDoMes(e, e.executedResults, moeda)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(e.executedSpendCents, moeda)}
                      {e.plannedBudgetCents > 0 && (
                        <span className="text-2xs"> de {formatCurrency(e.plannedBudgetCents, moeda)}</span>
                      )}
                    </td>
                    <td className={cn("py-2 text-right font-medium", s.classe)}>{s.rotulo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
