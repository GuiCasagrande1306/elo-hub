"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setReportMetrics } from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  CATALOGO_DE_METRICAS,
  type MetricasDoRelatorio,
  type PlataformaDoRelatorio,
} from "@/lib/reports/metricas-do-relatorio";

/* =====================================================================
   Cartões do relatório, por cliente
   ---------------------------------------------------------------------
   Automático é a regra de sempre (aparece o que teve número). Escolher
   fixa a lista — inclusive com zero. Ver `metricas-do-relatorio.ts`.
   ===================================================================== */

const NOME: Record<PlataformaDoRelatorio, string> = { meta_ads: "Meta Ads", google_ads: "Google Ads" };

/* Ponto de partida ao trocar para "Escolher": o quadro de mídia comum,
   sem CPM nem faturamento, que nem todo cliente usa. */
const INICIAL = ["spend", "impressions", "clicks", "ctr", "cpc", "results", "cpa"];

export function MetricasDoRelatorioEditor({
  clientId,
  valor,
  plataformas,
}: {
  clientId: string;
  valor: MetricasDoRelatorio | null;
  plataformas: PlataformaDoRelatorio[];
}) {
  if (plataformas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Vincule uma conta de mídia para escolher as métricas do relatório.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Os cartões de cada plataforma no relatório. No automático aparece o que teve
        número no período; escolhendo, aparece exatamente a lista marcada, mesmo zerada.
      </p>
      {plataformas.map((p) => (
        <Plataforma key={p} clientId={clientId} plataforma={p} salvo={valor?.[p] ?? null} />
      ))}
    </div>
  );
}

function Plataforma({
  clientId,
  plataforma,
  salvo,
}: {
  clientId: string;
  plataforma: PlataformaDoRelatorio;
  salvo: string[] | null;
}) {
  const router = useRouter();
  const [escolher, setEscolher] = useState(salvo !== null);
  const [marcadas, setMarcadas] = useState<string[]>(salvo ?? INICIAL);
  const [salvando, iniciar] = useTransition();

  const mudou =
    escolher !== (salvo !== null) ||
    (escolher && [...marcadas].sort().join() !== [...(salvo ?? [])].sort().join());

  function alternar(key: string, marcado: boolean) {
    setMarcadas((atual) => (marcado ? [...atual, key] : atual.filter((k) => k !== key)));
  }

  function salvar() {
    iniciar(async () => {
      const r = await setReportMetrics({
        clientId,
        platform: plataforma,
        metricas: escolher ? marcadas : null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Métricas do ${NOME[plataforma]} salvas.`);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-hairline p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{NOME[plataforma]}</h3>
        <div className="flex overflow-hidden rounded-lg border border-hairline">
          {[
            { v: false, rotulo: "Automático" },
            { v: true, rotulo: "Escolher" },
          ].map((o, i) => (
            <button
              key={o.rotulo}
              type="button"
              onClick={() => setEscolher(o.v)}
              disabled={salvando}
              aria-pressed={escolher === o.v}
              className={cn(
                "px-3 py-1 text-xs transition-colors disabled:opacity-60",
                i > 0 && "border-l border-hairline",
                escolher === o.v
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>

      {escolher && (
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {CATALOGO_DE_METRICAS[plataforma].map((m) => (
            <label key={m.key} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={marcadas.includes(m.key)}
                disabled={salvando}
                onCheckedChange={(c) => alternar(m.key, c === true)}
              />
              {m.label}
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={salvar} disabled={salvando || !mudou || (escolher && marcadas.length === 0)}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </section>
  );
}
