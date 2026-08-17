"use client";

import { useState } from "react";
import { Eye, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

  const [busy, setBusy] = useState<"preview" | "send" | null>(null);

  const client = clients.find((c) => c.slug === clientSlug);

  /* O TEMPLATE NÃO SE ESCOLHE MAIS: é sempre o padrão do segmento do
     cliente, resolvido por `resolverTemplate` — a mesma função que a
     tela de Relatórios usa para exibir qual seria, e que o servidor usa
     quando o campo vem vazio. Três lugares, uma regra.

     O seletor saiu porque a escolha nunca foi real: em toda geração o
     valor certo era o padrão da conta, e oferecer as outras opções só
     criava a chance de enviar ao cliente um layout que não é o dele. */
  const effectiveTemplate = resolverTemplate(templates, client?.segment);

  /* Quantas seções o PDF REALMENTE terá.
     Contar `sections.length` cru passou a mentir: desde que a escrita
     saiu deste fluxo, `insights` e `next_steps` chegam vazias e o
     documento as descarta em vez de imprimir um título com "não
     preenchido" embaixo. O painel dizia "8 no PDF" e saíam 6 — número
     pequeno, mas é o tipo de detalhe que corrói a confiança na tela. */
  const secoesNoPdf = (effectiveTemplate?.sections ?? []).filter(
    (sec) => sec.type !== "insights" && sec.type !== "next_steps",
  ).length;

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

    /* `template` vazio: o servidor resolve pelo segmento, igual à tela.
       `insights`/`nextSteps` não são mais enviados — a rota continua
       aceitando os dois porque o cron pode um dia preenchê-los, mas
       daqui não sai texto nenhum. */
    const campos: Record<string, string> = {
      cliente: clientSlug,
      inicio: periodo.inicio,
      fim: periodo.fim,
      template: "",
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
          // Sem `templateId`: o servidor resolve pelo segmento da conta.
          periodStart: periodo.inicio,
          periodEnd: periodo.fim,
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
          </div>

          {/* O TEMPLATE VIRA INFORMAÇÃO, não campo. Continua visível
              porque quem gera precisa saber que layout o cliente vai
              receber — só não é mais uma decisão a tomar a cada envio. */}
          {client && (
            <p className="mt-4 text-xs text-muted-foreground">
              Template:{" "}
              <span className="font-medium text-foreground">
                {effectiveTemplate?.name ?? "nenhum configurado"}
              </span>{" "}
              — o padrão do nicho desta conta.
            </p>
          )}
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
              value={effectiveTemplate ? `${secoesNoPdf} no PDF` : "—"}
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

            {/* O botão "Abrir em A4 para revisar" saiu daqui.
                Ele mostrava um documento DIFERENTE do que era enviado: a
                rota levava só cliente e datas, sem o template escolhido à
                mão nem a análise escrita — a pessoa aprovava uma folha e
                o cliente recebia outra. "Visualizar PDF" acima gera o
                arquivo de verdade, com tudo o que está no formulário.

                A rota `/reports/render` continua existindo porque é a
                FONTE do motor Puppeteer (ver `pdf/render.ts`), mas deixou
                de ser superfície de uso. */}


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
