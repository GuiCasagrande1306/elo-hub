import { formatCurrency, formatNumber } from "@/lib/format";
import type { TrendPoint } from "@/lib/metrics/kpi";

/* =====================================================================
   O que o gráfico de série diária desenha
   ---------------------------------------------------------------------
   MÓDULO COMPARTILHADO PELOS DOIS RENDERIZADORES, e ele existe porque a
   divergência entre eles já custou caro quatro vezes nesta mesma seção:

     • o PDF desenhava pedidos e a folha A4 desenhava investimento
     • o PDF desenha uma barra por DIA e a folha agregava por SEMANA —
       num relatório de sete dias, sete barras contra uma
     • o PDF desenha até duas séries e a folha desenhava uma
     • o PDF titula a seção com `sections[].title` do template e a folha
       trazia "Evolução semanal · Investimento por semana" escrito no
       código, mesmo quando o gráfico mostrava contatos

   A folha A4 existe para a equipe conferir antes de enviar. Se ela
   mostra outro gráfico, a revisão aprova um arquivo e o cliente recebe
   outro — e ninguém descobre, porque os dois parecem certos
   isoladamente.

   PURO DE PROPÓSITO: sem `server-only`. A folha desenha com Recharts,
   que roda no navegador, e o PDF com react-pdf, no servidor. Um módulo
   marcado como servidor obrigaria a folha a receber tudo mastigado — e
   é justamente esse tipo de duplicação que produziu a lista acima.
   ===================================================================== */

export type SerieDoGrafico = "spend" | "results" | "revenue" | "cpa";

export const SERIES_VALIDAS: SerieDoGrafico[] = [
  "spend",
  "results",
  "revenue",
  "cpa",
];

export const ROTULO_DA_SERIE: Record<SerieDoGrafico, string> = {
  spend: "Investimento",
  results: "Resultados",
  revenue: "Faturamento",
  cpa: "Custo por resultado",
};

/**
 * As séries que o template pede, de `sections[].options.series`.
 *
 * ⚠️ ISSO JÁ FOI IGNORADO, e o título ficava mentindo. `SectionBody`
 * recebia só `section.type` e o gráfico desenhava `spend` sempre — em
 * TODOS os templates. Os quatro em produção pedem outra coisa:
 *
 *     delivery        "Pedidos por dia"        series: results
 *     leads           "Leads por dia"          series: results
 *     local_business  "Contatos por dia"       series: results
 *     ecommerce       "Investimento x receita" series: spend + revenue
 *
 * Ou seja, o PDF de qualquer conta de delivery saía com o título
 * "Pedidos por dia" sobre trinta barras cuja altura era o GASTO do dia,
 * e o único sinal disso era o "pico R$ 191,72" no eixo. O cliente lia o
 * pico de investimento de uma terça como pico de pedidos.
 *
 * `spend` como padrão para o template que não declarar nada: é o que o
 * gráfico sempre desenhou, então a ausência de `options` mantém o
 * comportamento antigo em vez de esvaziar a seção.
 *
 * DUAS NO MÁXIMO: são barras agrupadas dentro de uma moldura de 124pt
 * de altura e uma página A4 de largura. Com três, um período de trinta
 * dias dá noventa barras e nenhuma delas é legível.
 *
 * Sem opção nenhuma, `spend` — que é o que o gráfico sempre desenhou.
 */
export function seriesDoTemplate(
  options: Record<string, unknown> | undefined,
): SerieDoGrafico[] {
  const bruto = options?.series;
  if (!Array.isArray(bruto)) return ["spend"];

  const validas = bruto.filter((s): s is SerieDoGrafico =>
    SERIES_VALIDAS.includes(s as SerieDoGrafico),
  );

  return validas.length > 0 ? validas.slice(0, 2) : ["spend"];
}

/**
 * A seção de gráfico do template: as séries e o título.
 *
 * Existe para a folha A4, que parte das `sections` cruas do banco em
 * vez do payload já montado. O PDF chega no mesmo lugar por outro
 * caminho — `section.title` no laço de seções e `seriesDoTemplate` em
 * `SectionBody` —, e é esta função que garante que os dois concordem
 * quando o template mudar.
 */
export function graficoDoTemplate(sections: unknown): {
  series: SerieDoGrafico[];
  titulo: string | null;
} {
  const secao = Array.isArray(sections)
    ? (
        sections as {
          type?: string;
          title?: string;
          options?: Record<string, unknown>;
        }[]
      ).find((s) => s.type === "trend_chart")
    : null;

  return {
    series: seriesDoTemplate(secao?.options),
    titulo: secao?.title ?? null,
  };
}

/** `TrendPoint` guarda dinheiro em REAIS, não centavos. */
export function valorDaSerie(ponto: TrendPoint, s: SerieDoGrafico): number {
  return s === "spend"
    ? ponto.spend
    : s === "revenue"
      ? ponto.revenue
      : s === "cpa"
        ? ponto.cpa
        : ponto.results;
}

/**
 * Em que unidade esta série se mede.
 *
 * Decide o rótulo do eixo vertical e, antes disso, SE existe eixo: com
 * dinheiro e contagem na mesma escala não há número que sirva para as
 * duas.
 */
export function unidadeDaSerie(s: SerieDoGrafico): "dinheiro" | "contagem" {
  return s === "results" ? "contagem" : "dinheiro";
}

/** O valor por extenso, na unidade da série. */
export function formatarSerie(valor: number, s: SerieDoGrafico): string {
  return s === "results"
    ? formatNumber(Math.round(valor))
    : formatCurrency(Math.round(valor * 100));
}

/**
 * A unidade comum às séries desenhadas, ou `null` quando elas
 * discordam.
 *
 * `null` é o sinal de "não desenhe eixo numérico": as séries dividem um
 * quadro só, e um "200" na lateral não diria se são reais ou pedidos.
 */
export function unidadeComum(
  series: SerieDoGrafico[],
): "dinheiro" | "contagem" | null {
  const unidades = new Set(series.map(unidadeDaSerie));
  return unidades.size === 1 ? [...unidades][0] : null;
}
