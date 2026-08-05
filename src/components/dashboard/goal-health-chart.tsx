"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { GoalHealth } from "@/lib/data";

/* =====================================================================
   Saúde das metas da carteira
   ---------------------------------------------------------------------
   Rosca em vez de pizza cheia: o buraco no meio carrega o total, que é
   o número que a pessoa procura primeiro ("quantas contas eu tenho?").

   `isAnimationActive={false}` NÃO é preferência estética. A animação do
   Recharts é movida a requestAnimationFrame; em aba em segundo plano o
   navegador congela o rAF e o gráfico fica parado no primeiro frame —
   ou seja, invisível. Já aconteceu duas vezes neste projeto.

   As cores vêm dos tokens do tema, então a rosca acompanha claro e
   escuro sem uma segunda paleta para divergir.
   ===================================================================== */

const FAIXAS: {
  chave: GoalHealth;
  label: string;
  cor: string;
  descricao: string;
}[] = [
  {
    chave: "batendo",
    label: "Batendo a meta",
    cor: "var(--positive)",
    descricao: "80% ou mais do previsto",
  },
  {
    chave: "atencao",
    label: "Atenção",
    cor: "var(--warning)",
    descricao: "entre 50% e 80%",
  },
  {
    chave: "critico",
    label: "Crítico",
    cor: "var(--negative)",
    descricao: "abaixo de 50%",
  },
];

export function GoalHealthChart({
  health,
}: {
  health: Record<GoalHealth, number>;
}) {
  const dados = FAIXAS.map((f) => ({ ...f, valor: health[f.chave] })).filter(
    (f) => f.valor > 0,
  );

  const total = dados.reduce((acc, d) => acc + d.valor, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <p className="text-sm font-medium">Sem metas definidas</p>
        <p className="mt-1 max-w-[24ch] text-xs text-muted-foreground">
          Assim que houver meta de resultados nas suas contas, o
          acompanhamento aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto h-[168px] w-full max-w-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dados}
              dataKey="valor"
              nameKey="label"
              innerRadius={54}
              outerRadius={80}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {dados.map((d) => (
                <Cell key={d.chave} fill={d.cor} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Total no centro. Fora do SVG de propósito: texto do Recharts
            não herda a tipografia do sistema nem o `tabular-nums`. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums leading-none">
            {total}
          </span>
          <span className="mt-0.5 text-2xs text-muted-foreground">
            {total === 1 ? "conta" : "contas"}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {FAIXAS.map((f) => (
          <li key={f.chave} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: f.cor }}
            />
            <span className="flex-1 truncate">
              {f.label}
              <span className="ml-1.5 text-muted-foreground">
                ({f.descricao})
              </span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {health[f.chave]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
