"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { salvarMetaDeGasto } from "@/app/(app)/financeiro/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ROTULO_DA_CATEGORIA,
  type MetaDaCategoria,
} from "@/lib/financeiro/categorias";

export function PainelDeMetas({
  mes,
  metas,
  rotuloDoMes,
  incomeCents,
}: {
  mes: string;
  metas: MetaDaCategoria[];
  rotuloDoMes: string;
  incomeCents: number;
}) {
  if (metas.length === 0) {
    return (
      <p className="surface-card p-5 text-sm text-muted-foreground">
        Não foi possível ler as metas agora. Recarregue a página; se
        persistir, a migration 90 pode não ter rodado neste ambiente.
      </p>
    );
  }

  return (
    <div className="surface-card divide-y divide-hairline overflow-hidden">
      {metas.map((meta) => (
        <LinhaDeMeta key={meta.category} mes={mes} meta={meta} rotuloDoMes={rotuloDoMes} incomeCents={incomeCents} />
      ))}
    </div>
  );
}

function LinhaDeMeta({
  mes,
  meta,
  rotuloDoMes,
  incomeCents,
}: {
  mes: string;
  meta: MetaDaCategoria;
  rotuloDoMes: string;
  incomeCents: number;
}) {
  const [modo, setModo] = useState<"fixed" | "percent">(
    meta.tipoMeta === "percent" ? "percent" : "fixed",
  );
  const [limite, setLimite] = useState(
    meta.tipoMeta === "fixed" && meta.limiteCents > 0
      ? (meta.limiteCents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  const [pct, setPct] = useState(
    meta.tipoMeta === "percent" && meta.percent !== null
      ? String(meta.percent)
      : "",
  );
  const [salvando, startTransition] = useTransition();

  const comprometido = meta.pagoCents + meta.previstoCents;
  const semLancamento = meta.lancamentos === 0;

  /* Limite efetivo para a barra: fixo ou calculado do % */
  const limiteEfetivo =
    modo === "percent" && pct
      ? Math.round(incomeCents * Number(pct.replace(",", ".")) / 100)
      : modo === "fixed" && limite
        ? (parseBRL(limite) ?? 0)
        : meta.limiteCents;

  const fatia =
    limiteEfetivo > 0 ? comprometido / limiteEfetivo : null;
  const estourou = fatia !== null && fatia > 1;

  function salvar() {
    startTransition(async () => {
      const r = await salvarMetaDeGasto({
        mes,
        category: meta.category,
        limite: modo === "fixed" ? limite : "",
        percent: modo === "percent" && pct ? Number(pct.replace(",", ".")) : null,
      });
      if (r.ok) {
        const rotulo = ROTULO_DA_CATEGORIA[meta.category];
        const vazio = (modo === "fixed" && limite.trim() === "") || (modo === "percent" && !pct);
        toast.success(vazio ? `${rotulo}: meta removida.` : `${rotulo}: meta salva.`);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {ROTULO_DA_CATEGORIA[meta.category] ?? meta.category}
        </p>

        {semLancamento ? (
          <p className="mt-1 text-2xs text-muted-foreground">
            Sem lançamento em {rotuloDoMes} — nada gasto ou nada anotado.
          </p>
        ) : (
          <>
            {fatia !== null && (
              <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full", estourou ? "bg-negative" : "bg-positive")}
                  style={{ width: `${Math.min(100, Math.round(fatia * 100))}%` }}
                />
              </div>
            )}
            <p className={cn("text-2xs text-muted-foreground", fatia !== null ? "mt-1.5" : "mt-1")}>
              {formatCurrency(meta.pagoCents)} pago
              {meta.previstoCents > 0 && <> · {formatCurrency(meta.previstoCents)} a vencer</>}
              {fatia !== null && (
                <span className={cn("ml-1.5 font-medium", estourou && "text-negative")}>
                  · {Math.round(fatia * 100)}% da meta
                </span>
              )}
              {!meta.temMeta && <> · sem meta definida</>}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Toggle R$ / % */}
        <div className="flex overflow-hidden rounded-md border border-input text-xs">
          <button
            type="button"
            onClick={() => setModo("fixed")}
            className={cn(
              "px-2.5 py-1.5 transition-colors",
              modo === "fixed" ? "bg-surface-2 font-medium" : "text-muted-foreground hover:bg-surface-2/50",
            )}
          >
            R$
          </button>
          <button
            type="button"
            onClick={() => setModo("percent")}
            className={cn(
              "border-l border-input px-2.5 py-1.5 transition-colors",
              modo === "percent" ? "bg-surface-2 font-medium" : "text-muted-foreground hover:bg-surface-2/50",
            )}
          >
            %
          </button>
        </div>

        {modo === "fixed" ? (
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
              R$
            </span>
            <Input
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              placeholder="sem meta"
              inputMode="decimal"
              aria-label={`Meta fixa de ${ROTULO_DA_CATEGORIA[meta.category]}`}
              className="w-36 pl-8 text-right tabular-nums"
            />
          </div>
        ) : (
          <div className="relative">
            <Input
              value={pct}
              onChange={(e) => setPct(e.target.value.replace(/[^0-9,.]/, ""))}
              placeholder="0"
              inputMode="decimal"
              aria-label={`Meta percentual de ${ROTULO_DA_CATEGORIA[meta.category]}`}
              className="w-24 pr-7 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
              %
            </span>
          </div>
        )}

        <Button size="sm" variant="outline" onClick={salvar} disabled={salvando}>
          {salvando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Salvar
        </Button>
      </div>

      {/* Estimativa em reais quando modo = % */}
      {modo === "percent" && pct && incomeCents > 0 && (
        <p className="w-full text-2xs text-muted-foreground">
          {pct}% de {formatCurrency(incomeCents)} faturado ={" "}
          <span className="font-medium text-foreground">
            {formatCurrency(Math.round(incomeCents * Number(pct.replace(",", ".")) / 100))}
          </span>
        </p>
      )}
      {modo === "percent" && pct && incomeCents === 0 && (
        <p className="w-full text-2xs text-muted-foreground">
          Sem receita registrada em {rotuloDoMes} — o valor em reais aparece quando entrar uma receita.
        </p>
      )}
    </div>
  );
}

function parseBRL(s: string): number | null {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
