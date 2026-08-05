"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { registerOptimization } from "@/app/(app)/esteira/actions";
import { cn } from "@/lib/utils";
import type { Client, OptimizationEntry } from "@/types/database";

/* =====================================================================
   Gaveta de execução
   ---------------------------------------------------------------------
   Formulário em cima, histórico embaixo — nessa ordem porque quem abre
   veio para REGISTRAR, não para ler. O histórico logo abaixo existe
   para responder "o que eu fiz da última vez?" sem sair da tela, que é
   a pergunta que antecede a otimização de hoje.
   ===================================================================== */

export function OptimizationSheet({
  client,
  history,
  open,
  onOpenChange,
}: {
  client: Client | null;
  history: OptimizationEntry[];
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  const [notes, setNotes] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [projection, setProjection] = useState("");
  const [salvando, startTransition] = useTransition();

  function concluir() {
    if (!client) return;

    startTransition(async () => {
      const r = await registerOptimization({
        clientId: client.id,
        notes,
        reportSent,
        goalProjection: projection,
      });

      if (r.ok) {
        toast.success("Otimização registrada.");
        // Limpa só no sucesso: se falhou, o texto digitado continua ali.
        setNotes("");
        setReportSent(false);
        setProjection("");
        onOpenChange(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  if (!client) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: client.brand_primary ?? "#8a8a8a" }}
            />
            <SheetTitle className="truncate">{client.name}</SheetTitle>
          </div>
          <SheetDescription>
            Registre o que foi feito nesta rodada.
          </SheetDescription>
        </SheetHeader>

        {/* Formulário ------------------------------------------------ */}
        <div className="flex flex-col gap-5 px-5 py-5">
          <div>
            <Label htmlFor="notas">O que foi otimizado?</Label>
            <Textarea
              id="notas"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={7}
              placeholder={
                "Ex.: pausei os 2 criativos com CPA acima de R$ 120 e subi verba do Kit Rotina em 15%.\nAjustei o lance do PMax para maximizar conversões."
              }
              className="mt-1.5 resize-y"
            />
            <p className="mt-1.5 text-2xs text-muted-foreground">
              É o que vai explicar a variação do mês. Seja específico.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Relatório semanal enviado?</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                Marque se o cliente já recebeu o resumo desta semana.
              </p>
            </div>
            <Switch
              checked={reportSent}
              onCheckedChange={setReportSent}
              aria-label="Relatório semanal enviado"
            />
          </div>

          <div className="max-w-[200px]">
            <Label htmlFor="projecao">Projeção da meta (%)</Label>
            <Input
              id="projecao"
              inputMode="decimal"
              value={projection}
              onChange={(e) => setProjection(e.target.value)}
              placeholder="87,5"
              className="mt-1.5 tabular-nums"
            />
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Quanto da meta você espera fechar. Aceita vírgula.
            </p>
          </div>

          <Button
            onClick={concluir}
            disabled={salvando || notes.trim().length < 3}
            className="w-full"
          >
            {salvando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Concluir otimização
          </Button>
        </div>

        {/* Histórico -------------------------------------------------- */}
        <div className="border-t border-hairline px-5 py-5">
          <h3 className="text-sm font-semibold">Histórico</h3>

          {history.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhuma otimização registrada nesta conta ainda.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="border-l-2 border-hairline pl-3.5"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-medium">
                      {h.collaborator?.full_name ?? "Autor removido"}
                    </span>
                    <span className="text-2xs tabular-nums text-muted-foreground">
                      {formatarQuando(h.created_at)}
                    </span>
                    {h.report_sent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-positive-muted px-1.5 py-0.5 text-[10px] font-medium text-positive">
                        <Send className="size-2.5" />
                        relatório enviado
                      </span>
                    )}
                    {h.goal_projection !== null && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                          h.goal_projection >= 80
                            ? "bg-positive-muted text-positive"
                            : h.goal_projection >= 50
                              ? "bg-warning-muted text-warning"
                              : "bg-negative-muted text-negative",
                        )}
                      >
                        {formatarProjecao(h.goal_projection)}
                      </span>
                    )}
                  </div>

                  {/* `whitespace-pre-wrap`: o campo aceita várias linhas
                      e a quebra é informação — some sem isto. */}
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {h.notes}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** "22/07/2026 às 09:52" */
function formatarQuando(iso: string): string {
  const d = new Date(iso);
  const data = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  return `${data} às ${hora}`;
}

function formatarProjecao(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da meta`;
}
