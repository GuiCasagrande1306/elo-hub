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
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const PRESETS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
] as const;

/** Últimos N dias terminando ONTEM, no fuso de São Paulo. */
function janela(dias: number): { since: string; until: string } {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  /* Termina ONTEM: o dia corrente ainda está veiculando e entraria como
     uma queda que não existe. Mesma regra de `lastNDays`. */
  const fim = new Date(`${hoje}T12:00:00-03:00`);
  fim.setUTCDate(fim.getUTCDate() - 1);
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(inicio), until: iso(fim) };
}

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
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<NoDaArvore[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(
    async (quantosDias: number) => {
      setCarregando(true);
      setErro(null);
      setDados(null);

      const { since, until } = janela(quantosDias);

      try {
        const r = await fetch(
          `/api/ads/structure?clientId=${clientId}&since=${since}&until=${until}`,
        );
        const j = (await r.json()) as {
          campanhas?: NoDaArvore[];
          error?: string;
        };
        if (j.error) setErro(j.error);
        else setDados(j.campanhas ?? []);
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
    void buscar(dias);
  }

  function trocarPeriodo(novosDias: number) {
    if (novosDias === dias) return;
    setDias(novosDias);
    void buscar(novosDias);
  }

  const totais = dados?.reduce(
    (acc, c) => ({
      gasto: acc.gasto + c.spendCents,
      resultados: acc.resultados + c.results,
    }),
    { gasto: 0, resultados: 0 },
  );

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
        {/* Largo de propósito: nove colunas não cabem em gaveta. */}
        <DialogContent className="max-h-[90vh] w-[96vw] max-w-6xl overflow-y-auto">
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
            <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.dias}
                  type="button"
                  onClick={() => trocarPeriodo(p.dias)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    dias === p.dias
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>

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

          <div className="mt-4">
            {carregando && <AdsManagerSkeleton />}

            {erro && !carregando && (
              <p className="rounded-xl bg-warning-muted px-4 py-3 text-sm text-warning">
                {erro}
              </p>
            )}

            {dados && dados.length === 0 && !erro && !carregando && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Nenhuma entrega neste período. Não é erro — a conta pode estar
                pausada.
              </p>
            )}

            {dados && dados.length > 0 && !carregando && (
              <AdsManagerTable
                dados={dados}
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
