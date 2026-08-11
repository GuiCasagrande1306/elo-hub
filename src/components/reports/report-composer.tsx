"use client";

import { useState, useTransition } from "react";
import { Eye, FileText, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DateRangePicker,
  rotuloDoIntervalo,
  type Intervalo,
} from "@/components/ui/date-range-picker";
import { gerarAnaliseIA } from "@/app/(app)/relatorios/actions";
import { resolverTemplate } from "@/lib/reports/template-resolver";
import { resolvePeriod } from "@/lib/date-br";
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

export function ReportComposer({
  clients,
  templates,
  defaultClientSlug,
}: ReportComposerProps) {
  /* Aceita SLUG ou ID no parâmetro da URL, e normaliza para slug.
     A estação de comando mandava o id e o compositor abria em branco —
     com "Visualizar PDF" habilitado, porque o parâmetro era truthy, e o
     POST devolvia o JSON de erro numa aba nova. Normalizar aqui protege
     de qualquer chamador futuro que erre de novo. */
  const [clientSlug, setClientSlug] = useState(() => {
    const pedido = defaultClientSlug;

    // Sem parâmetro: abre na primeira conta, como sempre abriu.
    if (!pedido) return clients[0]?.slug ?? "";

    /* COM parâmetro que não resolve, fica VAZIO — não cai na primeira
       conta. Escolher outra conta em silêncio é o pior desfecho possível
       aqui: o documento sai com o nome errado e vai para o cliente. Com
       vazio, o seletor mostra "Selecione" e os botões ficam desligados. */
    return clients.find((c) => c.slug === pedido || c.id === pedido)?.slug ?? "";
  });

  /* Abre em "últimos 30 dias" resolvido pelo MESMO `resolvePeriod` que a
     tela de Performance usa — senão o relatório de 30 dias cobriria uma
     janela e o painel outra, com um dia de diferença nas pontas. */
  const [periodo, setPeriodo] = useState<Intervalo>(() => {
    const { start, end } = resolvePeriod("30d");
    return { inicio: start, fim: end };
  });

  const [templateId, setTemplateId] = useState<string>("__auto__");
  const [insights, setInsights] = useState("");
  const [steps, setSteps] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [escrevendo, iniciarEscrita] = useTransition();

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

  function escreverComIA() {
    if (!client) return;

    /* SUBSTITUI o que estava escrito — concatenar produziria dois
       parágrafos contraditórios no PDF a cada clique repetido, e o texto
       vai para o cliente. Por isso a confirmação, e por isso ANTES da
       chamada: perguntar depois já teria gasto a requisição paga.

       Os `Textarea` são controlados, então o `setState` apaga de vez: o
       desfazer do navegador não recupera o que a pessoa digitou. */
    if (
      (insights.trim() || steps.trim()) &&
      !window.confirm(
        "Isso substitui a análise e os próximos passos que já estão escritos. Continuar?",
      )
    ) {
      return;
    }

    iniciarEscrita(async () => {
      try {
        const r = await gerarAnaliseIA({
          clientSlug,
          periodStart: periodo.inicio,
          periodEnd: periodo.fim,
        });

        if (!r.ok) {
          toast.error(r.error);
          return;
        }

        setInsights(r.insights);
        setSteps(r.nextSteps.join("\n"));
        toast.success("Rascunho escrito. Revise antes de gerar o PDF.");
      } catch {
        /* A action devolve erro como VALOR, então este catch só pega
           falha de transporte: rede caída, 504 da Vercel, ou a action
           some depois de um deploy com a aba antiga aberta. Sem ele a
           promise rejeitada sobe para o error boundary e leva junto o
           formulário inteiro — inclusive o texto já digitado. */
        toast.error(
          "Não deu para falar com o servidor. Recarregue a página e tente de novo.",
        );
      }
    });
  }

  function handlePreview() {
    if (!client) return;
    setBusy("preview");

    /* POST por formulário, não `window.open` com query.
       ---------------------------------------------------------------
       O preview existe para conferir o documento ANTES de mandar. Com
       GET ele só levava cliente e datas: o template escolhido à mão era
       ignorado (a rota resolvia pelo segmento) e a análise não ia junto.
       Resultado — a pessoa conferia um PDF com outro layout e sem a
       seção de análise, e aprovava um documento diferente do que o
       cliente receberia.

       A análise não cabe numa URL (2.200 caracteres de legenda contra
       o limite prático de query), então o caminho é POST. `target`
       numa nova aba mantém o comportamento de antes. */
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/reports/preview";
    form.target = "_blank";
    form.rel = "noopener";
    form.style.display = "none";

    const campos: Record<string, string> = {
      cliente: clientSlug,
      inicio: periodo.inicio,
      fim: periodo.fim,
      template: templateId === "__auto__" ? "" : templateId,
      insights: insights.trim(),
      nextSteps: steps,
    };

    for (const [nome, valor] of Object.entries(campos)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = nome;
      input.value = valor;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    form.remove();

    setTimeout(() => setBusy(null), 800);
  }

  async function handleGenerate(deliver: "whatsapp" | "none") {
    if (!client) return;
    setBusy(deliver === "whatsapp" ? "send" : null);

    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSlug,
          templateId: templateId === "__auto__" ? undefined : templateId,
          periodStart: periodo.inicio,
          periodEnd: periodo.fim,
          insights: insights.trim() || undefined,
          nextSteps: steps
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          deliver,
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
              <DateRangePicker id="periodo" value={periodo} onChange={setPeriodo} />
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-[-0.01em]">
                Leitura do time
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                O que os números não contam sozinhos. Entra como seção de
                análise no PDF.
              </p>
            </div>

            {/* RASCUNHO, e o rótulo diz isso. O texto sai dos mesmos
                números do PDF, mas quem assina o relatório é a agência —
                um botão chamado "Analisar" sugeriria que o trabalho
                acabou aqui. */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              disabled={escrevendo || !client}
              onClick={escreverComIA}
            >
              {escrevendo ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Escrever rascunho com IA
            </Button>
          </div>

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
            <Summary label="Período" value={rotuloDoIntervalo(periodo)} />
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

          {/* DOIS BOTÕES. O "Gerar e arquivar" saiu: arquivar sem enviar
              era o caminho do cron, não desta tela — quem abre "Gerar
              relatório" quer que o cliente receba. A rota continua
              aceitando `deliver: "none"`, que é o que o job usa. */}
          <div className="mt-5 flex flex-col gap-2">
            <Button
              variant="outline"
              className="h-9 w-full"
              disabled={busy !== null || !client}
              onClick={handlePreview}
            >
              {busy === "preview" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Eye className="size-4" />
              )}
              Visualizar PDF
            </Button>

            {/* ABRIR EM A4 é diferente de "Visualizar PDF", e a diferença
                é quem monta o documento. O botão acima manda o servidor
                gerar o mesmo arquivo que sai no envio. Este abre a folha
                em HTML no navegador, para a equipe auditar os números e
                os nomes de campanha na tela — e, se quiser, salvar pelo
                próprio Chrome com Ctrl/⌘+P. */}
            <Button
              variant="ghost"
              className="h-9 w-full"
              disabled={!client}
              nativeButton={false}
              render={
                <a
                  href={
                    client
                      ? `/reports/render/${client.id}?inicio=${periodo.inicio}&fim=${periodo.fim}`
                      : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <FileText className="size-4" />
              Abrir em A4 para revisar
            </Button>

            <Button
              className="h-9 w-full"
              disabled={busy !== null || !client || !client.whatsapp_phone}
              onClick={() => handleGenerate("whatsapp")}
            >
              {busy === "send" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageCircle className="size-4" />
              )}
              Gerar e enviar
            </Button>
          </div>
        </section>

        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          {client && !client.whatsapp_phone ? (
            <>
              <strong className="font-medium text-warning">
                Sem WhatsApp cadastrado.
              </strong>{" "}
              O envio precisa de um número ou grupo no cadastro da conta —
              enquanto isso, dá para conferir o PDF pela pré-visualização.
            </>
          ) : (
            <>
              O envio gera o PDF, sobe no Supabase Storage e dispara a mensagem
              com o resumo de investimento, resultados e CPA — o documento vai
              em anexo, pelo seu WhatsApp.
            </>
          )}
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
