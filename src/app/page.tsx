import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, FileText } from "lucide-react";

import { dataNoBrasil } from "@/lib/date-br";
import { formatPeriod } from "@/lib/format";
import { mensagemDoCliente } from "@/lib/reports/mensagem-do-cliente";

/* =====================================================================
   A vitrine
   ---------------------------------------------------------------------
   Três endereços, e só três: a vitrine aqui, a porta em /login e o
   sistema em /painel. Até 21/09/2026 a raiz ERA o painel, e quem
   digitasse o domínio puro batia numa tela de login sem nenhuma
   explicação do que havia atrás dela.

   O HERÓI É O ARTEFATO, NÃO UMA CAPTURA DE TELA. O que o Elo Hub
   produz não é um painel bonito — é a mensagem que chega no WhatsApp do
   cliente na segunda de manhã, com o PDF anexado. É isso que está no
   alto da página, em tamanho real.

   E ELE É MONTADO PELA FUNÇÃO DO ENVIO. `mensagemDoCliente` é a mesma
   que o orquestrador chama para despachar de verdade — ver
   `lib/reports/mensagem-do-cliente.ts`. Uma cópia do texto escrita à
   mão aqui envelheceria na primeira vez que a legenda mudasse, e a
   página passaria a prometer um formato que o produto não entrega
   mais. Foi o que aconteceu duas vezes DENTRO do produto, entre a tela
   e o envio; não vale repetir na vitrine.

   NÚMEROS DE EXEMPLO, E A PÁGINA DIZ ISSO. Não há conta de cliente
   real aqui, nem depoimento, nem "N agências usam" — nada que eu não
   possa provar. O período é o da última semana fechada, recalculado a
   cada hora, para o exemplo não envelhecer sozinho.

   FORA DO GOOGLE POR ENQUANTO. O layout raiz marca o site inteiro como
   `noindex` por ser painel interno, e esta página herda isso de
   propósito: publicar no índice de busca é decisão de quem vende, não
   de quem programa. Quando for a hora, é uma linha — `robots` no
   `metadata` abaixo.
   ===================================================================== */

export const metadata: Metadata = {
  title: "Elo Hub — a operação de mídia paga da agência",
  description:
    "Os números da Meta e do Google viram relatório em PDF e mensagem no WhatsApp do cliente. O robô prepara; a equipe confere e dispara.",
};

/* A janela do exemplo se refaz de hora em hora. Sem isto, a página
   nasceria congelada na data do build e em um mês estaria mostrando
   "setembro" em pleno outubro. */
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

export default function VitrinePage() {
  const { inicio, fim } = semanaFechada();

  /* A MESMA FUNÇÃO DO ENVIO, com números de exemplo. Ver o cabeçalho. */
  const exemplo = mensagemDoCliente({
    periodoLabel: formatPeriod(inicio, fim),
    dias: 7,
    cliente: "Cliente",
    numeros: [
      { label: "Investimento", valor: "R$ 1.480,00", origem: null },
      { label: "Pedidos", valor: "96", origem: null },
      { label: "Custo por pedido", valor: "R$ 15,42", origem: 1 },
    ],
  });

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
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
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3.5 text-sm font-medium transition-colors hover:border-signal hover:text-signal"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20">
        {/* ------------------------------ topo ------------------------ */}
        <section className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-14">
          <div>
            <span className="eyebrow">Operação de mídia paga</span>
            <h1 className="mt-3 text-3xl font-semibold leading-[1.12] tracking-tight sm:text-4xl lg:text-[2.75rem]">
              O relatório do cliente fica pronto antes de alguém acordar.
            </h1>
            <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
              O Elo Hub busca os números na Meta e no Google, monta o PDF e
              deixa a mensagem escrita. Na manhã do envio, a equipe confere e
              dispara pelo próprio WhatsApp — com o documento anexado.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Entrar no sistema
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#semana"
                className="inline-flex h-11 items-center px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Como funciona a semana
              </a>
            </div>
          </div>

          {/* O ARTEFATO. É a peça que a página existe para mostrar: o que
              sai do sistema e chega em quem está de fora. */}
          <figure className="surface-card p-4 sm:p-5">
            <figcaption className="eyebrow mb-3">
              O que chega ao cliente
            </figcaption>

            <div className="rounded-xl bg-surface-2/70 p-3">
              <div className="flex items-center gap-2.5 rounded-lg bg-background/70 p-2.5 ring-1 ring-hairline">
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

              <p className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {exemplo}
              </p>
            </div>

            <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">
              Exemplo, com números fictícios. O texto é montado pela mesma
              função que despacha os envios de verdade, e cada número sai do
              mesmo cartão que o PDF imprime — inclusive a ressalva de qual
              campanha ele veio.
            </p>
          </figure>
        </section>

        {/* --------------------------- o que sai ---------------------- */}
        <section className="border-t border-hairline py-12 sm:py-16">
          <span className="eyebrow">O que o sistema entrega</span>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                titulo: "Relatório semanal",
                texto:
                  "Capa com o resultado do período, evolução diária, quadro por plataforma, campanha a campanha, e os criativos que rodaram.",
              },
              {
                titulo: "Alertas de saldo",
                texto:
                  "As contas de anúncio são lidas direto na plataforma. O aviso chega antes de a campanha parar por falta de verba.",
              },
              {
                titulo: "A operação junto",
                texto:
                  "Tarefas, esteira de criação e pauta de conteúdo no mesmo lugar dos números — não em outra ferramenta.",
              },
            ].map((item) => (
              <article key={item.titulo} className="surface-card p-5">
                <h2 className="text-sm font-semibold">{item.titulo}</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.texto}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------- a semana ---------------------- */}
        {/* NUMERADO PORQUE É SEQUÊNCIA DE VERDADE: cada passo depende do
            anterior ter acontecido, e a ordem é a do relógio. */}
        <section id="semana" className="border-t border-hairline py-12 sm:py-16">
          <span className="eyebrow">A semana</span>
          <h2 className="mt-3 max-w-2xl text-xl font-semibold tracking-tight sm:text-2xl">
            O robô prepara. A pessoa decide.
          </h2>

          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {[
              {
                quando: "Madrugada do dia agendado",
                o_que:
                  "O robô soma o período na Meta e no Google, gera o PDF e deixa o relatório pronto na fila.",
              },
              {
                quando: "De manhã",
                o_que:
                  "A fila mostra o que está pronto, para qual grupo vai e o texto que acompanha. Dá para editar antes de enviar.",
              },
              {
                quando: "Um clique",
                o_que:
                  "Sai pelo WhatsApp de quem enviou, com o PDF anexado — não por um número de robô que o cliente não reconhece.",
              },
            ].map((passo, i) => (
              <li key={passo.quando} className="flex gap-3">
                <span className="mt-0.5 font-mono text-xs text-signal">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="block text-sm font-medium">
                    {passo.quando}
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                    {passo.o_que}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ----------------------------- entrar ----------------------- */}
        <section className="border-t border-hairline py-12 sm:py-16">
          <div className="surface-card flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Já tem acesso?
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                O acesso é da equipe e dos parceiros da Elo Marketing.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Entrar
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6">
          <span className="text-2xs text-muted-foreground">
            Elo Hub · Elo Marketing
          </span>
          <Link
            href="/login"
            className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Entrar
          </Link>
        </div>
      </footer>
    </div>
  );
}
