import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, FileText } from "lucide-react";

import { dataNoBrasil } from "@/lib/date-br";
import { formatPeriod } from "@/lib/format";
import { mensagemDoCliente } from "@/lib/reports/mensagem-do-cliente";
import estilo from "./vitrine.module.css";

/* =====================================================================
   A vitrine
   ---------------------------------------------------------------------
   Três endereços, e só três: a vitrine aqui, a porta em /login e o
   sistema em /painel. Até 21/09/2026 a raiz ERA o painel, e quem
   digitasse o domínio puro batia numa tela de login sem nenhuma
   explicação do que havia atrás dela.

   A PÁGINA MOSTRA A TRANSFORMAÇÃO, NÃO FALA DELA. A primeira versão
   descrevia o produto em três cartões iguais — o formato que sai
   idêntico para qualquer software. O que este sistema faz, porém, tem
   forma própria: linhas de `daily_metrics`, que ninguém fora daqui
   consegue ler, viram três frases que o dono de um restaurante entende
   no celular. Essa passagem é o herói da página, e é ela que se anima.

   O TEXTO É MONTADO PELA FUNÇÃO DO ENVIO. `mensagemDoCliente` é a mesma
   que o orquestrador chama para despachar de verdade. Uma cópia escrita
   à mão aqui envelheceria na primeira mudança da legenda, e a vitrine
   passaria a prometer um formato que o produto não entrega mais — foi o
   que aconteceu duas vezes DENTRO do produto, entre a tela e o envio.

   NÚMEROS DE EXEMPLO, E A PÁGINA DIZ ISSO. Sem conta real, sem
   depoimento, sem "N agências usam". O período é o da última semana
   fechada e se refaz de hora em hora, para o exemplo não envelhecer.

   FORA DO GOOGLE POR ENQUANTO: o layout raiz marca o site como
   `noindex` por ser painel interno, e esta página herda de propósito.
   Publicar no índice é decisão de quem vende.
   ===================================================================== */

export const metadata: Metadata = {
  title: "Elo Hub — a operação de mídia paga da agência",
  description:
    "Os números da Meta e do Google viram relatório em PDF e mensagem no WhatsApp do cliente. O robô prepara; a equipe confere e dispara.",
};

export const revalidate = 3600;

/** A última semana fechada, de segunda a domingo, no fuso de Brasília. */
function semanaFechada(): { inicio: string; fim: string } {
  const hoje = new Date(`${dataNoBrasil()}T12:00:00`);
  const diaDaSemana = hoje.getDay() === 0 ? 7 : hoje.getDay();

  const domingo = new Date(hoje);
  domingo.setDate(hoje.getDate() - diaDaSemana);
  const segunda = new Date(domingo);
  segunda.setDate(domingo.getDate() - 6);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { inicio: iso(segunda), fim: iso(domingo) };
}

/* As colunas são as de `daily_metrics` mesmo — é o vocabulário do
   sistema, e é justamente o que o cliente final nunca deveria precisar
   ler. Os valores são de exemplo. */
const LINHAS_CRUAS = [
  ["2026-09-15", "meta_ads", "48200", "31"],
  ["2026-09-16", "meta_ads", "39900", "28"],
  ["2026-09-17", "google_ads", "59900", "37"],
  ["…", "…", "…", "…"],
];

