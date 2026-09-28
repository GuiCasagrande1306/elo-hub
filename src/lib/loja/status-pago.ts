/* =====================================================================
   O que conta como pedido pago
   ---------------------------------------------------------------------
   PURO DE PROPÓSITO: sem `server-only`. É a regra que decide o
   faturamento que vai ao cliente, e regra dessas precisa de teste de
   mesa — ver `scripts/teste-status-pago.mts`. Mesma razão de
   `reports/serie-do-grafico.ts` e `ads/miniaturas.ts`.

   A REGRA: pago é TUDO MENOS "Em Análise" e "Cancelado".

   Confirmada pelo Guilherme em 28/09/2026 e, mais importante,
   CONFERIDA CONTRA O PAINEL DA LOJA: setembro/2026 do Atacado de Pratas
   fechou em 150 pedidos e R$ 88.367,99 pelos dois caminhos — o nosso
   cálculo e o gráfico "Faturamento confirmados por mês" da Magazord —
   centavo a centavo. O que a loja chama de "confirmado" é exatamente
   esta regra.

   ⚠️ "EM ANÁLISE" É PEDIDO SEM PAGAMENTO, não pedido sob revisão nossa.
   O painel da loja tem a opção "Cancelar automaticamente pedidos sem
   pagamento" com o campo "dias para cancelar pedidos em análise" — ou
   seja, é o limbo do boleto e do PIX não pagos. Contá-lo como
   faturamento seria contar dinheiro que ainda pode não entrar; em
   setembro foram 6 pedidos e R$ 3.175,94.

   ⚠️ OS IDS SÃO CONFIGURÁVEIS POR LOJA. Estes são os do Atacado de
   Pratas, lidos em Configurar → Status de Pedidos. Outra loja pode
   numerar diferente, e por isso a exclusão também casa pela DESCRIÇÃO:
   um `id` que mude de significado numa loja nova produziria faturamento
   errado em silêncio, que é o pior desfecho possível aqui.
   ===================================================================== */

/** Os nove status do Atacado de Pratas, para referência e teste. */
export const STATUS_DA_LOJA: Record<number, string> = {
  1: "Em Análise",
  2: "Confirmado",
  3: "Concluído/Enviado",
  4: "Cancelado",
  5: "Em Preparação",
  6: "Faturado",
  7: "Aguardando Retirada",
  8: "Em Entrega",
  9: "Entregue",
};

/** Ids que NÃO contam como pago, na numeração padrão da plataforma. */
const IDS_FORA = new Set([1, 4]);

/**
 * Descrições que não contam, em minúsculas e sem acento.
 *
 * A rede de segurança para loja com numeração diferente — ver a nota do
 * cabeçalho. Casar por descrição sozinho seria frágil (alguém renomeia
 * "Cancelado" para "Cancelado pelo cliente"), então vale o `startsWith`.
 */
const DESCRICOES_FORA = ["em analise", "cancelad"];

export interface StatusDoPedido {
  /** A Magazord devolve `status` como OBJETO, não como número. */
  id?: number | null;
  descricao?: string | null;
}

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Este pedido entra no faturamento?
 *
 * ⚠️ NA DÚVIDA, NÃO CONTA. Status ausente ou irreconhecível devolve
 * `false`: deixar de fora um pedido pago subestima o faturamento, o que
 * é visível e questionável; incluir um cancelado infla o número que a
 * agência apresenta como resultado, e ninguém confere.
 */
export function pedidoEstaPago(status: StatusDoPedido | null | undefined): boolean {
  if (!status) return false;

  const { id, descricao } = status;

  if (typeof id === "number" && IDS_FORA.has(id)) return false;

  if (descricao) {
    const d = semAcento(descricao);
    if (DESCRICOES_FORA.some((fora) => d.startsWith(fora))) return false;
  }

  /* Sem id numérico E sem descrição não há o que avaliar. */
  return typeof id === "number" || Boolean(descricao);
}

/**
 * O ticket médio.
 *
 * ⚠️ `null` SEM PEDIDO, e não zero. "R$ 0,00 de ticket médio" afirma que
 * cada venda saiu de graça; a ausência de vendas não tem ticket. O
 * relatório imprime um traço.
 */
export function ticketMedio(
  receitaCents: number,
  pedidosPagos: number,
): number | null {
  if (pedidosPagos <= 0) return null;
  return Math.round(receitaCents / pedidosPagos);
}
