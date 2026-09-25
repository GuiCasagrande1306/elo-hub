/* =====================================================================
   A escala do gráfico de série diária
   ---------------------------------------------------------------------
   O gráfico do PDF desenhava barras sem eixo vertical: dava para ver
   qual dia foi maior, não QUANTO foi. Um cliente olhando "Leads por
   dia" via duas barras altas e cinco rentes ao chão, e o único número
   da tela era "pico 2" escrito no meio do eixo horizontal.

   A folha A4 já tinha eixo, porque o Recharts desenha um sozinho — ou
   seja, a equipe revisava com escala e o cliente recebia sem. É a
   divergência entre os dois renderizadores que o projeto já pagou duas
   vezes para consertar.

   POR QUE ARREDONDAR O TOPO, e não usar o máximo do dado. Com o topo
   igual ao maior valor, a barra mais alta encosta na borda e o eixo
   imprime números como "R$ 191,72" e "R$ 95,86" — ninguém lê escala
   assim. Pior em contagem: metade de 5 leads é 2,5, e meio lead não
   existe. Arredondando para cima até um número redondo, as marcas
   ficam legíveis e a barra mais alta fica logo abaixo do topo, que é
   como um gráfico normalmente se lê.

   O CONJUNTO DE PASSOS É DELIBERADO. Só potências de dez dariam saltos
   grandes demais — um máximo de 12 viraria topo 20, com metade do
   quadro vazia. Os valores intermediários (2,5 · 3 · 4 · 6 · 8) mantêm
   o desperdício vertical abaixo de um terço em qualquer entrada.

   ⚠️ CONTAGEM NÃO ACEITA 2,5. Lead, pedido e visita são inteiros, e uma
   marca de meio lead desmente a própria unidade que ela rotula.
   ===================================================================== */

export type UnidadeDaEscala = "dinheiro" | "contagem";

export interface EscalaDoGrafico {
  /** O valor do topo do quadro. As barras são desenhadas contra ele. */
  topo: number;
  /**
   * As marcas, do topo para baixo, SEMPRE três: topo, meio e zero.
   *
   * Três e não cinco porque o quadro tem 124pt de altura e o rótulo
   * tem 7pt: com cinco, os números se encostam e a leitura piora em
   * vez de melhorar.
   */
  marcas: number[];
}

/**
 * Passos aceitáveis dentro de uma década.
 *
 * ⚠️ 1,2 E 1,5 EXISTEM PARA FECHAR O BURACO NO PÉ DA DÉCADA. Sem eles a
 * lista pula de 1 para 2, e um salto de 2× logo acima de uma potência
 * de dez desperdiça metade do quadro: medido, 21 leads davam topo 40 —
 * a barra mais alta na metade da altura, com o resto vazio.
 */
const PASSOS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/* ⚠️ A MESMA LISTA PARA AS DUAS UNIDADES, e isto foi medido depois de
   errar. Tirar o 2,5 da contagem parecia certo — meio lead não existe —,
   mas o passo vale DENTRO da década: 2,5 só é meio lead na década de 1,
   e ali ele nunca é escolhido, porque a base de contagem é inteira e os
   passos 1 e 2 vêm antes. Nas décadas acima ele vale 25, 250, 2.500,
   todos inteiros. Sem ele, a lista pulava de 2 para 3 e 41 leads davam
   topo 60 — quase metade do quadro vazia. */

/**
 * O menor passo da lista que alcança `valor`, na década dele.
 *
 * ⚠️ O RESULTADO É ARREDONDADO EM 12 DÍGITOS. `3 * 0.1` em ponto
 * flutuante dá 0.30000000000000004, e esse valor virava o topo do eixo:
 * uma escala de "R$ 0,6000000000000001" formatada de volta para
 * "R$ 0,60" ainda calcularia a altura das barras pelo número sujo.
 */
function arredondarParaCima(valor: number, passos: number[]): number {
  if (valor <= 0) return passos[0];

  const decada = Math.pow(10, Math.floor(Math.log10(valor)));
  const normalizado = valor / decada;

  for (const passo of passos) {
    /* A folga de 1e-9 pelo mesmo motivo: sem ela um valor que É o passo
       cai no próximo e a escala dobra sem nada explicando. */
    if (normalizado <= passo + 1e-9) {
      return Number((passo * decada).toPrecision(12));
    }
  }

  return Number((10 * decada).toPrecision(12));
}

/**
 * A escala para um máximo observado.
 *
 * `max` é o maior valor entre TODAS as séries desenhadas — elas
 * dividem um quadro só, e escalas separadas fariam duas barras de
 * mesma altura significarem números diferentes.
 */
export function escalaDoGrafico(
  max: number,
  unidade: UnidadeDaEscala,
): EscalaDoGrafico {
  const contagem = unidade === "contagem";

  /* O MEIO É QUE MANDA, não o topo. Arredondar o topo e dividir por
     dois traria de volta a marca quebrada que esta função existe para
     evitar: topo 5 dá meio 2,5. Arredondando o meio e dobrando, as três
     marcas saem redondas por construção. */

  /* ⚠️ CONTAGEM SOBE PARA INTEIRO ANTES DE PROCURAR O PASSO. Excluir o
     2,5 da lista não bastava: os passos valem DENTRO da década, e na
     década de 0,1 o passo 5 vira 0,5 — medido, 1 lead produzia as
     marcas 1 · 0,5 · 0. Partindo de um inteiro, a menor década
     possível é 1 e toda marca sai inteira. */
  const base = contagem ? Math.ceil(max / 2) : max / 2;
  const bruto = arredondarParaCima(base, PASSOS);

  /* A rede de segurança da contagem. Pela análise acima ela nunca
     dispara hoje; fica porque um passo novo na lista poderia quebrar a
     premissa em silêncio, e o sintoma seria "1,5 leads" impresso no
     eixo do PDF de um cliente. */
  const meio = contagem ? Math.ceil(bruto) : bruto;
  const topo = Number((meio * 2).toPrecision(12));

  return { topo, marcas: [topo, meio, 0] };
}
