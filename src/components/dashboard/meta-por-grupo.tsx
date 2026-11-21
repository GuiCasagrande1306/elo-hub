"use client";

import { useState } from "react";

import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import { corDoRitmo, textoDoRitmo, type Agrupamento, type Grupo } from "@/lib/metrics/visao-geral";
import { cn } from "@/lib/utils";

const OPCOES: { valor: Agrupamento; rotulo: string }[] = [
  { valor: "segmento", rotulo: "Segmento" },
  { valor: "squad", rotulo: "Squad" },
  { valor: "agencia", rotulo: "Agência" },
];

/** Meta x executado por segmento, squad ou agência — mais adiantado primeiro. */
export function MetaPorGrupo({ grupos }: { grupos: Record<Agrupamento, Grupo[]> }) {
  const [por, setPor] = useState<Agrupamento>("segmento");
  const lista = grupos[por];

  return (
    <section className="surface-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Meta x executado por grupo</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ritmo médio: executado contra o esperado para hoje. 100% = exatamente no ritmo.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline" role="group" aria-label="Agrupar por">
          {OPCOES.map((o) => (
            <button
              key={o.valor}
              type="button"
              aria-pressed={por === o.valor}
              onClick={() => setPor(o.valor)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                por === o.valor ? "bg-background text-foreground ring-1 ring-hairline" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-5 mt-4 overflow-x-auto px-5">
        <table className="w-full min-w-[40rem] text-xs">
          <thead>
            <tr className="border-b border-hairline text-left text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 font-medium">{OPCOES.find((o) => o.valor === por)?.rotulo}</th>
              <th className="pb-2 font-medium">Ritmo médio da meta</th>
              <th className="pb-2 text-center font-medium">No ritmo</th>
              <th className="pb-2 text-center font-medium">Atrasadas</th>
              <th className="pb-2 text-center font-medium">Sem meta</th>
              <th className="pb-2 text-right font-medium">Verba gasta / planejada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {lista.map((g) => (
              <tr key={g.nome}>
                <td className="py-2.5 pr-3">
                  <span className="font-medium">{g.nome}</span>
                  <span className="block text-2xs text-muted-foreground">
                    {g.total} {g.total === 1 ? "conta" : "contas"}
                  </span>
                </td>
                <td className="w-[34%] py-2.5 pr-4">
                  {g.ritmoMedio === null ? (
                    <span className="text-muted-foreground">sem leitura</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", corDoRitmo(g.ritmoMedio))}
                          style={{ width: `${Math.min(g.ritmoMedio / 1.5, 1) * 100}%` }}
                        />
                      </div>
                      <span className={cn("w-11 text-right font-semibold tabular-nums", textoDoRitmo(g.ritmoMedio))}>
                        {formatPercent(g.ritmoMedio, 0)}
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-center tabular-nums text-positive">{g.noRitmo}</td>
                <td className={cn("py-2.5 text-center tabular-nums", g.atrasadas > 0 ? "text-negative" : "text-muted-foreground")}>
                  {g.atrasadas}
                </td>
                <td className="py-2.5 text-center tabular-nums text-muted-foreground">{g.semMeta}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCurrencyCompact(g.gasto)}
                  <span className="text-muted-foreground"> / {g.verbaPlanejada > 0 ? formatCurrencyCompact(g.verbaPlanejada) : "—"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
