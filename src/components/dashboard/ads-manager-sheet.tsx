"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AdsManagerTable,
  type NoDaArvore,
} from "@/components/dashboard/ads-manager-table";

/* =====================================================================
   Gaveta do gerenciador, a partir da Performance
   ---------------------------------------------------------------------
   A tabela de Performance responde "qual conta está pior"; esta gaveta
   responde "por quê", sem tirar a carteira da tela. Navegar para a
   página do cliente e voltar perde o filtro, o período e a posição de
   rolagem — e a pergunta seguinte é quase sempre sobre a PRÓXIMA conta
   da lista.

   Carrega ao ABRIR, não antes: são 46 contas na tabela e uma chamada
   externa por conta seria absurdo. O estado morre junto com a gaveta,
   então reabrir busca de novo — o que é certo para número de mídia, que
   muda o tempo todo.
   ===================================================================== */

export function AdsManagerSheet({
  clientId,
  clientName,
  clientSlug,
  since,
  until,
  resultLabel,
  costLabel,
}: {
  clientId: string;
  clientName: string;
  clientSlug: string;
  since: string;
  until: string;
  resultLabel: string;
  costLabel: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<NoDaArvore[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function abrir() {
    setAberto(true);
    if (dados || carregando) return;

    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(
        `/api/meta/structure?clientId=${clientId}&since=${since}&until=${until}`,
      );
      const j = (await r.json()) as {
        campanhas?: NoDaArvore[];
        error?: string;
      };
      if (j.error) setErro(j.error);
      else setDados(j.campanhas ?? []);
    } catch {
      setErro("Não foi possível falar com a Meta agora.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={abrir}
        aria-label={`Ver estrutura de ${clientName}`}
      >
        <Layers className="size-3.5" />
        Estrutura
      </Button>

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-4xl"
        >
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              {clientName}
              <Link
                href={`/clientes/${clientSlug}`}
                className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground transition-colors hover:text-foreground"
              >
                abrir conta
                <ArrowUpRight className="size-3" />
              </Link>
            </SheetTitle>
            <SheetDescription>
              Campanha, conjunto e anúncio — o que entregou no período.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6">
            {carregando && (
              <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Consultando o gerenciador…
              </p>
            )}

            {erro && (
              <p className="rounded-xl bg-warning-muted px-4 py-3 text-sm text-warning">
                {erro}
              </p>
            )}

            {dados && dados.length === 0 && !erro && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma entrega no período. Não é erro — a conta pode estar
                pausada.
              </p>
            )}

            {dados && dados.length > 0 && (
              <AdsManagerTable
                dados={dados}
                resultLabel={resultLabel}
                costLabel={costLabel}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
