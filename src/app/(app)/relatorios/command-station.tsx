"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3, Check, Copy, FileDown, Image as ImageIcon,
  MessageCircle, Target, TrendingUp,
} from "lucide-react";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Estação de comando
   ---------------------------------------------------------------------
   Uma tela para a pergunta "mandar o resultado desta conta agora".
   Filtros e mensagem à esquerda, o que o cliente vai receber à direita.

   OS NÚMEROS SÃO REAIS. Vêm somados de `daily_metrics` no servidor, um
   resumo por cliente, e trocam junto com a seleção. Banner com número
   mockado é a armadilha que já custou três telas neste projeto — e aqui
   seria pior, porque o texto que sai daqui vai para o cliente final.

   CORES POR TOKEN, não `purple-600`: o app tem tema claro e escuro, e
   cor fixa do Tailwind fica ilegível num dos dois.
   ===================================================================== */

export interface ClientSummary {
  id: string;
  name: string;
  spendCents: number;
  results: number;
}

const PERIODOS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "mes", label: "Este mês" },
] as const;

const SECOES = [
  { icon: BarChart3, titulo: "Resumo executivo", sub: "Investimento, resultados e custo" },
  { icon: TrendingUp, titulo: "Evolução no período", sub: "Série diária de gasto e retorno" },
  { icon: Target, titulo: "Meta do mês", sub: "Planejado contra realizado" },
  { icon: ImageIcon, titulo: "Criativos em destaque", sub: "O que mais performou" },
];

export function CommandStation({
  clients,
  templates,
}: {
  clients: ClientSummary[];
  templates: { id: string; name: string }[];
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [periodo, setPeriodo] = useState<string>("30");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [tipo, setTipo] = useState<"completo" | "simples">("completo");
  const [copiado, setCopiado] = useState(false);

  const cliente = clients.find((c) => c.id === clientId) ?? null;
  const periodoLabel =
    PERIODOS.find((p) => p.value === periodo)?.label ?? "Últimos 30 dias";

  /* Custo por resultado calculado aqui e não guardado: dividir na hora
     garante que ele nunca discorde do gasto e do resultado ao lado. */
  const cpl = cliente && cliente.results > 0
    ? cliente.spendCents / cliente.results
    : null;

  const mensagem = useMemo(() => {
    if (!cliente) return "";
    return [
      `Olá! Segue o resumo de ${periodoLabel.toLowerCase()} da campanha.`,
      "",
      `• Investimento: ${formatCurrency(cliente.spendCents)}`,
      `• Resultados: ${formatNumber(cliente.results)}`,
      cpl ? `• Custo por resultado: ${formatCurrency(Math.round(cpl))}` : null,
      "",
      "Qualquer dúvida, é só chamar por aqui.",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }, [cliente, periodoLabel, cpl]);

  async function copiar() {
    await navigator.clipboard.writeText(mensagem);
    setCopiado(true);
    toast.success("Mensagem copiada.");
    // Volta ao ícone original: o check permanente perde o significado.
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ---------------- Coluna esquerda ---------------- */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <section className="surface-card p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Cliente</span>
              <Select value={clientId} onValueChange={(v) => setClientId(v ?? clientId)}>
                <SelectTrigger size="sm">
                  <SelectValue>
                    {(v: string) =>
                      clients.find((c) => c.id === v)?.name ?? "Selecione"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Período</span>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v ?? "30")}>
                <SelectTrigger size="sm">
                  <SelectValue>
                    {(v: string) =>
                      PERIODOS.find((p) => p.value === v)?.label ?? "Período"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Template</span>
              <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? templateId)}>
                <SelectTrigger size="sm">
                  <SelectValue>
                    {(v: string) =>
                      templates.find((t) => t.id === v)?.name ?? "Padrão do segmento"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </section>

        <section className="surface-card relative p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Texto para o cliente</span>
            <Button size="sm" variant="ghost" onClick={copiar} disabled={!cliente}>
              {copiado ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
              Copiar
            </Button>
          </div>
          <Textarea
            value={mensagem}
            readOnly
            rows={9}
            className="mt-2 resize-y font-mono text-xs"
          />
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Números somados das métricas sincronizadas. Trocam junto com o
            cliente e o período.
          </p>
        </section>

        <section className="surface-card p-4">
          <span className="eyebrow">Tipo de relatório</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              { v: "completo", t: "Relatório completo", s: "PDF anexado + mensagem" },
              { v: "simples", t: "Relatório simples", s: "Só a mensagem no WhatsApp" },
            ] as const).map((op) => (
              <button
                key={op.v}
                type="button"
                onClick={() => setTipo(op.v)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  tipo === op.v
                    ? "border-signal bg-signal-muted/40"
                    : "border-hairline hover:bg-accent/40",
                )}
              >
                <span className="block text-sm font-medium">{op.t}</span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">{op.s}</span>
              </button>
            ))}
          </div>

          {/* Ambos apontam para os fluxos que JÁ funcionam, em vez de
              reimplementar geração e envio numa tela nova. Botão sem
              handler seria controle morto — o defeito que esta sessão
              inteira vem corrigindo. */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={
                    cliente ? `/relatorios/novo?cliente=${cliente.id}` : "#"
                  }
                />
              }
            >
              <FileDown className="size-4" />
              Gerar PDF
            </Button>
            <Button
              size="sm"
              className="bg-signal text-white hover:bg-signal/90"
              nativeButton={false}
              render={<a href="#fila-de-envio" />}
            >
              <MessageCircle className="size-4" />
              Ir para a fila de envio
            </Button>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            A geração e o envio acontecem nos fluxos abaixo, já ligados ao
            seu WhatsApp. Esta tela monta a mensagem e mostra os números.
          </p>
        </section>
      </div>

      {/* ---------------- Coluna direita ---------------- */}
      <div className="flex flex-col gap-4">
        <section className="overflow-hidden rounded-xl bg-gradient-to-br from-signal to-[color-mix(in_oklab,var(--signal)_55%,black)] p-4 text-white">
          <p className="text-xs opacity-80">{periodoLabel}</p>
          <h3 className="mt-0.5 truncate text-lg font-semibold">
            {cliente?.name ?? "Nenhum cliente"}
          </h3>

          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/20 pt-3">
            {[
              ["Investimento", cliente ? formatCurrency(cliente.spendCents) : "—"],
              ["Resultados", cliente ? formatNumber(cliente.results) : "—"],
              ["Custo", cpl ? formatCurrency(Math.round(cpl)) : "—"],
            ].map(([label, valor]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-wide opacity-75">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="surface-card p-4">
          <span className="eyebrow">Seções do relatório</span>
          <ul className="mt-3 flex flex-col gap-3">
            {SECOES.map(({ icon: Icon, titulo, sub }) => (
              <li key={titulo} className="flex items-start gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">
                  <Icon className="size-3.5 text-muted-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{titulo}</span>
                  <span className="block text-2xs text-muted-foreground">{sub}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-2xs text-muted-foreground">
            As seções variam por segmento — o template do cliente decide
            quais entram no PDF.
          </p>
        </section>
      </div>
    </div>
  );
}
