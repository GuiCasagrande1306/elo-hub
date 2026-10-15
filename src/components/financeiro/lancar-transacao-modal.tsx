"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lancarTransacao } from "@/app/(app)/financeiro/actions";
import type { TransactionCategory } from "@/types/database";

const CATEGORIAS: { value: TransactionCategory; label: string }[] = [
  { value: "client_fee",  label: "Honorário de cliente" },
  { value: "project_fee", label: "Fee de projeto" },
  { value: "ad_spend",    label: "Verba de anúncios" },
  { value: "salary",      label: "Folha de pagamento" },
  { value: "contractor",  label: "Prestador / Freelancer" },
  { value: "software",    label: "Software / Assinatura" },
  { value: "office",      label: "Escritório / Infraestrutura" },
  { value: "tax",         label: "Impostos e taxas" },
  { value: "other",       label: "Outro" },
];

export function LancarTransacaoModal() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<"income" | "expense">("expense");
  const [categoria, setCategoria] = useState<TransactionCategory>("other");
  const [descricao, setDescricao] = useState("");
  const [banco, setBanco] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetar() {
    setTipo("expense");
    setCategoria("other");
    setDescricao("");
    setBanco("");
    setValor("");
    setData(new Date().toISOString().slice(0, 10));
    setErro(null);
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const result = await lancarTransacao({
        tipo,
        category: categoria,
        descricao: banco ? `${descricao} — ${banco}` : descricao,
        valorStr: valor,
        dataVencimento: data,
        dataPagamento: data,
        status: "paid",
      });
      if (!result.ok) {
        setErro(result.error ?? "Erro ao lançar.");
      } else {
        setAberto(false);
        resetar();
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) resetar(); }}>
      <DialogTrigger>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="size-3.5" />
          Lançar transação
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lançar transação manual</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTipo("income")}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                tipo === "income"
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-hairline text-muted-foreground hover:border-foreground/30"
              }`}
            >
              ↓ Entrada
            </button>
            <button
              type="button"
              onClick={() => setTipo("expense")}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                tipo === "expense"
                  ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : "border-hairline text-muted-foreground hover:border-foreground/30"
              }`}
            >
              ↑ Saída
            </button>
          </div>

          {/* Categoria */}
          <div className="grid gap-1.5">
            <Label>Categoria</Label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as TransactionCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Descrição */}
          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Ex: Pagamento de freelancer"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          {/* Banco */}
          <div className="grid gap-1.5">
            <Label>
              Banco / Origem{" "}
              <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              placeholder="Ex: Bradesco, Itaú, Caixa, Nubank…"
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
            />
          </div>

          {/* Valor e data lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Valor (R$)</Label>
              <Input
                placeholder="1.500,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>

          {erro && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setAberto(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={isPending || !descricao || !valor}>
            {isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
