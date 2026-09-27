import { formatCurrency, formatNumber } from "@/lib/format";
import type { TotaisDoPeriodo } from "./totais-do-periodo";

/* =====================================================================
   A folha contínua: largura e funil
   ---------------------------------------------------------------------
   PURO DE PROPÓSITO: sem `server-only`. A página desenha isto no
   servidor, o Puppeteer mede a mesma largura na hora de imprimir, e o
   teste de mesa precisa importar as etapas sem subir meio Next junto.
   É a mesma razão de `serie-do-grafico.ts` e `aviso-da-coleta.ts`.
   ===================================================================== */

/**
 * A largura da folha, em pixels de CSS.
 *
 * ⚠️ UM NÚMERO SÓ, e ele é lido em dois lugares: o `style` da página e o
 * `page.pdf({ width })` do Puppeteer. Divergindo, o PDF sai com faixa
 * branca à direita ou com o conteúdo cortado — e nada na tela denuncia,
 * porque o navegador continua desenhando certo.
 *
 * 1080 porque é a largura em que o documento é lido: mandado por
 * WhatsApp e aberto no celular. Mais estreito, a tabela de anúncios não
 * cabe; mais largo, o texto vira linha longa demais quando alguém abre
 * no computador.
 */
export const LARGURA_DA_FOLHA = 1080;

/** Respiro lateral das seções. Espelha o `px-16` do Tailwind (64px). */
export const MARGEM_LATERAL = 64;

/** Largura da coluna do funil, ao lado do gráfico. */
export const COLUNA_DO_FUNIL = 360;

/** Espaço entre o funil e o gráfico. Espelha o `gap-10` (40px). */
export const ESPACO_ENTRE_COLUNAS = 40;

/**
 * A largura do gráfico, EM PIXELS E CALCULADA — nunca digitada.
 *
 * ⚠️ O gráfico não usa `ResponsiveContainer`: ele mede o pai com
 * ResizeObserver e, num navegador headless, a medição às vezes acontece
 * antes do layout estabilizar e o gráfico sai com 0px — página em branco
 * no PDF, sem erro nenhum. Por isso a largura é fixa.
 *
 * E por ser fixa, ela PRECISA sair desta conta. Medido em 27/09/2026: o
 * gráfico estava com 620px digitados à mão numa coluna de 512, e
 * transbordava 54px além da folha. Na tela não se via — o navegador
 * ganha barra de rolagem —, mas o Puppeteer corta no limite da página e
 * o eixo da direita sumiria do documento do cliente.
 */
export const LARGURA_DO_GRAFICO =
  LARGURA_DA_FOLHA -
  MARGEM_LATERAL * 2 -
  COLUNA_DO_FUNIL -
  ESPACO_ENTRE_COLUNAS;

export interface EtapaDoFunil {
  rotulo: string;
  valor: string;
  /**
   * Quanto do passo anterior chegou aqui, como FRAÇÃO (0,0697 = 6,97%).
   *
   * ⚠️ FRAÇÃO E NÃO PORCENTAGEM, porque é o contrato de `formatPercent`
   * — que multiplica por 100 sozinho. A primeira versão devolvia
   * porcentagem e o funil imprimiu "696,7% seguem para a próxima etapa"
   * onde o certo era 6,97%. Um número cem vezes maior, com cara de
   * número, no documento do cliente.
   *
   * `null` quando a comparação não significa nada — de reais para
   * impressões não há taxa, e de impressões para alcance é
   * desduplicação, não perda.
   */
  taxa: number | null;
}

/**
 * As etapas do funil, na ordem em que se lê um relatório de mídia.
 *
 * ⚠️ O FUNIL ENCOLHE CONFORME O DADO EXISTE. Alcance e cliques no link
 * só entram quando `totais` foi apurado pela Graph API; sem isso o funil
 * sai com quatro etapas em vez de seis, em vez de exibir dois zeros no
 * meio. Zero num funil não é um buraco visual — é a afirmação de que
 * ninguém foi alcançado, que é diferente de "não medimos".
 *
 * A taxa entre etapas só é calculada entre grandezas comparáveis:
 *
 *   investimento → impressões   sem taxa (reais não viram impressões)
 *   impressões   → alcance      sem taxa (é desduplicação, não perda)
 *   alcance      → cliques      COM taxa
 *   cliques      → cliques no link  COM taxa
 *   cliques link → resultados   COM taxa
 *
 * Sem esse cuidado o documento imprimiria "0,3% seguem para a próxima
 * etapa" embaixo do investimento, que não quer dizer nada.
 */
export function etapasDoFunil(input: {
  spendCents: number;
  resultados: number;
  impressoes: number;
  cliques: number;
  totais: TotaisDoPeriodo | null;
}): EtapaDoFunil[] {
  const { spendCents, resultados, totais } = input;

  /* QUANDO A API RESPONDEU, os números dela mandam — inclusive
     impressões e cliques. Misturar a impressão vinda de `daily_metrics`
     com o alcance vindo da API produziria uma frequência que não bate
     com a divisão dos dois na mesma folha, e é o tipo de contradição que
     o cliente encontra antes da gente. */
  const impressoes = totais?.impressions ?? input.impressoes;
  const cliques = totais?.clicks ?? input.cliques;

  const etapas: EtapaDoFunil[] = [
    {
      rotulo: "Investimento",
      valor: formatCurrency(spendCents),
      taxa: null,
    },
    {
      rotulo: "Impressões",
      valor: formatNumber(impressoes),
      taxa: null,
    },
  ];

  if (totais) {
    etapas.push({
      rotulo: "Alcance",
      valor: formatNumber(totais.reach),
      // Impressões → alcance é desduplicação, não perda de funil.
      taxa: null,
    });
  }

  etapas.push({
    rotulo: "Cliques",
    valor: formatNumber(cliques),
    taxa: taxaEntre(cliques, totais ? totais.reach : impressoes),
  });

  if (totais) {
    etapas.push({
      rotulo: "Cliques no link",
      valor: formatNumber(totais.linkClicks),
      taxa: taxaEntre(totais.linkClicks, cliques),
    });
  }

  etapas.push({
    rotulo: "Resultados",
    valor: formatNumber(resultados),
    taxa: taxaEntre(
      resultados,
      totais ? totais.linkClicks : cliques,
    ),
  });

  /* A TAXA MORA NA ETAPA DE CIMA, não na de baixo: ela é lida entre as
     duas faixas, e quem a produz é a passagem. Calcular na etapa
     seguinte e exibir na anterior é o mesmo número, mas deslocar aqui
     evita que a última faixa imprima uma taxa sem destino. */
  return etapas.map((e, i) => ({
    ...e,
    taxa: etapas[i + 1]?.taxa ?? null,
  }));
}

/**
 * A fração de `total` que `parte` representa.
 *
 * `null` sem denominador: divisão por zero viraria `Infinity` impresso.
 * SEM multiplicar por 100 — ver a nota em `EtapaDoFunil.taxa`.
 */
function taxaEntre(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return parte / total;
}
