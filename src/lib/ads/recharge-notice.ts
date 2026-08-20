import "server-only";

import { formatCurrency } from "@/lib/format";
import type { BalanceAlert } from "./balances";

/* =====================================================================
   O aviso de recarga que vai para o grupo do cliente
   ---------------------------------------------------------------------
   O QUE ELE NÃO FAZ: não gera Pix. Foi medido em 19/08/2026 — a Meta não
   expõe a recarga pela API. `funding`, `add_funds`, `prepay_funds`,
   `topup`, `payment_options` e `adspaymentmethods` são todos recusados,
   e o QR de "Adicionar fundos" nasce numa sessão de pagamento da web.

   Automatizar um navegador logado por lá seria possível e é justamente o
   que não se deve fazer: a página muda sem aviso, e no dia que mudar o
   robô manda um QR errado — ou nenhum, em silêncio — no grupo de um
   cliente.

   O que ele faz é levar o cliente ao lugar onde ELE gera o próprio Pix,
   com o número na mão: quanto tem, quanto gasta por dia, quanto falta e
   quanto recarregar.
   ===================================================================== */

/** Abaixo disto o cliente entra na fila de aviso. */
export const DIAS_PARA_AVISAR = 5;

/**
 * Quantos dias de fôlego a recarga sugerida compra.
 *
 * Quinze e não trinta: pedido menor passa mais fácil, e conta que
 * recarrega a cada quinze dias erra menos quando a verba muda de
 * patamar no meio do mês.
 */
const DIAS_DE_FOLEGO = 15;

/**
 * Link direto para a cobrança DAQUELA conta no gerenciador.
 *
 * O `asset_id` é o id numérico da conta, sem o prefixo `act_`. O
 * endereço é o mesmo que o gerenciador usa — sem ele, o cliente cai na
 * cobrança da primeira conta que a Meta escolher mostrar, que numa
 * pessoa com várias contas é a conta errada.
 */
export function linkDaCobranca(externalAccountId: string): string {
  const id = externalAccountId.replace(/\D/g, "");
  return (
    "https://adsmanager.facebook.com/adsmanager/billing_hub/accounts/details" +
    `?asset_id=${id}`
  );
}

/** Recarga sugerida: o ritmo diário vezes o fôlego, arredondado. */
export function recargaSugerida(burnRateCents: number): number {
  if (burnRateCents <= 0) return 0;

  /* Arredonda para dezena de reais. "R$ 374,70" parece cálculo de
     máquina e convida a discutir o centavo; "R$ 380,00" é um pedido. */
  const bruto = burnRateCents * DIAS_DE_FOLEGO;
  return Math.ceil(bruto / 1000) * 1000;
}

/**
 * A mensagem.
 *
 * Escrita para o CLIENTE, não para a equipe: sem jargão de mídia, sem
 * "burn rate", sem sigla. Ela precisa responder três perguntas na ordem
 * em que ele as faz — quanto tenho, quanto tempo dura, o que faço.
 */
export function mensagemDeRecarga(
  alert: BalanceAlert,
  externalAccountId: string,
): string {
  const sugerida = recargaSugerida(alert.burnRate);

  /* CONTA JÁ ZERADA NÃO "acaba hoje" — ela acabou. Medido na carteira:
     Brother Hood, Kalik e Sabores do Mar Praia estão em R$ 0,00 e sem
     gasto nos últimos sete dias, porque os anúncios já pararam. Dizer
     "deve acabar hoje" a um cliente cujo anúncio saiu do ar ontem é
     avisar tarde e ainda parecer desatento. */
  const zerada = (alert.currentBalance ?? 0) <= 0;

  const quanto = zerada
    ? "os anúncios já podem ter parado"
    : alert.daysLeft === null
      ? "está acabando"
      : alert.daysLeft === 0
        ? "deve acabar hoje"
        : alert.daysLeft === 1
          ? "dura mais 1 dia"
          : `dura mais ${alert.daysLeft} dias`;

  const linhas = [
    `Olá! Passando para avisar sobre o saldo da conta de anúncios.`,
    ``,
    `• Saldo disponível: ${formatCurrency(alert.currentBalance ?? 0)}`,
    `• Investimento médio: ${formatCurrency(alert.burnRate)} por dia`,
    zerada ? `• ${quanto}` : `• No ritmo atual, ${quanto}`,
    ``,
  ];

  /* Sem ritmo não há sugestão — e a conta parada é justamente onde o
     ritmo é zero, porque os sete dias de janela já são de anúncio fora
     do ar. Melhor não sugerir valor do que sugerir R$ 0,00. */
  if (sugerida > 0) {
    linhas.push(
      `Para não interromper os anúncios, sugerimos uma recarga de ` +
        `${formatCurrency(sugerida)} — cerca de ${DIAS_DE_FOLEGO} dias no ritmo atual.`,
      ``,
    );
  }

  linhas.push(
    `Você mesmo pode fazer, em "Adicionar fundos":`,
    linkDaCobranca(externalAccountId),
    ``,
    `Qualquer dúvida, é só chamar por aqui.`,
  );

  return linhas.join("\n");
}
