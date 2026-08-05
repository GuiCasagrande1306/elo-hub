"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";

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
import { setClientGoal, setClientLogo, updateClientSettings } from "@/app/(app)/clientes/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CLIENT_SEGMENTS,
  OPTIMIZATION_DAYS,
  SEGMENT_LABELS,
} from "@/lib/validation/client";
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

export function ClientSettingsCard({
  client,
  goal,
}: {
  client: Client;
  goal: { plannedBudgetCents: number; plannedResults: number } | null;
}) {
  const [segment, setSegment] = useState<ClientSegment>(client.segment);
  const [whatsapp, setWhatsapp] = useState(client.whatsapp_phone ?? "");
  const [enabled, setEnabled] = useState(client.report_enabled);
  const [day, setDay] = useState<string>(
    client.report_day ? String(client.report_day) : "",
  );
  const [diaEsteira, setDiaEsteira] = useState<string>(
    client.optimization_day ? String(client.optimization_day) : "",
  );
  const [pendente, startTransition] = useTransition();

  const [orcamento, setOrcamento] = useState(
    goal ? (goal.plannedBudgetCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [metaResultados, setMetaResultados] = useState(
    goal ? String(goal.plannedResults) : "",
  );
  const [salvandoMeta, startMeta] = useTransition();

  const [logo, setLogo] = useState(client.logo_url);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function enviarLogo(arquivo: File) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      toast.error("Modo demo: upload indisponível.");
      return;
    }

    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("A imagem precisa ter no máximo 5MB.");
      return;
    }

    setEnviandoLogo(true);
    try {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "png";
      /* Caminho começa pelo id do CLIENTE: é o que a policy do bucket
         usa para autorizar. E leva timestamp porque não há policy de
         UPDATE — sobrescrever seria recusado, e o nome novo também
         escapa do cache do navegador. */
      const caminho = `${client.id}/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("brand")
        .upload(caminho, arquivo);

      if (error) {
        toast.error(`Erro ao enviar: ${error.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("brand").getPublicUrl(caminho);

      const r = await setClientLogo({ clientId: client.id, logoUrl: publicUrl });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setLogo(publicUrl);
      toast.success("Logo atualizada.");
    } finally {
      setEnviandoLogo(false);
    }
  }

  function removerLogo() {
    startTransition(async () => {
      const r = await setClientLogo({ clientId: client.id, logoUrl: null });
      if (r.ok) {
        setLogo(null);
        toast.success("Logo removida.");
      } else {
        toast.error(r.error);
      }
    });
  }

  function salvarMeta() {
    startMeta(async () => {
      const r = await setClientGoal({
        clientId: client.id,
        plannedBudget: orcamento,
        plannedResults: metaResultados,
      });
      if (r.ok) toast.success("Meta do mês salva.");
      else toast.error(r.error);
    });
  }

  function salvar() {
    startTransition(async () => {
      const r = await updateClientSettings({
        clientId: client.id,
        segment,
        whatsappPhone: whatsapp,
        reportEnabled: enabled,
        reportDay: day ? Number(day) : null,
        optimizationDay: diaEsteira ? Number(diaEsteira) : null,
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

      {/* Logo ------------------------------------------------------
          Aparece no card da listagem, no cabeçalho da conta e na capa
          do PDF — que já lia `logo_url` e nunca teve como recebê-la. */}
      <div className="mt-5 flex items-center gap-4 border-b border-hairline pb-5">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-black/10">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável.
            <img src={logo} alt="" className="size-full object-contain p-1.5" />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground/50" />
          )}
        </span>

        <div>
          <input
            ref={arquivoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarLogo(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={enviandoLogo}
              onClick={() => arquivoRef.current?.click()}
            >
              {enviandoLogo ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {logo ? "Trocar logo" : "Enviar logo"}
            </Button>

            {logo && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={removerLogo}
                disabled={pendente}
              >
                <Trash2 className="size-3.5" />
                Remover
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            PNG, JPG, WebP ou SVG, até 5MB. Fundo transparente fica melhor.
          </p>
        </div>
      </div>

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
          <Label htmlFor="dia-esteira">Dia de otimização</Label>
          <Select
            value={diaEsteira}
            onValueChange={(v) => setDiaEsteira(v ?? "")}
          >
            <SelectTrigger id="dia-esteira" className="mt-1.5 w-full">
              <SelectValue>
                {(v: string) =>
                  OPTIMIZATION_DAYS.find((d) => d.value === v)?.label ??
                  "Sem rotina"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Sem rotina</SelectItem>
              {OPTIMIZATION_DAYS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Dia da semana em que esta conta entra na esteira.
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

      {/* Meta do período ------------------------------------------
          Âncora `#metas`: o card do cliente na listagem aponta para
          cá quando a conta ainda não tem meta. */}
      <div id="metas" className="mt-5 scroll-mt-20 border-t border-hairline pt-5">
        <p className="text-sm font-medium">Meta deste mês</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          É contra ela que a saúde da conta é medida nos painéis.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="orcamento">Orçamento previsto (R$)</Label>
            <Input
              id="orcamento"
              inputMode="decimal"
              value={orcamento}
              onChange={(e) => setOrcamento(e.target.value)}
              placeholder="5.000,00"
              className="mt-1.5 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="meta-resultados">Meta de resultados</Label>
            <Input
              id="meta-resultados"
              inputMode="numeric"
              value={metaResultados}
              onChange={(e) => setMetaResultados(e.target.value)}
              placeholder="120"
              className="mt-1.5 tabular-nums"
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={salvarMeta}
            disabled={salvandoMeta}
          >
            {salvandoMeta ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Salvar meta
          </Button>
        </div>
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
