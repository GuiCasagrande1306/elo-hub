"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WhatsAppDestinationPicker } from "./whatsapp-destination-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateClientSettings } from "@/app/(app)/clientes/actions";
import { CLIENT_SEGMENTS, SEGMENT_LABELS } from "@/lib/validation/client";
import type { Client, ClientSegment } from "@/types/database";

/* =====================================================================
   Ajustes do cliente
   ---------------------------------------------------------------------
   Só o que muda o que o cliente RECEBE. Nome e slug ficam de fora: eles
   aparecem em URL e em PDF já entregue, e trocá-los quebra referência.

   O nicho é o campo mais consequente da tela — é ele que escolhe o
   template, e portanto se o relatório vai falar de "Vendas", "Pedidos",
   "Leads" ou "Contatos". Por isso vem primeiro e com a explicação
   junto, em vez de ser um dropdown solto.
   ===================================================================== */

export function ClientSettingsCard({ client }: { client: Client }) {
  const [segment, setSegment] = useState<ClientSegment>(client.segment);
  const [whatsapp, setWhatsapp] = useState(client.whatsapp_phone ?? "");
  const [enabled, setEnabled] = useState(client.report_enabled);
  const [day, setDay] = useState<string>(
    client.report_day ? String(client.report_day) : "",
  );
  const [pendente, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const r = await updateClientSettings({
        clientId: client.id,
        segment,
        whatsappPhone: whatsapp,
        reportEnabled: enabled,
        reportDay: day ? Number(day) : null,
      });

      if (r.ok) toast.success("Ajustes salvos.");
      else toast.error(r.error);
    });
  }

  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold">Ajustes do relatório</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Definem o que este cliente recebe e quando.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="segmento">Nicho</Label>
          <Select
            value={segment}
            onValueChange={(v) => setSegment(v as ClientSegment)}
          >
            <SelectTrigger id="segmento" className="mt-1.5 w-full">
              {/* Sem a função de render, o Base UI mostra o valor cru
                  ("local_business") em vez do rótulo. */}
              <SelectValue>
                {(v) => SEGMENT_LABELS[v as ClientSegment] ?? "Selecione"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CLIENT_SEGMENTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Escolhe o template do PDF e como o resultado é chamado.
          </p>
        </div>

        <div>
          <Label htmlFor="whatsapp">WhatsApp de destino</Label>
          <div className="mt-1.5">
            <WhatsAppDestinationPicker value={whatsapp} onChange={setWhatsapp} />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Escolha o grupo pelo nome — o ID é gravado automaticamente.
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-hairline pt-5">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="text-sm font-medium">
              Preparar relatório automaticamente
            </span>
            <span className="mt-0.5 block text-2xs text-muted-foreground">
              O robô gera o PDF no dia escolhido. O envio continua manual —
              alguém confere e dispara pelo próprio WhatsApp.
            </span>
          </span>
        </label>

        {enabled && (
          <div className="mt-4 max-w-[200px]">
            <Label htmlFor="dia">Dia do mês</Label>
            <Input
              id="dia"
              type="number"
              min={1}
              max={28}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-2xs text-muted-foreground">
              De 1 a 28 — fevereiro não tem dia 30, e um cliente agendado
              nele nunca receberia nada.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end border-t border-hairline pt-4">
        <Button size="sm" onClick={salvar} disabled={pendente}>
          {pendente ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </section>
  );
}
