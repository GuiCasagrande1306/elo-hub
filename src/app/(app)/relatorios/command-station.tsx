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
import { formatCurrency, formatMultiplier, formatPeriod } from "@/lib/format";
import { formatGoalValue, type GoalMetric } from "@/lib/metrics/goal-metric";

/* =====================================================================
   Estação de comando
   ---------------------------------------------------------------------
   Uma tela para a pergunta "mandar o resultado desta conta agora".
   Filtros e mensagem à esquerda, o que o cliente vai receber à direita.

   OS NÚMEROS SÃO REAIS e o PERÍODO É O DELES. Vêm somados de
   `daily_metrics` no servidor, na janela da meta vigente de cada conta,
   e a tela rotula a mensagem com essa mesma janela.

   ⚠️ HAVIA UM SELETOR DE PERÍODO AQUI, e ele mentia. Trocava a frase
   ("resumo dos últimos 7 dias") sem trocar os números, que continuavam
   sendo os do mês inteiro — e o texto daqui é copiado e enviado ao
   cliente final. Um controle que muda o rótulo e não o dado é pior que
   controle nenhum: ele produz um número errado com aparência de certo.

   Voltará quando houver busca de verdade por intervalo. Enquanto não
   houver, a tela diz o período que ela realmente somou.

   CORES POR TOKEN, não `purple-600`: o app tem tema claro e escuro, e
   cor fixa do Tailwind fica ilegível num dos dois.
   ===================================================================== */

export interface ClientSummary {
  id: string;
  /** Identificador da conta na URL. O compositor resolve por ele. */
  slug: string;
  name: string;
  spendCents: number;
  /** Já na unidade de `metric` — resolvido no servidor. */
  resultValue: number;
  metric: GoalMetric;
  /** A janela que o servidor somou. É ela que rotula a mensagem. */
  period: { start: string; end: string };
  /** Template que o segmento desta conta seleciona. Exibido, não escolhido. */
  templateName: string;
}

const SECOES = [
  { icon: BarChart3, titulo: "Resumo executivo", sub: "Investimento, resultados e custo" },
  { icon: TrendingUp, titulo: "Evolução no período", sub: "Série diária de gasto e retorno" },
  { icon: Target, titulo: "Meta do mês", sub: "Planejado contra realizado" },
  { icon: ImageIcon, titulo: "Criativos em destaque", sub: "O que mais performou" },
];

