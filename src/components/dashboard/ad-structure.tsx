"use client";

import { useState } from "react";
import { ChevronRight, Layers, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Estrutura da conta — campanha › conjunto › anúncio
   ---------------------------------------------------------------------
   CARREGA SOB DEMANDA. É uma chamada externa de até 20s, e a maioria das
   visitas à página do cliente é para ler os KPIs do topo — pagá-la em
   todo carregamento atrasaria a tela para quem nem vai abrir isto.

   Tudo colapsado no início. Uma conta com 20 campanhas × 3 conjuntos ×
   5 anúncios abriria 300 linhas de uma vez, e a pergunta que traz alguém
   aqui é sempre "qual campanha está gastando", não "me mostre tudo".
   ===================================================================== */

interface No {
  id: string;
  name: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  results: number;
  filhos: No[];
}

interface Estrutura {
  campanhas: No[];
  totalSpendCents: number;
  totalResults: number;
}

export function AdStructure({
  clientId,
  since,
  until,
  resultLabel,
  costLabel,
}: {
  clientId: string;
  since: string;
  until: string;
  /** "Visitas ao perfil", "Compras"… — o card não inventa "resultados". */
  resultLabel: string;
  costLabel: string;
}) {
  const [dados, setDados] = useState<Estrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(
        `/api/meta/structure?clientId=${clientId}&since=${since}&until=${until}`,
      );
      const j = (await r.json()) as Estrutura & { error?: string };
      if (j.error) setErro(j.error);
      else setDados(j);
    } catch {
      setErro("Não foi possível falar com a Meta agora.");
    } finally {
      setCarregando(false);
    }
  }

  function alternar(id: string) {
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <section className="surface-card mt-8 p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em]">
            <Layers className="size-4 text-muted-foreground" />
            Estrutura da conta
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Campanha, conjunto e anúncio — o que entregou no período, com o
            gasto de cada nível.
          </p>
        </div>

        <Button
          size="sm"
          variant={dados ? "ghost" : "outline"}
          className="h-8 shrink-0"
          disabled={carregando}
          onClick={carregar}
        >
          {carregando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {dados ? "Atualizar" : "Carregar"}
        </Button>
      </header>

      {erro && (
        <p className="rounded-xl bg-warning-muted px-4 py-3 text-sm text-warning">
          {erro}
        </p>
      )}

      {!dados && !erro && !carregando && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Os números vêm direto da Meta, então só buscamos quando você pede.
        </p>
      )}

      {carregando && !dados && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Consultando o gerenciador…
        </p>
      )}

      {dados && (
        <>
          {dados.campanhas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma entrega no período. Não é erro — a conta pode estar
              pausada.
            </p>
          ) : (
            <>
              <div className="hidden grid-cols-[1fr_100px_92px_92px] gap-3 border-b border-hairline px-2 pb-2 sm:grid">
                {["", "Gasto", resultLabel, costLabel].map((h, i) => (
                  <span
                    key={h || i}
                    className={cn("eyebrow", i > 0 && "text-right")}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <ul className="divide-y divide-hairline">
                {dados.campanhas.map((c) => (
                  <Linha
                    key={c.id}
                    no={c}
                    nivel={0}
                    aberto={abertos}
                    alternar={alternar}
                  />
                ))}
              </ul>

              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-sm">
                <span className="font-medium">Total da conta</span>
                <span className="flex gap-6 tabular-nums">
                  <span className="font-semibold">
                    {formatCurrency(dados.totalSpendCents)}
                  </span>
                  <span className="font-semibold">
                    {formatNumber(Math.round(dados.totalResults))}
                  </span>
                </span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

const RECUO = ["pl-2", "pl-7", "pl-12"];

function Linha({
  no,
  nivel,
  aberto,
  alternar,
}: {
  no: No;
  nivel: number;
  aberto: Set<string>;
  alternar: (id: string) => void;
}) {
  const temFilhos = no.filhos.length > 0;
  const chave = `${nivel}:${no.id}`;
  const expandido = aberto.has(chave);

  /* Custo unitário calculado AQUI, a partir do gasto e do resultado da
     própria linha — não herdado do pai. Um conjunto que gastou sem
     converter mostra "—", e é essa linha que a pessoa veio procurar. */
  const custo = no.results > 0 ? no.spendCents / no.results : null;

  return (
    <li>
      <div
        className={cn(
          "grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[1fr_100px_92px_92px]",
          RECUO[nivel],
        )}
      >
        <button
          type="button"
          disabled={!temFilhos}
          onClick={() => alternar(chave)}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-left",
            temFilhos && "transition-colors hover:text-signal",
          )}
        >
          {temFilhos ? (
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expandido && "rotate-90",
              )}
            />
          ) : (
            <span className="size-3.5 shrink-0" aria-hidden />
          )}

          <span
            className={cn(
              "truncate",
              nivel === 0 ? "text-sm font-medium" : "text-xs",
              nivel === 2 && "text-muted-foreground",
            )}
          >
            {no.name}
          </span>

          {temFilhos && (
            <span className="shrink-0 text-2xs text-muted-foreground">
              ({no.filhos.length})
            </span>
          )}
        </button>

        <span className="text-right text-xs tabular-nums">
          {formatCurrency(no.spendCents)}
        </span>

        <span className="hidden text-right text-xs tabular-nums sm:block">
          {formatNumber(Math.round(no.results))}
        </span>

        <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
          {custo === null ? "—" : formatCurrency(Math.round(custo))}
        </span>
      </div>

      {expandido && temFilhos && (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {no.filhos.map((f) => (
            <Linha
              key={f.id}
              no={f}
              nivel={nivel + 1}
              aberto={aberto}
              alternar={alternar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
