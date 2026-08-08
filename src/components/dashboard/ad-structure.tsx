"use client";

import { useState } from "react";
import { Layers, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AdsManagerTable,
  type NoDaArvore as No,
} from "@/components/dashboard/ads-manager-table";
import { AdsManagerSkeleton } from "@/components/dashboard/ads-manager-skeleton";

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

interface Estrutura {
  campanhas: No[];
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

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(
        `/api/ads/structure?clientId=${clientId}&since=${since}&until=${until}`,
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

      {carregando && !dados && <AdsManagerSkeleton />}

      {dados && (
        <>
          {dados.campanhas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma entrega no período. Não é erro — a conta pode estar
              pausada.
            </p>
          ) : (
            /* A MESMA tabela da gaveta da Performance. Duas
               implementações da mesma árvore divergiriam na primeira
               coluna nova. */
            <AdsManagerTable
              dados={dados.campanhas}
              resultLabel={resultLabel}
              costLabel={costLabel}
            />
          )}
        </>
      )}
    </section>
  );
}