export function CommandStation({ clients }: { clients: ClientSummary[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [copiado, setCopiado] = useState(false);

  const cliente = clients.find((c) => c.id === clientId) ?? null;

  /* Rótulo DERIVADO da janela somada, não escolhido. Muda quando o
     cliente muda, porque cada conta tem o período da meta dela. */
  const periodoLabel = cliente
    ? formatPeriod(cliente.period.start, cliente.period.end)
    : "—";

  /* Custo por resultado calculado aqui e não guardado: dividir na hora
     garante que ele nunca discorde do gasto e do resultado ao lado.

     `costLabel` nulo = a meta já é em dinheiro, e "custo por
     faturamento" não é uma grandeza. Ali a razão que interessa é ROAS. */
  const cpl =
    cliente && cliente.metric.costLabel && cliente.resultValue > 0
      ? cliente.spendCents / cliente.resultValue
      : null;

  const roas =
    cliente && cliente.metric.isCurrency && cliente.spendCents > 0
      ? cliente.resultValue / cliente.spendCents
      : null;

  const mensagem = useMemo(() => {
    if (!cliente) return "";
    const { metric } = cliente;

    return [
      "Olá! Segue o resumo da campanha.",
      "",
      /* O período entra como CAMPO, na mesma lista dos números — não
         embutido na saudação. Colado neles, não há como ler um sem o
         outro; era exatamente essa separação que deixava a frase dizer
         "7 dias" sobre o gasto de um mês. */
      `• Período: ${periodoLabel}`,
      `• Investimento: ${formatCurrency(cliente.spendCents)}`,
      `• ${metric.label}: ${formatGoalValue(metric, cliente.resultValue)}`,
      cpl ? `• ${metric.costLabel}: ${formatCurrency(Math.round(cpl))}` : null,
      roas ? `• Retorno: ${formatMultiplier(roas)} sobre o investido` : null,
      "",
      "Qualquer dúvida, é só chamar por aqui.",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }, [cliente, periodoLabel, cpl, roas]);

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
          {/* `min-w-0` nos três: item de grid tem `min-width: auto` e não
              encolhe abaixo do próprio conteúdo. Sem isso o select de
              template — cujo nome é longo, "E-commerce — Performance &
              ROAS" — vazava 69px para fora do card em vez de truncar. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Cliente</span>
              <Select value={clientId} onValueChange={(v) => setClientId(v ?? clientId)}>
                <SelectTrigger size="sm" className="w-full min-w-0">
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

            {/* Período NÃO é campo — é consequência. Mostrado como texto
                para ficar claro que veio da meta da conta e que trocar o
                cliente troca ele junto. */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Período</span>
              <p className="flex h-8 items-center text-sm tabular-nums">
                {periodoLabel}
              </p>
            </div>

            {/* Template também é CONSEQUÊNCIA, não escolha — o segmento
                da conta decide. Havia um select aqui e ele não fazia
                nada: guardava estado que ninguém lia. Escolher template
                de verdade existe no compositor (`/relatorios/novo`),
                onde a decisão chega até a geração do PDF. Duplicar o
                controle aqui só oferecia a mesma decisão duas vezes, uma
                delas sem efeito. */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Template</span>
              {/* `title` porque o nome trunca nesta largura e, sendo
                  texto e não select, não há outro jeito de ler inteiro. */}
              <p
                className="flex h-8 items-center truncate text-sm"
                title={cliente?.templateName}
              >
                {cliente?.templateName ?? "—"}
              </p>
            </div>
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
            Números somados das métricas sincronizadas, no período da meta
            vigente desta conta. Trocam junto com o cliente.
          </p>
        </section>

        {/* HAVIA UM "Tipo de relatório" AQUI — dois cartões, "completo"
            e "simples" — e ele só pintava a própria borda. Nada lia a
            escolha: não mudava a mensagem, não ia para o PDF, não ia
            para lugar nenhum.

            E era redundante por construção: os dois botões abaixo JÁ
            são essa escolha. "Copiar" (no card da mensagem) é o simples;
            "Gerar PDF" é o completo. Um seletor de modo acima de dois
            botões que fazem os dois modos oferece a mesma decisão duas
            vezes — e a de cima não valia nada. */}
        <section className="surface-card p-4">
          <span className="eyebrow">O que fazer com isto</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={
                    cliente ? `/relatorios/novo?cliente=${cliente.slug}` : "#"
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
            Só a mensagem? Use o <strong>Copiar</strong> acima. Com PDF
            anexado, gere primeiro e despache pela fila — ela sai do seu
            WhatsApp. Esta tela monta o texto e mostra os números.
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

          {/* EMPILHADO, não em três colunas. Com faturamento de seis
              dígitos — "R$ 835.070,52" — as três colunas colidiam num
              card desta largura, e o valor ficava colado no vizinho. Uma
              linha por número não tem esse limite. */}
          <dl className="mt-4 flex flex-col gap-2 border-t border-white/20 pt-3">
            {[
              ["Investimento", cliente ? formatCurrency(cliente.spendCents) : "—"],
              [
                cliente?.metric.label ?? "Resultados",
                cliente
                  ? formatGoalValue(cliente.metric, cliente.resultValue)
                  : "—",
              ],
              /* Terceira coluna: custo unitário onde ele existe, ROAS
                 onde a meta é dinheiro. */
              cliente?.metric.isCurrency
                ? ["Retorno", roas ? formatMultiplier(roas) : "—"]
                : ["Custo", cpl ? formatCurrency(Math.round(cpl)) : "—"],
            ].map(([label, valor]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3"
              >
                <dt className="text-[10px] uppercase tracking-wide opacity-75">
                  {label}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">{valor}</dd>
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
