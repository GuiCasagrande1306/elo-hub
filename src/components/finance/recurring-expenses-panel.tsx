"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  alternarDespesa,
  salvarDespesa,
} from "@/app/(app)/gestao/recorrencia/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CATEGORY_LABELS } from "@/lib/finance/kpi";
import { formatCurrency, parseCurrencyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RecurringExpense, TransactionCategory } from "@/types/database";

/* =====================================================================
   Despesas recorrentes — a metade de SAÍDA da planilha
   ---------------------------------------------------------------------
   Poucas linhas e alteradas raramente (folha muda quando alguém entra,
   assinatura quando se troca de ferramenta), então aqui o diálogo é o
   formato certo — o oposto da tabela de contratos, que precisa aguentar
   46 edições seguidas.
   ===================================================================== */

const CATEGORIAS: TransactionCategory[] = [
  "salary",
  "contractor",
  "software",
  "office",
  "tax",
  "ad_spend",
  "other",
];

export function RecurringExpensesPanel({
  expenses,
}: {
  expenses: RecurringExpense[];
}) {
  const [editando, setEditando] = useState<RecurringExpense | "nova" | null>(
    null,
  );
  const [alternando, setAlternando] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const ativas = expenses.filter((d) => d.is_active);
  const totalMes = ativas.reduce((acc, d) => acc + d.amount_cents, 0);

  function alternar(despesa: RecurringExpense) {
    setAlternando(despesa.id);
    startTransition(async () => {
      const r = await alternarDespesa(despesa.id, !despesa.is_active);
      setAlternando(null);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(
          despesa.is_active
            ? `${despesa.description} sai do próximo mês.`
            : `${despesa.description} volta ao próximo mês.`,
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs tabular-nums text-muted-foreground">
          {ativas.length} ativa{ativas.length === 1 ? "" : "s"} ·{" "}
          {formatCurrency(totalMes)} por mês
        </span>

        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8"
          onClick={() => setEditando("nova")}
        >
          <Plus className="size-4" />
          Nova despesa
        </Button>
      </div>

      <div className="surface-card overflow-hidden">
        {expenses.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            Nenhuma despesa recorrente cadastrada.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {expenses.map((despesa) => (
              <li
                key={despesa.id}
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1fr_120px_64px_110px_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      !despesa.is_active && "text-muted-foreground line-through",
                    )}
                  >
                    {despesa.description}
                  </p>
                  <p className="mt-0.5 text-2xs text-muted-foreground sm:hidden">
                    {CATEGORY_LABELS[despesa.category]} · dia{" "}
                    {despesa.billing_day} · {formatCurrency(despesa.amount_cents)}
                  </p>
                </div>

                <span className="hidden text-xs text-muted-foreground sm:block">
                  {CATEGORY_LABELS[despesa.category]}
                </span>

                <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                  dia {despesa.billing_day}
                </span>

                <span
                  className={cn(
                    "hidden text-sm font-medium tabular-nums sm:block sm:text-right",
                    !despesa.is_active && "text-muted-foreground",
                  )}
                >
                  {formatCurrency(despesa.amount_cents)}
                </span>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-8 p-0"
                    onClick={() => setEditando(despesa)}
                    aria-label={`Editar ${despesa.description}`}
                  >
                    <Pencil className="size-3.5" />
                  </Button>

                  <Switch
                    checked={despesa.is_active}
                    disabled={alternando === despesa.id}
                    onCheckedChange={() => alternar(despesa)}
                    aria-label={
                      despesa.is_active
                        ? `Desligar ${despesa.description}`
                        : `Religar ${despesa.description}`
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FormularioDespesa
        alvo={editando}
        onClose={() => setEditando(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FormularioDespesa({
  alvo,
  onClose,
}: {
  alvo: RecurringExpense | "nova" | null;
  onClose: () => void;
}) {
  const existente = alvo && alvo !== "nova" ? alvo : null;

  return (
    <Dialog open={alvo !== null} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* `key` remonta o corpo ao trocar de despesa: sem isso o
            formulário guardaria o estado da anterior. Mesmo padrão do
            diálogo de tarefas. */}
        {alvo !== null && (
          <CorpoFormulario
            key={existente?.id ?? "nova"}
            despesa={existente}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorpoFormulario({
  despesa,
  onClose,
}: {
  despesa: RecurringExpense | null;
  onClose: () => void;
}) {
  const [descricao, setDescricao] = useState(despesa?.description ?? "");
  const [categoria, setCategoria] = useState<TransactionCategory>(
    despesa?.category ?? "other",
  );
  const [valor, setValor] = useState(
    despesa ? formatCurrency(despesa.amount_cents) : "",
  );
  const [dia, setDia] = useState(
    despesa ? String(despesa.billing_day) : "",
  );
  const [salvando, setSalvando] = useState(false);
  const [, startTransition] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();

    const cents = parseCurrencyToCents(valor);
    if (cents === null || cents <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }

    const diaNum = Number(dia.trim());
    if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 28) {
      toast.error("O dia precisa estar entre 1 e 28.");
      return;
    }

    if (descricao.trim().length < 2) {
      toast.error("Descreva a despesa.");
      return;
    }

    setSalvando(true);

    startTransition(async () => {
      const r = await salvarDespesa({
        id: despesa?.id,
        description: descricao,
        category: categoria,
        amountCents: cents,
        billingDay: diaNum,
      });

      setSalvando(false);

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success(despesa ? "Despesa atualizada." : "Despesa cadastrada.");
      onClose();
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>
          {despesa ? "Editar despesa" : "Nova despesa recorrente"}
        </DialogTitle>
        <DialogDescription>
          Vira um lançamento previsto por mês, com este vencimento.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="despesa-descricao">Descrição</Label>
          <Input
            id="despesa-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Folha de pagamento"
            maxLength={120}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="despesa-categoria">Categoria</Label>
          <Select
            value={categoria}
            onValueChange={(v) => setCategoria(v as TransactionCategory)}
          >
            <SelectTrigger id="despesa-categoria" className="w-full">
              <SelectValue>
                {(v: string) => CATEGORY_LABELS[v as TransactionCategory]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="despesa-valor">Valor mensal</Label>
            <Input
              id="despesa-valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="R$ 0,00"
              inputMode="decimal"
              className="tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="despesa-dia">Dia do vencimento</Label>
            <Input
              id="despesa-dia"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              placeholder="5"
              inputMode="numeric"
              maxLength={2}
              className="tabular-nums"
            />
            {/* O limite não é arbitrário e o usuário precisa saber por
                quê antes de tentar 30 e ser recusado. */}
            <p className="text-2xs text-muted-foreground">
              1 a 28 — fevereiro precisa caber.
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
