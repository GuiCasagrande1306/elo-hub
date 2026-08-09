"use client";

import { Columns3, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COLUNAS, COLUNAS_PADRAO, type ColunaId } from "./task-columns";

/* =====================================================================
   Menu de colunas
   ---------------------------------------------------------------------
   MOSTRAR E ESCONDER, sem reordenar por arrasto. Reordenar é o recurso
   que parece obrigatório numa tabela e quase nunca é usado depois da
   primeira semana — e custa arrasto, teclado e persistência de ordem
   para entregar o que a escolha de visibilidade já entrega: ver menos
   coisa.

   Não deixa esconder TUDO. Uma tabela só com título e caixa de concluir
   não é uma tabela, e o caminho de volta some junto com a última coluna.
   ===================================================================== */

export function ColumnMenu({
  visiveis,
  onChange,
}: {
  visiveis: ColunaId[];
  onChange: (proximas: ColunaId[]) => void;
}) {
  const escondidas = COLUNAS.length - visiveis.length;

  function alternar(id: ColunaId) {
    const marcada = visiveis.includes(id);
    /* A última não se desmarca: sem ela a tabela vira uma lista de
       títulos e o menu perde a razão de existir. */
    if (marcada && visiveis.length === 1) return;

    onChange(
      marcada
        ? visiveis.filter((v) => v !== id)
        : /* Reinsere na ORDEM DO CATÁLOGO, não no fim. Sem isso, esconder
             e mostrar de novo jogaria a coluna para a última posição e a
             tabela mudaria de forma a cada clique. */
          COLUNAS.filter((c) => visiveis.includes(c.id) || c.id === id).map(
            (c) => c.id,
          ),
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            <Columns3 className="size-3.5" />
            Colunas
            {escondidas > 0 && (
              <span className="rounded-full bg-surface-2 px-1.5 text-2xs tabular-nums text-muted-foreground">
                −{escondidas}
              </span>
            )}
          </Button>
        }
      />

      <PopoverContent align="end" className="w-56 p-2">
        <p className="eyebrow mb-1.5 px-1">Colunas visíveis</p>

        <div className="flex flex-col">
          {COLUNAS.map((coluna) => {
            const marcada = visiveis.includes(coluna.id);
            const ultima = marcada && visiveis.length === 1;

            return (
              <label
                key={coluna.id}
                className={cnLabel(ultima)}
                title={ultima ? "Ao menos uma coluna precisa ficar" : undefined}
              >
                <input
                  type="checkbox"
                  checked={marcada}
                  disabled={ultima}
                  onChange={() => alternar(coluna.id)}
                  className="size-3.5 accent-[var(--primary)]"
                />
                {coluna.label}
              </label>
            );
          })}
        </div>

        {escondidas > 0 && (
          <button
            type="button"
            onClick={() => onChange(COLUNAS_PADRAO)}
            className="mt-1.5 flex w-full items-center gap-1.5 border-t border-hairline px-1 pt-2 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Mostrar todas
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function cnLabel(desabilitada: boolean): string {
  return [
    "flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-xs transition-colors hover:bg-accent",
    desabilitada && "cursor-not-allowed opacity-50",
  ]
    .filter(Boolean)
    .join(" ");
}
