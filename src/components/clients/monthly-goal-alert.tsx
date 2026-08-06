"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setClientGoal } from "@/app/(app)/clientes/actions";
import { nomeDoMes } from "@/lib/date-br";
import { defaultGoalMetricFor } from "@/lib/metrics/goal-metric";
import { cn } from "@/lib/utils";
import type { ClientSegment } from "@/types/database";

/* =====================================================================
   Meta do mês ainda não definida
   ---------------------------------------------------------------------
   A meta é por período, e todo dia 1º a do mês anterior deixa de valer.
   Sem aviso, a conta roda o mês inteiro comparando execução contra uma
   meta zerada — e o card mostra "0% da meta" o tempo todo, que se lê
   como desempenho ruim e não como campo em branco.

   O alerta some sozinho no instante em que a meta é preenchida: é
   pendência, não decoração permanente.
   ===================================================================== */

export function MonthlyGoalAlert({
  clientId,
  segment,
  referenceMonth,
  /** Valores atuais, quando existe linha zerada para editar. */
  plannedBudget,
  plannedResults,
}: {
  clientId: string;
  segment: ClientSegment;
  referenceMonth: string;
  plannedBudget?: string;
  plannedResults?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [orcamento, setOrcamento] = useState(plannedBudget ?? "");
  const [resultados, setResultados] = useState(plannedResults ?? "");
  const [salvando, startTransition] = useTransition();

  const mes = nomeDoMes(referenceMonth);

  /* Meta NOVA: a unidade é a do segmento. Não existe linha gravada com
     unidade própria para respeitar — este alerta só aparece quando a
     meta está em branco. */
  const metrica = defaultGoalMetricFor(segment);

  function salvar() {
    startTransition(async () => {
      const r = await setClientGoal({
        clientId,
        segment,
        plannedBudget: orcamento,
        plannedResults: resultados,
      });

      if (r.ok) {
        toast.success(`Meta de ${mes} definida.`);
        setAberto(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <div
        role="status"
        className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning-muted/40 px-4 py-3"
      >
        <Target className="size-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">
            A meta de {mes} ainda não foi definida.
          </span>{" "}
          <span className="text-muted-foreground">
            Sem ela o painel compara o mês contra zero.
          </span>
        </p>
        <Button size="sm" onClick={() => setAberto(true)}>
          Definir meta
        </Button>
      </div>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Meta de {mes}</DialogTitle>
            <DialogDescription>
              Vira a barra de planejado versus executado no card da conta.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            <div>
              <Label htmlFor="meta-orcamento">Orçamento planejado</Label>
              <Input
                id="meta-orcamento"
                inputMode="decimal"
                value={orcamento}
                onChange={(e) => setOrcamento(e.target.value)}
                placeholder="4.000,00"
                className="mt-1.5 tabular-nums"
              />
            </div>

            <div>
              <Label htmlFor="meta-resultados">{metrica.inputLabel}</Label>
              {/* Prefixo "R$" só quando a meta É dinheiro: um campo de
                  contagem com cifrão convida a digitar valor de venda
                  onde se espera quantidade. */}
              <div className="relative mt-1.5">
                {metrica.isCurrency && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    R$
                  </span>
                )}
                <Input
                  id="meta-resultados"
                  inputMode="decimal"
                  value={resultados}
                  onChange={(e) => setResultados(e.target.value)}
                  placeholder={metrica.placeholder}
                  className={cn("tabular-nums", metrica.isCurrency && "pl-9")}
                />
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                {metrica.hint}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAberto(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="size-4 animate-spin" />}
              Salvar meta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
