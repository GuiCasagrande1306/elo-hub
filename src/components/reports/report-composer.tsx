"use client";

import { useState } from "react";
import { Eye, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolverTemplate } from "@/lib/reports/template-resolver";
import { cn } from "@/lib/utils";
import type { Client, ReportTemplate } from "@/types/database";

/**
 * Composição do relatório: escolher conta, período e template, escrever a
 * análise e disparar.
 *
 * O botão "Pré-visualizar" abre `/api/reports/preview`, que gera o PDF
 * sem gravar nada. A separação é deliberada: o erro caro neste fluxo é o
 * relatório errado já entregue ao cliente, e conferir precisa ser mais
 * barato do que enviar.
 */

interface ReportComposerProps {
  clients: Client[];
  templates: ReportTemplate[];
  defaultClientSlug?: string;
}

const PERIODS = [
  { days: 7, label: "Últimos 7 dias" },
  { days: 30, label: "Últimos 30 dias" },
  { days: 90, label: "Últimos 90 dias" },
];

export function ReportComposer({
  clients,
  templates,
  defaultClientSlug,
}: ReportComposerProps) {
  const [clientSlug, setClientSlug] = useState(
    defaultClientSlug ?? clients[0]?.slug ?? "",
  );
  const [days, setDays] = useState(30);
  const [templateId, setTemplateId] = useState<string>("__auto__");
  const [insights, setInsights] = useState("");
  const [steps, setSteps] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | "archive" | null>(null);

  const client = clients.find((c) => c.slug === clientSlug);

  /* Template automático = o padrão do segmento do cliente, e a regra
     mora em `resolverTemplate`: a tela de Relatórios EXIBE qual seria, e
     duas cópias da mesma resolução divergiriam sem ninguém ver — a tela
     anunciando um template e o PDF saindo com outro. */
  const autoTemplate = resolverTemplate(templates, client?.segment);

  const effectiveTemplate =
    templateId === "__auto__"
      ? autoTemplate
      : templates.find((t) => t.id === templateId);

  function periodRange() {
    const end = new Date();
    end.setDate(end.getDate() - 1); // ontem: hoje ainda não fechou
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { periodStart: iso(start), periodEnd: iso(end) };
  }

  function handlePreview() {
    if (!clientSlug) return;
    setBusy("preview");
    // Abre em nova aba: o PDF é servido inline pela própria rota.
    window.open(
      `/api/reports/preview?cliente=${clientSlug}&periodo=${days}`,
      "_blank",
      "noopener",
    );
    setTimeout(() => setBusy(null), 800);
  }

  async function handleGenerate(deliver: "whatsapp" | "none") {
    if (!clientSlug) return;
    setBusy(deliver === "whatsapp" ? "send" : "archive");

    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSlug,
          templateId: templateId === "__auto__" ? undefined : templateId,
          ...periodRange(),
          insights: insights.trim() || undefined,
          nextSteps: steps
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          deliver,
          recipient: recipient.trim() || undefined,
        }),
      });

      // Em modo demo a rota devolve o PDF direto, sem Storage nem envio.
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.includes("application/pdf")) {
        const blob = await response.blob();
        window.open(URL.createObjectURL(blob), "_blank", "noopener");
        toast.success(
          "PDF gerado. Em modo demo não há Storage nem envio — o arquivo abriu em nova aba.",
        );
        return;
      }

      /* Ler como TEXTO e só então tentar JSON.
         Quando a função estoura o limite da Vercel, a resposta é uma
         página de erro da plataforma, não JSON. Com `response.json()`
         direto, o usuário via "Unexpected token 'A'" — uma mensagem que
         não dizia nada sobre o que aconteceu nem o que fazer. */
      const corpo = await response.text();

      let data: { error?: string } = {};
      try {
        data = corpo ? JSON.parse(corpo) : {};
      } catch {
        toast.error(
          response.status === 504 || response.status === 502
            ? "A geração demorou demais e foi interrompida pelo servidor. O relatório pode ter sido arquivado — confira em Relatórios."
            : `O servidor respondeu de forma inesperada (HTTP ${response.status}).`,
        );
        return;
      }

      if (!response.ok) {
        toast.error(data.error ?? "Falha ao gerar o relatório.");
        return;
      }

      toast.success(
        deliver === "whatsapp"
          ? "Relatório gerado e enviado por WhatsApp."
          : "Relatório gerado e arquivado.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha de rede na geração.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Formulário ------------------------------------------------ */}
      <div className="flex flex-col gap-5">
        <section className="surface-card p-5">
          <h2 className="text-base font-semibold tracking-[-0.01em]">
            Configuração
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Cliente" htmlFor="cliente">
              {/* Base UI entrega `string | null`; normalizamos na borda. */}
              <Select
                value={clientSlug}
                onValueChange={(value) => setClientSlug(value ?? "")}
              >
                <SelectTrigger id="cliente" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      clients.find((c) => c.slug === value)?.name ??
                      "Selecione"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Período" htmlFor="periodo">
              <Select
                value={String(days)}
                onValueChange={(value) => setDays(Number(value))}
              >
                <SelectTrigger id="periodo" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      PERIODS.find((p) => String(p.days) === value)?.label ??
                      "Período"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.days} value={String(p.days)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Template"
              htmlFor="template"
              className="sm:col-span-2"
              hint={
                templateId === "__auto__" && autoTemplate
                  ? `Automático pelo segmento: ${autoTemplate.name}`
                  : undefined
              }
            >
              <Select
                value={templateId}
                onValueChange={(value) => setTemplateId(value ?? "__auto__")}
              >
                <SelectTrigger id="template" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === "__auto__"
                        ? "Automático (pelo segmento)"
                        : (templates.find((t) => t.id === value)?.name ??
                          "Template")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">
                    Automático (pelo segmento)
                  </SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>

        <section className="surface-card p-5">
          <h2 className="text-base font-semibold tracking-[-0.01em]">
            Leitura do time
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            O que os números não contam sozinhos. Entra como seção de análise
            no PDF.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <Field label="Análise do período" htmlFor="insights">
              <Textarea
                id="insights"
                rows={5}
                value={insights}
                onChange={(event) => setInsights(event.target.value)}
                placeholder="Ex.: o CPA subiu 12% na segunda quinzena por saturação do criativo de depoimento; a substituição por prova social em vídeo já reverteu a curva nos últimos 4 dias."
              />
            </Field>

            <Field
              label="Próximos passos"
              htmlFor="steps"
              hint="Um por linha."
            >
              <Textarea
                id="steps"
                rows={4}
                value={steps}
                onChange={(event) => setSteps(event.target.value)}
                placeholder={"Subir 3 criativos novos de prova social\nTestar públicos lookalike 2%\nRevisar a página de checkout"}
              />
            </Field>
          </div>
        </section>
      </div>

      {/* Painel de envio ------------------------------------------- */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <section className="surface-card p-5">
          <h2 className="text-base font-semibold tracking-[-0.01em]">Envio</h2>

          <dl className="mt-4 flex flex-col gap-2.5 text-sm">
            <Summary label="Conta" value={client?.name ?? "—"} />
            <Summary
              label="Template"
              value={effectiveTemplate?.name ?? "—"}
            />
            <Summary
              label="Seções"
              value={
                effectiveTemplate
                  ? `${effectiveTemplate.sections.length} no PDF`
                  : "—"
              }
            />
            <Summary
              label="WhatsApp"
              value={client?.whatsapp_phone ?? "não cadastrado"}
            />
          </dl>

          <div className="mt-4 border-t border-hairline pt-4">
            <Field
              label="Enviar para outro número"
              htmlFor="recipient"
              hint="Opcional. Deixe vazio para usar o cadastro."
            >
              <Input
                id="recipient"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="+55 48 99999-0000"
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <Button
              variant="outline"
              className="h-9 w-full"
              disabled={busy !== null || !clientSlug}
              onClick={handlePreview}
            >
              {busy === "preview" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Eye className="size-4" />
              )}
              Pré-visualizar PDF
            </Button>

            <Button
              variant="secondary"
              className="h-9 w-full"
              disabled={busy !== null || !clientSlug}
              onClick={() => handleGenerate("none")}
            >
              {busy === "archive" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Gerar e arquivar
            </Button>

            <Button
              className="h-9 w-full"
              disabled={busy !== null || !clientSlug}
              onClick={() => handleGenerate("whatsapp")}
            >
              {busy === "send" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageCircle className="size-4" />
              )}
              Gerar e enviar no WhatsApp
            </Button>
          </div>
        </section>

        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          O envio gera o PDF, sobe no Supabase Storage e dispara a mensagem com
          o resumo de investimento, resultados e CPA — o documento vai em
          anexo.
        </p>
      </aside>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium">
        {value}
      </dd>
    </div>
  );
}
