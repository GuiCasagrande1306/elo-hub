"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { lancarTransacao } from "@/app/(app)/financeiro/actions";
import { ROTULO_DA_CATEGORIA } from "@/lib/financeiro/categorias";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { TransactionCategory } from "@/types/database";

const CATEGORIAS_RECEITA: TransactionCategory[] = ["client_fee", "project_fee"];
const CATEGORIAS_DESPESA: TransactionCategory[] = [
  "ad_spend", "salary", "contractor", "software", "office", "tax", "other",
];

const hoje = () => new Date().toISOString().slice(0, 10);

export function LancarTransacaoSheet() {
  const [aberto, setAberto] = useState(false);
  const [pending, startTransition] = useTransition();

  const [tipo, setTipo] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState<TransactionCategory>("other");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dataVenc, setDataVenc] = useState(hoje());
  const [dataPag, setDataPag] = useState(hoje());
  const [status, setStatus] = useState<"paid" | "pending">("paid");

  const categorias = tipo === "income" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;

  function aoTrocarTipo(novo: "income" | "expense") {
    setTipo(novo);
    setCategory(novo === "income" ? "client_fee" : "other");
  }

  function salvar() {
    startTransition(async () => {
      const r = await lancarTransacao({
        tipo,
        category,
        descricao,
        valorStr: valor,
        dataVencimento: dataVenc,
        dataPagamento: status === "paid" ? dataPag : null,
        status,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success("Lançamento registrado.");
      setAberto(false);
      setDescricao("");
      setValor("");
      setDataVenc(hoje());
      setDataPag(hoje());
      setStatus("paid");
      setTipo("expense");
      setCategory("other");
    });
  }

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger render={
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" />
          Lançar
        </Button>
      } />

      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle>Lançar transação</SheetTitle>

        <div className="mt-6 flex flex-col gap-4">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={tipo === "expense" ? "default" : "outline"}
              onClick={() => aoTrocarTipo("expense")}
            >
              Saída
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tipo === "income" ? "default" : "outline"}
              onClick={() => aoTrocarTipo("income")}
            >
              Entrada
            </Button>
          </div>

          {/* Categoria */}
          <div className="grid gap-1.5">
            <Label>Categoria</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as TransactionCategory)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => ROTULO_DA_CATEGORIA[v] ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categorias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ROTULO_DA_CATEGORIA[c] ?? c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Descrição */}
          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Input
              placeholder="Equipamento de escritório"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          {/* Valor */}
          <div className="grid gap-1.5">
            <Label>Valor (R$)</Label>
            <Input
              placeholder="1.500,00"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>

          {/* Status */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={status === "paid" ? "default" : "outline"}
              onClick={() => setStatus("paid")}
            >
              Pago
            </Button>
            <Button
              type="button"
              size="sm"
              variant={status === "pending" ? "default" : "outline"}
              onClick={() => setStatus("pending")}
            >
              Pendente
            </Button>
          </div>

          {/* Datas */}
          <div className="grid gap-1.5">
            <Label>{status === "paid" ? "Data de pagamento" : "Data de vencimento"}</Label>
            <Input
              type="date"
              value={status === "paid" ? dataPag : dataVenc}
              onChange={(e) =>
                status === "paid"
                  ? setDataPag(e.target.value)
                  : setDataVenc(e.target.value)
              }
            />
          </div>

          <Button
            onClick={salvar}
            disabled={pending || !descricao.trim() || !valor.trim()}
            className="mt-2"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {pending ? "Salvando…" : "Registrar lançamento"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