export default function VitrinePage() {
  const { inicio, fim } = semanaFechada();

  const mensagem = mensagemDoCliente({
    periodoLabel: formatPeriod(inicio, fim),
    dias: 7,
    cliente: "Cliente",
    numeros: [
      { label: "Investimento", valor: "R$ 1.480,00", origem: null },
      { label: "Pedidos", valor: "96", origem: null },
      { label: "Custo por pedido", valor: "R$ 15,42", origem: 1 },
    ],
  });

  /* Cada linha entra em sequência. O atraso é calculado aqui, e não em
     CSS, porque ele depende da posição — e a classe do módulo é que
     garante o estado base visível. */
  const linhasDaMensagem = mensagem.split("\n");

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2.5">
          <span className="relative flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <span className="text-sm font-bold leading-none">E</span>
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-signal ring-2 ring-background" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">Elo Hub</span>
            <span className="text-2xs text-muted-foreground">Marketing 360</span>
          </span>
        </span>

        <Link
          href="/login"
          className="inline-flex h-9 items-center rounded-lg border border-hairline px-3.5 text-sm font-medium transition-colors hover:border-signal hover:text-signal"
        >
          Entrar
        </Link>
      </header>

      <main>
        {/* ====================== A PASSAGEM ======================= */}
        {/* O herói não é um título sobre um fundo: é o dado cru virando
            frase, em tamanho real, antes de qualquer promessa. */}
        <section className={`${estilo.palco} border-y border-hairline`}>
          <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
            <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,420px)]">
              {/* ---- o que chega das plataformas ---- */}
              {/* `min-w-0`: item de grid tem `min-width: auto` e NÃO
                  encolhe abaixo do próprio conteúdo. Sem isto, a tabela
                  de 382px empurrava a coluna para 384 dentro de um
                  contêiner de 342 no celular, e o cartão da mensagem ao
                  lado saía cortado na borda da seção — medido em
                  390px. */}
              <div className="min-w-0">
                <span className="eyebrow">daily_metrics</span>
                {/* A tabela ganha rolagem PRÓPRIA no celular, em vez de
                    espremer coluna de dado até virar ilegível. A página
                    continua sem rolagem lateral. */}
                <div className="mt-3 overflow-x-auto rounded-xl border border-hairline bg-surface/60">
                  <div className="min-w-[384px]">
                  <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-5 border-b border-hairline px-3 py-2 font-mono text-2xs text-muted-foreground">
                    <span>metric_date</span>
                    <span>platform</span>
                    <span className="text-right">spend_cents</span>
                    <span className="text-right">conversions</span>
                  </div>
                  <div className="divide-y divide-hairline/60">
                    {LINHAS_CRUAS.map((linha, i) => (
                      <div
                        key={linha.join()}
                        className={`${estilo.linhaCrua} grid grid-cols-[auto_1fr_auto_auto] gap-x-5 px-3 py-2 font-mono text-2xs tabular-nums`}
                        style={{ animationDelay: `${0.12 * i}s` }}
                      >
                        {linha.map((celula, c) => (
                          <span
                            key={c}
                            className={c > 1 ? "text-right" : "truncate"}
                          >
                            {celula}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                  </div>
                </div>
                <p className="mt-2.5 font-mono text-2xs text-muted-foreground">
                  o que a Meta e o Google devolvem
                </p>
              </div>

              {/* ---- a passagem ---- */}
              <div className="flex justify-center lg:px-2">
                <ArrowRight
                  className={`${estilo.fluxo} size-5 rotate-90 text-signal lg:rotate-0`}
                  aria-hidden
                />
              </div>

              {/* ---- o que chega ao cliente ---- */}
              <figure className="min-w-0">
                <span className="eyebrow">WhatsApp do cliente</span>
                <div className="surface-card mt-3 p-3.5">
                  <div className="flex items-center gap-2.5 rounded-lg bg-surface-2/70 p-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-signal-muted text-signal">
                      <FileText className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        Relatorio_Cliente.pdf
                      </span>
                      <span className="block text-2xs text-muted-foreground">
                        PDF · 5 páginas
                      </span>
                    </span>
                  </div>

                  <p className="mt-3 font-mono text-xs leading-relaxed">
                    {linhasDaMensagem.map((linha, i) => (
                      <span
                        key={i}
                        className={`${estilo.linhaDaMensagem} block min-h-[1.1em]`}
                        style={{ animationDelay: `${0.9 + 0.09 * i}s` }}
                      >
                        {linha}
                      </span>
                    ))}
                  </p>

                  <div className="mt-3 flex items-center justify-end gap-1.5">
                    <span
                      className={`${estilo.selo} inline-flex items-center gap-1 rounded-full bg-positive-muted px-2 py-0.5 text-2xs font-medium text-positive`}
                    >
                      <Check className="size-3" />
                      entregue
                    </span>
                  </div>
                </div>
                <figcaption className="mt-2.5 font-mono text-2xs text-muted-foreground">
                  exemplo · números fictícios
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ====================== A TESE ======================= */}
        <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-16">
            {/* A FRASE CARREGA OS DOIS LADOS DA PASSAGEM, e a tipografia
                diz qual é qual: o que vem da plataforma está na mesma
                mono da tabela acima; o que chega ao cliente, na voz do
                texto corrido. `text-balance` porque com quebra manual a
                primeira linha estourava e sobrava um "cabe" sozinho. */}
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-tight sm:text-[2.75rem] lg:text-[3.25rem]">
              A{" "}
              {/* `whitespace-nowrap`: o fragmento em mono é UMA unidade de
                  sentido. Quebrado em "planilha da / Meta", lê como erro
                  de renderização, não como escolha tipográfica. */}
              <span className="whitespace-nowrap font-mono text-[0.86em] font-medium tracking-tighter text-muted-foreground">
                planilha da Meta
              </span>{" "}
              não cabe no WhatsApp do cliente.
            </h1>

            <div className="lg:pt-2">
              <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
                O Elo Hub soma o período nas duas plataformas, monta o PDF e
                escreve a mensagem — com os mesmos números do anexo, inclusive
                a ressalva de qual campanha cada um veio. Na manhã do envio, a
                equipe confere e dispara pelo próprio WhatsApp.
              </p>

              <Link
                href="/login"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Entrar no sistema
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ====================== A SEMANA ======================= */}
        {/* Um log, não uma timeline numerada: a coluna da esquerda é
            QUANDO, em mono, do jeito que a agenda de envio mostra. */}
        <section className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
            <span className="eyebrow">A semana</span>

            <div className="mt-8 divide-y divide-hairline border-y border-hairline">
              {[
                {
                  quando: "madrugada",
                  titulo: "O robô soma o período",
                  texto:
                    "Busca Meta e Google na janela do relatório, isola a campanha que comprou o resultado, monta o PDF e deixa tudo na fila.",
                },
                {
                  quando: "manhã",
                  titulo: "A equipe confere",
                  texto:
                    "A fila mostra o que está pronto, para qual grupo vai e o texto que acompanha. Dá para editar a mensagem antes de enviar.",
                },
                {
                  quando: "um clique",
                  titulo: "Sai do seu número",
                  texto:
                    "O cliente recebe de quem ele já conhece, com o PDF anexado — não de um número de robô que ele não reconhece.",
                },
              ].map((passo) => (
                <div
                  key={passo.quando}
                  className={`${estilo.passo} grid gap-2 py-6 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-8 sm:py-7`}
                >
                  <span className="font-mono text-2xs text-signal sm:pt-1">
                    {passo.quando}
                  </span>
                  <div>
                    <h2 className="text-base font-medium tracking-tight">
                      {passo.titulo}
                    </h2>
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {passo.texto}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* O resto do sistema em uma linha, sem cartão: são coisas
                que a equipe já conhece, e transformá-las em três caixas
                iguais daria a elas um peso que não têm. */}
            <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              No resto da semana, o mesmo sistema cuida dos{" "}
              <span className="text-foreground">alertas de saldo</span> das
              contas de anúncio, das{" "}
              <span className="text-foreground">tarefas e da esteira</span> de
              criação, e da{" "}
              <span className="text-foreground">pauta de conteúdo</span> que vai
              para aprovação do cliente.
            </p>
          </div>
        </section>

        {/* ====================== ENTRAR ======================= */}
        <section className="border-t border-hairline">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-6 py-12">
            <p className="text-sm text-muted-foreground">
              O acesso é da equipe e dos parceiros da Elo Marketing.
            </p>
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-hairline px-5 text-sm font-medium transition-colors hover:border-signal hover:text-signal"
            >
              Entrar
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <span className="font-mono text-2xs text-muted-foreground">
            Elo Hub · Elo Marketing
          </span>
        </div>
      </footer>
    </div>
  );
}
