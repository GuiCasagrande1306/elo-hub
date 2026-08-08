"use client";

import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronRight, Columns3, ExternalLink, ImageOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Emulador do Gerenciador — campanha › conjunto › anúncio
   ---------------------------------------------------------------------
   TanStack Table com `getSubRows`: a hierarquia é dado, não markup, e é
   por isso que expandir, esconder coluna e (adiante) ordenar funcionam
   nos três níveis sem código próprio para cada um.

   AS MÉTRICAS DERIVADAS SÃO CALCULADAS POR LINHA, nunca herdadas do pai
   nem somadas. CTR de uma campanha é `cliques/impressões` DELA — somar o
   CTR dos anúncios daria um número que não significa nada, e é o erro
   mais comum em tabela hierárquica. O mesmo vale para CPC, CPM, CPA e
   ROAS.

   Colunas escondidas por padrão são as de diagnóstico (CPM, CTR, CPC):
   quem abre isto quer saber onde o dinheiro foi, e sete colunas de
   entrada empurram o que importa para fora da tela. Ficam a um clique.
   ===================================================================== */

export type NivelDaArvore = "campanha" | "conjunto" | "anuncio";

export interface NoDaArvore {
  id: string;
  name: string;
  nivel: NivelDaArvore;
  spendCents: number;
  impressions: number;
  clicks: number;
  results: number;
  revenueCents: number;
  thumbnailUrl?: string | null;
  permalink?: string | null;
  filhos: NoDaArvore[];
}

const NIVEL_LABEL: Record<NivelDaArvore, string> = {
  campanha: "Campanha",
  conjunto: "Conjunto",
  anuncio: "Anúncio",
};

const coluna = createColumnHelper<NoDaArvore>();

