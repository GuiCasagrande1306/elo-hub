"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AdsManagerTable,
  type NoDaArvore,
} from "@/components/dashboard/ads-manager-table";
import { AdsManagerSkeleton } from "@/components/dashboard/ads-manager-skeleton";
import {
  PeriodPicker,
  janelaDeDias,
  type Periodo,
} from "@/components/dashboard/period-picker";
import { formatCurrency, formatNumber } from "@/lib/format";

/* =====================================================================
   Gerenciador unificado, em diálogo CENTRAL
   ---------------------------------------------------------------------
   Era gaveta lateral e virou diálogo central por uma razão concreta: a
   gaveta cabia quatro colunas antes de cortar, e a tabela tem nove. Numa
   tela que existe para comparar gasto contra resultado, esconder metade
   das colunas por falta de largura anula o motivo dela existir.

   O PERÍODO É PRÓPRIO DAQUI, e não herdado da página. Quem abre isto
   está investigando — a pergunta seguinte a "quanto gastou em 30 dias" é
   quase sempre "e em 7?". Fazer voltar, mudar o filtro da página inteira
   e reabrir perderia a linha de raciocínio.

   Carrega ao ABRIR e a cada troca de período. Nunca antes: são 46 contas
   na Performance, e uma chamada externa por linha ao montar a página
   seria a diferença entre abrir em 1s e em um minuto.
   ===================================================================== */

type Plataforma = "meta_ads" | "google_ads";

interface Resposta {
  campanhas: NoDaArvore[];
  conectadas: Plataforma[];
}

const PLATAFORMA: Record<Plataforma, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};

export function AdsManagerSheet({
  clientId,
  clientName,
  clientSlug,
  resultLabel,
  costLabel,
}: {
  clientId: string;
  clientName: string;
  clientSlug: string;
  resultLabel: string;
  costLabel: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>(() => janelaDeDias(30));
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(
    async ({ since, until }: Periodo) => {
      setCarregando(true);
      setErro(null);
      setDados(null);

      try {
        const r = await fetch(
          `/api/ads/structure?clientId=${clientId}&since=${since}&until=${until}`,
        );
        const j = (await r.json()) as Resposta & { error?: string };
        if (j.error) setErro(j.error);
        else setDados(j);
      } catch {
        setErro("Não foi possível falar com a Meta e o Google agora.");
      } finally {
        setCarregando(false);
      }
    },
    [clientId],
  );

  /* Sem `useEffect`: os dois gatilhos são CLIQUES — abrir o diálogo e
     trocar o período. Buscar a partir de um efeito que observa `aberto`
     obrigaria a chamar setState de dentro dele, que é o que o React
     Compiler recusa, e criaria um caminho a mais entre a intenção do
     usuário e a requisição. */
  function abrir() {
    setAberto(true);
    void buscar(periodo);
  }

  function trocarPeriodo(novo: Periodo) {
    setPeriodo(novo);
    void buscar(novo);
  }

  const totais = dados?.campanhas.reduce(
    (acc, c) => ({
      gasto: acc.gasto + c.spendCents,
      resultados: acc.resultados + c.results,
    }),
    { gasto: 0, resultados: 0 },
  );

  /* Vinculadas MENOS as que apareceram na árvore. */
  const comEntrega = new Set(dados?.campanhas.map((c) => c.plataforma) ?? []);
  const paradas = (dados?.conectadas ?? []).filter((p) => !comEntrega.has(p));

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

      <Dialog open={aberto} onOpenChange={setAberto}>
        {/* `sm:max-w-*` e não `max-w-*`: o `DialogContent` já traz
            `sm:max-w-sm` embutido, e o tailwind-merge trata modificadores
            diferentes como propriedades diferentes — um `max-w-6xl` solto
            perde para ele acima de 640px, que foi o diálogo estreito com
            barra de rolagem horizontal. Mesma variante substitui.

            vw/vh em vez de largura fixa: acompanha a tela em vez de
            exigir arrasto no monitor pequeno. */}
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col overflow-hidden sm:max-w-[min(96vw,1400px)]">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {clientName}
              <Link
                href={`/clientes/${clientSlug}`}
                className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground transition-colors hover:text-foreground"
              >
                abrir conta
                <ArrowUpRight className="size-3" />
              </Link>
            </DialogTitle>
            <DialogDescription>
              Meta e Google na mesma árvore — campanha, conjunto e anúncio.
            </DialogDescription>
          </DialogHeader>

          {/* Período e resumo na MESMA linha: o total só significa algo
              ao lado do intervalo que o produziu. */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
            <PeriodPicker valor={periodo} onChange={trocarPeriodo} />

            {totais && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
                <span>
                  <span className="text-muted-foreground">Investido: </span>
                  <strong>{formatCurrency(totais.gasto)}</strong>
                </span>
                <span>
                  <span className="text-muted-foreground">{resultLabel}: </span>
                  <strong>{formatNumber(Math.round(totais.resultados))}</strong>
                </span>
                <span>
                  <span className="text-muted-foreground">{costLabel}: </span>
                  <strong>
                    {totais.resultados > 0
                      ? formatCurrency(
                          Math.round(totais.gasto / totais.resultados),
                        )
                      : "—"}
                  </strong>
                </span>
              </p>
            )}
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {/* Plataforma vinculada que não entregou NADA no período. Sem
                esta linha, a ausência do Google lê como defeito do
                sistema — foi exatamente o que aconteceu. */}
            {dados && !carregando && paradas.length > 0 && (
              <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-2xs text-muted-foreground">
                {paradas.map((p) => PLATAFORMA[p]).join(" e ")}{" "}
                {paradas.length === 1 ? "está vinculado" : "estão vinculados"} e
                não {paradas.length === 1 ? "teve" : "tiveram"} entrega neste
                período.
              </p>
            )}

            {carregando && <AdsManagerSkeleton />}

            {erro && !carregando && (
              <p className="rounded-xl bg-warning-muted px-4 py-3 text-sm text-warning">
                {erro}
              </p>
            )}

            {dados && dados.campanhas.length === 0 && !erro && !carregando && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma entrega neste período. Não é erro — a conta pode estar
                pausada.
              </p>
            )}

            {dados && dados.campanhas.length > 0 && !carregando && (
              <AdsManagerTable
                dados={dados.campanhas}
                resultLabel={resultLabel}
                costLabel={costLabel}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
