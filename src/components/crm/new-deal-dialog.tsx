"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarNegocio } from "@/app/(app)/comercial/actions";
import { ORIGEM_LABEL, ORIGENS } from "@/lib/crm/stages";
import { parseCurrencyToCents } from "@/lib/format";
import type { DealOrigem, Profile } from "@/types/database";

/**
 * Cadastro de negócio.
 *
 * DELIBERADAMENTE CURTO. A tentação é pedir tudo de uma vez — valor,
 * previsão, próximo passo, nicho — e o resultado é que ninguém cadastra
 * o lead que acabou de ligar, porque não sabe metade das respostas. Aqui
 * só o nome é obrigatório; o resto se preenche na ficha, quando a
 * informação existir.
 *
 * O negócio nasce sempre em "Novo lead": a etapa é consequência do que
 * já aconteceu, e no instante do cadastro nada aconteceu ainda.
 */
export function NewDealDialog({
  team,
  open,
  onOpenChange,
  onCriado,
}: {
  team: Profile[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: (dealId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [contato, setContato] = useState("");
  const [telefone, setTelefone] = useState("");
  const [origem, setOrigem] = useState<DealOrigem>("indicacao");
  const [mensalidade, setMensalidade] = useState("");
  const [dono, setDono] = useState<string>("__ninguem__");
  const [salvando, iniciar] = useTransition();

  function limpar() {
    setTitle("");
    setCompany("");
    setContato("");
    setTelefone("");
    setOrigem("indicacao");
    setMensalidade("");
    setDono("__ninguem__");
  }

  function salvar() {
    const nome = title.trim();
    if (!nome) return;

    iniciar(async () => {
      const r = await criarNegocio({
        title: nome,
        company: company.trim() || null,
        contactName: contato.trim() || null,
        contactPhone: telefone.trim() || null,
        contactEmail: null,
        origem,
        monthlyFeeCents: parseCurrencyToCents(mensalidade) ?? 0,
        setupFeeCents: 0,
        ownerId: dono === "__ninguem__" ? null : dono,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      limpar();
      onCriado(r.dealId);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[94vw] sm:max-w-[min(94vw,520px)]">
        <DialogTitle>Novo negócio</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Só o nome é obrigatório. O resto entra depois, na ficha.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Campo label="Nome do negócio">
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Pizzaria Dom Léo — gestão de tráfego"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) salvar();
              }}
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Empresa">
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Opcional"
              />
            </Campo>

            <Campo label="Origem">
              <Select value={origem} onValueChange={(v) => setOrigem(v as DealOrigem)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => ORIGEM_LABEL[v as DealOrigem] ?? "Origem"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>

            <Campo label="Contato">
              <Input
                value={contato}
                onChange={(e) => setContato(e.target.value)}
                placeholder="Nome de quem fala"
              />
            </Campo>

            <Campo label="Telefone">
              <Input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(48) 9…"
              />
            </Campo>

            <Campo label="Mensalidade">
              <Input
                value={mensalidade}
                onChange={(e) => setMensalidade(e.target.value)}
                placeholder="R$ 0,00"
                inputMode="decimal"
                className="tabular-nums"
              />
            </Campo>

            <Campo label="Responsável">
              <Select value={dono} onValueChange={(v) => setDono(v ?? "__ninguem__")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === "__ninguem__"
                        ? "Ninguém"
                        : (team.find((p) => p.id === v)?.full_name ?? "Ninguém")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ninguem__">Ninguém</SelectItem>
                  {team.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!title.trim() || salvando} onClick={salvar}>
            Criar negócio
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
