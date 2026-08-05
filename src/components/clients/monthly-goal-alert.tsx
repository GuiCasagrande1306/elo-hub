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
  referenceMonth,
  /** Valores atuais, quando existe linha zerada para editar. */
  plannedBudget,
  plannedResults,
}: {
  clientId: string;
  referenceMonth: string;
  plannedBudget?: string;
  plannedResults?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [orcamento, setOrcamento] = useState(plannedBudget ?? "");
  const [resultados, setResultados] = useState(plannedResults ?? "");
  const [salvando, startTransition] = useTransition();

  const mes = nomeDoMes(referenceMonth);

  function salvar() {
    startTransition(async () => {
      const r = await setClientGoal({
        clientId,
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
              <Label htmlFor="meta-resultados">Meta de resultados</Label>
              <Input
                id="meta-resultados"
                inputMode="decimal"
                value={resultados}
                onChange={(e) => setResultados(e.target.value)}
                placeholder="120"
                className="mt-1.5 tabular-nums"
              />
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Quantas conversões o mês precisa entregar — pedidos, leads
                ou compras, conforme o segmento da conta.
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
