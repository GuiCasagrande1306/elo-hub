"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";

import { salvarTemplate } from "@/app/(app)/relatorios/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { MetricKey } from "@/types/database";

/* =====================================================================
   Templates por segmento, editáveis
   ---------------------------------------------------------------------
   Saíram do corpo da página para um botão: são CONFIGURAÇÃO, mexida
   talvez uma vez por trimestre, e ocupavam a metade da tela que deveria
   mostrar o que precisa ser enviado hoje.

   O QUE DÁ PARA EDITAR são nome, descrição, métricas em destaque e o
   rótulo de cada uma. As SEÇÕES do PDF não: cada tipo de seção tem
   renderizador próprio no gerador, e uma lista solta aqui deixaria
   escolher blocos que o PDF não sabe desenhar — erro que só apareceria
   na hora de gerar, para o cliente final.
   ===================================================================== */

const METRICAS: { key: MetricKey; label: string }[] = [
  { key: "spend", label: "Investimento" },
  { key: "results", label: "Resultados" },
  { key: "cpa", label: "Custo por resultado" },
  { key: "revenue", label: "Faturamento" },
  { key: "roas", label: "ROAS" },
  { key: "leads", label: "Leads" },
  { key: "cpl", label: "Custo por lead" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "impressions", label: "Impressões" },
  { key: "clicks", label: "Cliques" },
  { key: "aov", label: "Ticket médio" },
];

const MAX_METRICAS = 8;

export interface TemplateEditavel {
  id: string;
  name: string;
  description: string | null;
  segmentLabel: string;
  metrics: string[];
  metricLabels: Record<string, string>;
  highlightMetric: string | null;
  sectionCount: number;
}

export function TemplateSettingsDialog({
  templates,
}: {
  templates: TemplateEditavel[];
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-9"
        onClick={() => setAberto(true)}
      >
        <Settings2 className="size-4" />
        Templates
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="flex max-h-[90vh] w-[96vw] flex-col overflow-hidden sm:max-w-[min(94vw,900px)]">
          <DialogHeader>
            <DialogTitle>Templates por segmento</DialogTitle>
            <DialogDescription>
              O segmento do cliente escolhe o template sozinho. O que muda
              aqui vale para todo cliente daquele nicho.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 flex flex-wrap gap-1.5 border-b border-hairline pb-3">
            {templates.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAtivo(i)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  i === ativo
                    ? "border-signal bg-accent font-medium"
                    : "border-hairline text-muted-foreground hover:text-foreground",
                )}
              >
                {t.segmentLabel}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pt-4">
            {templates[ativo] && (
              /* `key` remonta o formulário ao trocar de aba: sem isso o
                 estado do template anterior ficaria nos campos. */
              <Formulario
                key={templates[ativo].id}
                template={templates[ativo]}
                onSaved={() => setAberto(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Formulario({
  template,
  onSaved,
}: {
  template: TemplateEditavel;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(template.name);
  const [descricao, setDescricao] = useState(template.description ?? "");
  const [metricas, setMetricas] = useState<string[]>(template.metrics);
  const [rotulos, setRotulos] = useState<Record<string, string>>(
    template.metricLabels ?? {},
  );
  const [destaque, setDestaque] = useState<string | null>(
    template.highlightMetric,
  );
  const [salvando, startTransition] = useTransition();

  function alternar(key: string) {
    /* Tirar da lista a métrica que estava em destaque LIMPA o destaque.
       Sem isto o formulário guardaria uma chave que não está mais em
       `metrics`, e o salvamento voltaria com erro — ou pior, passaria e
       a capa exibiria um número que o corpo do relatório não explica. */
    if (destaque === key && metricas.includes(key)) setDestaque(null);

    setMetricas((atual) =>
      atual.includes(key)
        ? atual.filter((m) => m !== key)
        : /* A ORDEM é a do PDF, e entra no fim — reordenar sozinho faria
             o destaque mudar de lugar sem ninguém pedir. */
          atual.length >= MAX_METRICAS
          ? atual
          : [...atual, key],
    );
  }

  function salvar() {
    if (metricas.length === 0) {
      toast.error("Escolha ao menos uma métrica.");
      return;
    }

    startTransition(async () => {
      const r = await salvarTemplate({
        id: template.id,
        name: nome,
        description: descricao,
        metrics: metricas,
        metricLabels: rotulos,
        highlightMetric: destaque,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Template salvo.");
      router.refresh();
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-nome">Nome</Label>
          <Input
            id="tpl-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-desc">Descrição</Label>
          <Input
            id="tpl-desc"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={240}
            placeholder="Para que serve este template"
          />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <Label>Métricas em destaque</Label>
          <span
            className={cn(
              "text-2xs tabular-nums",
              metricas.length >= MAX_METRICAS
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            {metricas.length} de {MAX_METRICAS}
          </span>
        </div>

        <p className="mt-0.5 text-2xs text-muted-foreground">
          Na ordem em que aparecem no PDF. Clique para incluir ou tirar.
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {METRICAS.map((m) => {
            const ativa = metricas.includes(m.key);
            const posicao = metricas.indexOf(m.key) + 1;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => alternar(m.key)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  ativa
                    ? "border-signal bg-accent font-medium"
                    : "border-hairline text-muted-foreground hover:text-foreground",
                )}
              >
                {ativa && (
                  <span className="mr-1 tabular-nums text-signal">{posicao}</span>
                )}
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {metricas.length > 0 && (
        <div>
          <Label>Como cada número se chama no PDF</Label>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Em branco usa o nome padrão. É aqui que &ldquo;Resultados&rdquo;
            vira &ldquo;Pedidos&rdquo; ou &ldquo;Contatos&rdquo; — o cliente
            precisa reconhecer o próprio negócio.
          </p>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {metricas.map((key) => {
              const meta = METRICAS.find((m) => m.key === key);
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                    {meta?.label ?? key}
                  </span>
                  <Input
                    value={rotulos[key] ?? ""}
                    onChange={(e) =>
                      setRotulos((r) => ({ ...r, [key]: e.target.value }))
                    }
                    placeholder={meta?.label ?? key}
                    maxLength={40}
                    className="h-8 text-xs"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {metricas.length > 0 && (
        <div>
          <Label>Qual abre a capa</Label>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Sai em corpo grande no topo do relatório, antes das outras. É a
            resposta que o cliente procura primeiro: faturamento na loja e
            no delivery, visitas ao perfil no negócio local, leads na
            captação.
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDestaque(null)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                destaque === null
                  ? "border-signal bg-accent font-medium"
                  : "border-hairline text-muted-foreground hover:text-foreground",
              )}
            >
              Nenhuma
            </button>

            {/* Só as métricas ESCOLHIDAS. Oferecer as outras deixaria
                destacar um número que o relatório não mostra em lugar
                nenhum — o banco recusa (check da migration 45), mas o
                erro chegaria depois de a pessoa já ter clicado. */}
            {metricas.map((key) => {
              const meta = METRICAS.find((m) => m.key === key);
              const nome = rotulos[key]?.trim() || meta?.label || key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDestaque(key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    destaque === key
                      ? "border-signal bg-accent font-medium"
                      : "border-hairline text-muted-foreground hover:text-foreground",
                  )}
                >
                  {nome}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <span className="text-2xs text-muted-foreground">
          {template.sectionCount} seções no PDF — definidas no gerador.
        </span>
        <Button size="sm" disabled={salvando} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar template"}
        </Button>
      </div>
    </div>
  );
}
