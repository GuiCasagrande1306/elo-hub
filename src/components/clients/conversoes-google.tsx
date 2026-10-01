import { TriangleAlert } from "lucide-react";

import type { ResumoDeConversoes } from "@/lib/ads/categorias-google";

/* =====================================================================
   O que o Google entregou, por tipo
   ---------------------------------------------------------------------
   ⚠️ EXISTE PORQUE A COLUNA "CONVERSÕES" DO GOOGLE OMITE AÇÃO LOCAL.
   Pedido de rota, clique para ligar e contato vindos do Perfil da
   Empresa só aparecem em "todas as conversões" — então a ficha da
   Agenda Contabilidade mostrava "0 leads" ao lado de 1 ligação e 6
   rotas reais em setembro.

   RESULTADO E MICRO FICAM SEPARADOS, com uma linha divisória de
   verdade. Juntá-los daria o número do Atacado de Pratas inflado em 54
   vezes: 9.322 das 9.516 "conversões" dele são "adicionar ao
   carrinho". A classificação mora em `lib/ads/categorias-google.ts`.
   ===================================================================== */

export function ConversoesGoogle({ resumo }: { resumo: ResumoDeConversoes }) {
  const { resultados, micros, totalDeResultados } = resumo;

  return (
    <section className="surface-card p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold">Conversões do Google</h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Inclui ação do Perfil da Empresa, que não entra na coluna
            “Conversões” do painel do Google.
          </p>
        </div>
        <span className="text-sm font-medium tabular-nums">
          {totalDeResultados}{" "}
          <span className="font-normal text-muted-foreground">
            {totalDeResultados === 1 ? "resultado" : "resultados"}
          </span>
        </span>
      </header>

      {resultados.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Nenhum resultado no período.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {resultados.map((r) => (
            <li
              key={r.id}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span>{r.label}</span>
              <span className="font-medium tabular-nums">{r.total}</span>
            </li>
          ))}
        </ul>
      )}

      {micros.length > 0 && (
        <div className="mt-5 border-t border-hairline pt-4">
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0" />
            Passos do caminho — não contam como resultado
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {micros.map((m) => (
              <li
                key={m.id}
                className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
              >
                <span>{m.label}</span>
                <span className="tabular-nums">{m.total}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