/** Divisão que devolve `null` em vez de Infinity ou NaN. */
const razao = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function AdsManagerTable({
  dados,
  resultLabel,
  costLabel,
}: {
  dados: NoDaArvore[];
  resultLabel: string;
  costLabel: string;
}) {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    /* Diagnóstico entra desligado — ver a nota no topo. */
    cpm: false,
    ctr: false,
    cpc: false,
    impressions: false,
  });

  const columns = useMemo(
    () =>
      [
        coluna.accessor("name", {
          id: "name",
          header: "Nome",
          enableHiding: false,
          cell: ({ row }) => <Nome row={row.original} depth={row.depth} canExpand={row.getCanExpand()} expanded={row.getIsExpanded()} toggle={row.getToggleExpandedHandler()} />,
        }),
        coluna.accessor("spendCents", {
          id: "spend",
          header: "Gasto",
          enableHiding: false,
          cell: (i) => formatCurrency(i.getValue()),
        }),
        coluna.accessor("results", {
          id: "results",
          header: resultLabel,
          cell: (i) => formatNumber(Math.round(i.getValue())),
        }),
        coluna.display({
          id: "cpa",
          header: costLabel,
          cell: ({ row }) => {
            const v = razao(row.original.spendCents, row.original.results);
            return v === null ? "—" : formatCurrency(Math.round(v));
          },
        }),
        coluna.display({
          id: "roas",
          header: "ROAS",
          cell: ({ row }) => {
            const v = razao(row.original.revenueCents, row.original.spendCents);
            return v === null || v === 0
              ? "—"
              : `${v.toFixed(2).replace(".", ",")}x`;
          },
        }),
        coluna.accessor("impressions", {
          id: "impressions",
          header: "Impressões",
          cell: (i) => formatNumber(i.getValue()),
        }),
        coluna.display({
          id: "cpm",
          header: "CPM",
          cell: ({ row }) => {
            const v = razao(row.original.spendCents, row.original.impressions);
            return v === null ? "—" : formatCurrency(Math.round(v * 1000));
          },
        }),
        coluna.display({
          id: "ctr",
          header: "CTR",
          cell: ({ row }) => {
            const v = razao(row.original.clicks, row.original.impressions);
            return v === null ? "—" : formatPercent(v, 2);
          },
        }),
        coluna.display({
          id: "cpc",
          header: "CPC",
          cell: ({ row }) => {
            const v = razao(row.original.spendCents, row.original.clicks);
            return v === null ? "—" : formatCurrency(Math.round(v));
          },
        }),
      ] as ColumnDef<NoDaArvore, unknown>[],
    [resultLabel, costLabel],
  );

  /* O React Compiler avisa que `useReactTable` devolve funções que ele
     não consegue memoizar, e por isso desiste de memoizar este
     componente. É esperado e aceitável aqui: a tabela renderiza dezenas
     de linhas, não milhares, e só existe atrás de um clique. Não há API
     alternativa na v8 — suprimir é a escolha, não o descuido. */
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: dados,
    columns,
    state: { expanded, columnVisibility },
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: setColumnVisibility,
    getSubRows: (linha) => linha.filhos,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowId: (linha, index, pai) =>
      /* Id estável e ÚNICO na árvore. Só `linha.id` colidiria: o mesmo
         anúncio não se repete, mas linhas sem id caem em `_sem_*` e
         duas delas fechariam o mesmo nó ao expandir. */
      pai ? `${pai.id}>${linha.id}-${index}` : `${linha.id}-${index}`,
  });

  const totais = useMemo(
    () =>
      dados.reduce(
        (acc, c) => ({
          spend: acc.spend + c.spendCents,
          results: acc.results + c.results,
        }),
        { spend: 0, results: 0 },
      ),
    [dados],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xs text-muted-foreground">
          {dados.length} campanha{dados.length === 1 ? "" : "s"} com entrega
        </p>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="outline" className="h-8">
                <Columns3 className="size-3.5" />
                Colunas
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Mostrar colunas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={c.getIsVisible()}
                  onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                >
                  {String(c.columnDef.header)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="surface-card overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((grupo) => (
              <tr key={grupo.id} className="border-b border-hairline">
                {grupo.headers.map((h, i) => (
                  <th
                    key={h.id}
                    className={cn(
                      "eyebrow whitespace-nowrap px-3 py-2.5 font-medium",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-hairline">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "transition-colors hover:bg-accent/30",
                  /* O fundo desce com a profundidade: sem isso, uma
                     campanha aberta vira 40 linhas iguais e some a
                     noção de onde termina cada bloco. */
                  row.depth === 1 && "bg-surface-2/30",
                  row.depth === 2 && "bg-surface-2/50",
                )}
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "px-3 py-2 tabular-nums",
                      i === 0 ? "text-left" : "text-right whitespace-nowrap",
                      row.depth > 0 && "text-xs",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t border-hairline bg-surface-2/40">
              <td className="px-3 py-2.5 text-sm font-medium">Total</td>
              <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">
                {formatCurrency(totais.spend)}
              </td>
              <td
                colSpan={table.getVisibleFlatColumns().length - 2}
                className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums"
              >
                {table.getColumn("results")?.getIsVisible()
                  ? formatNumber(Math.round(totais.results))
                  : null}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const RECUO = ["", "pl-5", "pl-10"];

function Nome({
  row,
  depth,
  canExpand,
  expanded,
  toggle,
}: {
  row: NoDaArvore;
  depth: number;
  canExpand: boolean;
  expanded: boolean;
  toggle: () => void;
}) {
  const anuncio = row.nivel === "anuncio";

  return (
    <div className={cn("flex min-w-0 items-center gap-2", RECUO[depth])}>
      {canExpand ? (
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-accent"
          aria-label={expanded ? "Recolher" : "Expandir"}
        >
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}

      {/* Miniatura só no anúncio: campanha e conjunto não têm criativo,
          e um quadrado vazio nos três níveis seria ruído. */}
      {anuncio &&
        (row.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL do CDN da Meta, externa e variável.
          <img
            src={row.thumbnailUrl}
            alt=""
            className="size-8 shrink-0 rounded object-cover ring-1 ring-inset ring-hairline"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-2 ring-1 ring-inset ring-hairline">
            <ImageOff className="size-3.5 text-muted-foreground/60" />
          </span>
        ))}

      <div className="min-w-0">
        <p className={cn("truncate", depth === 0 && "font-medium")}>
          {row.name}
        </p>
        <p className="text-2xs text-muted-foreground">
          {NIVEL_LABEL[row.nivel]}
          {canExpand && ` · ${row.filhos.length}`}
        </p>
      </div>

      {anuncio && row.permalink && (
        <a
          href={row.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={`Abrir ${row.name}`}
          title="Abrir o post"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
