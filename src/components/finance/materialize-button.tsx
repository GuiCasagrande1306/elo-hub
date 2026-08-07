"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";

import { gerarLancamentosDoMes } from "@/app/(app)/gestao/recorrencia/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import type { ResultadoMaterializacao } from "@/lib/finance/recurrence";

/* =====================================================================
   Emissão manual dos lançamentos do mês
   ---------------------------------------------------------------------
   O cron faz isso sozinho todo dia. Este botão existe por dois motivos
   concretos: o primeiro mês (o cron só roda amanhã) e a antecipação do
   mês seguinte, quando alguém quer ver a previsão antes de virar.

   Clicar duas vezes é INOFENSIVO — `recurrence_key` é única no banco, e
   a segunda passada devolve "já existiam". O relatório abaixo do botão
   mostra essa contagem justamente para tornar isso visível em vez de
   pedir confiança.
   ===================================================================== */

export function MaterializeButton({
  meses,
}: {
  /** `[{ valor: "2026-08", rotulo: "agosto de 2026" }, …]` */
  meses: { valor: string; rotulo: string }[];
}) {
  const [mes, setMes] = useState(meses[0]?.valor ?? "");
  const [resultado, setResultado] = useState<ResultadoMaterializacao | null>(
    null,
  );
  const [rodando, setRodando] = useState(false);
  const [, startTransition] = useTransition();

  function gerar() {
    setRodando(true);
    setResultado(null);

    startTransition(async () => {
      const r = await gerarLancamentosDoMes(mes);
      setRodando(false);

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setResultado(r.dados);

      toast.success(
        r.dados.criadas > 0
          ? `${r.dados.criadas} lançamento${r.dados.criadas === 1 ? "" : "s"} gerado${r.dados.criadas === 1 ? "" : "s"}.`
          : "Nada a gerar: o mês já estava emitido.",
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={mes} onValueChange={(v) => setMes(v ?? mes)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Mês">
            <SelectValue>
              {(v: string) =>
                meses.find((m) => m.valor === v)?.rotulo ?? "Escolher mês"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {meses.map((m) => (
              <SelectItem key={m.valor} value={m.valor}>
                {m.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" className="h-9" disabled={rodando} onClick={gerar}>
          <CalendarPlus className="size-4" />
          {rodando ? "Gerando…" : "Gerar lançamentos"}
        </Button>
      </div>

      {resultado && (
        <div className="rounded-xl bg-surface-2/60 px-4 py-3 text-sm">
          <p className="font-medium tabular-nums">
            {resultado.criadas} criado{resultado.criadas === 1 ? "" : "s"}
            {resultado.jaExistiam > 0 && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {resultado.jaExistiam} já existia
                {resultado.jaExistiam === 1 ? "" : "m"}
              </span>
            )}
          </p>

          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {formatCurrency(resultado.entradasCents)} a receber ·{" "}
            {formatCurrency(resultado.saidasCents)} a pagar
          </p>

          {/* Quem ficou de fora aparece NOMEADO. Um resumo que diz só
              "38 gerados" com 46 clientes na carteira esconde os 8 que
              não vão ser faturados este mês. */}
          {resultado.pulados.length > 0 && (
            <div className="mt-2.5 border-t border-hairline pt-2.5">
              <p className="text-xs font-medium text-warning">
                {resultado.pulados.length} fora do faturamento
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {resultado.pulados.map((p) => (
                  <li key={p.quem} className="text-xs text-muted-foreground">
                    {p.quem} — {p.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
