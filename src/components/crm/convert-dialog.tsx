"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { converterEmCliente } from "@/app/(app)/comercial/actions";
import { formatCurrency } from "@/lib/format";
import type { ClientSegment, DealWithRelations } from "@/types/database";

/**
 * Negócio ganho → conta na carteira.
 *
 * PERGUNTA EXATAMENTE DUAS COISAS, e não é preguiça de formulário: nicho
 * e agência são os dois campos que o funil não tem como saber e que
 * custam caro se forem chutados.
 *
 *   • o NICHO decide a unidade da meta (faturamento para loja, contagem
 *     para lead) e o rótulo de conversão do relatório. Errado, a meta
 *     entra 100× fora e o card acusa 0,02% de execução o mês inteiro;
 *   • a AGÊNCIA decide quem assina o relatório e quem fatura a conta.
 *     Errada, o documento do cliente sai com a marca de outra empresa.
 *
 * O resto — nome, contato, WhatsApp — vem do negócio, porque já foi
 * digitado uma vez e redigitar é onde o erro entra.
 */

const NICHOS: { id: ClientSegment; label: string; nota: string }[] = [
  { id: "ecommerce", label: "E-commerce", nota: "meta em faturamento" },
  { id: "delivery", label: "Delivery", nota: "meta em pedidos" },
  { id: "leads", label: "Geração de leads", nota: "meta em leads" },
  { id: "local_business", label: "Negócio local", nota: "meta em contatos" },
];

export function ConvertDialog({
  deal,
  agencias,
  open,
  onOpenChange,
}: {
  deal: DealWithRelations | null;
  agencias: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [segment, setSegment] = useState<ClientSegment>("local_business");
  const [agencia, setAgencia] = useState<string>(agencias[0] ?? "");
  const [salvando, iniciar] = useTransition();

  if (!deal) return null;

  function converter() {
    if (!deal || !agencia) return;

    iniciar(async () => {
      const r = await converterEmCliente({
        dealId: deal.id,
        segment,
        agencyPartner: agencia,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success("Cliente criado em onboarding.");
      onOpenChange(false);
      router.push(`/clientes/${r.slug}`);
    });
  }

  const nome = deal.company?.trim() || deal.title;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[94vw] sm:max-w-[min(94vw,480px)]">
        <DialogTitle>Criar cliente</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          A conta nasce em <strong>onboarding</strong>, não ativa: entre
          ganhar e operar existe contrato, acesso e conta de anúncios.
        </p>

        <dl className="mt-4 rounded-lg bg-surface-2 p-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Nome da conta</dt>
            <dd className="truncate font-medium">{nome}</dd>
          </div>
          {deal.contact_name && (
            <div className="mt-1.5 flex justify-between gap-3">
              <dt className="text-muted-foreground">Contato</dt>
              <dd className="truncate">{deal.contact_name}</dd>
            </div>
          )}
          {deal.monthly_fee_cents > 0 && (
            <div className="mt-1.5 flex justify-between gap-3">
              <dt className="text-muted-foreground">Mensalidade</dt>
              <dd className="tabular-nums">
                {formatCurrency(deal.monthly_fee_cents)}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Nicho
            </span>
            <Select
              value={segment}
              onValueChange={(v) => setSegment(v as ClientSegment)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    NICHOS.find((n) => n.id === v)?.label ?? "Selecione"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {NICHOS.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} — {n.nota}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Agência que atende
            </span>
            <Select value={agencia} onValueChange={(v) => setAgencia(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v || "Selecione"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agencias.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!agencia || salvando} onClick={converter}>
            Criar cliente
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
