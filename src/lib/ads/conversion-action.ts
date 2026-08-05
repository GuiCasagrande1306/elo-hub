import type { ClientSegment } from "@/types/database";

/* =====================================================================
   Conversão por segmento
   ---------------------------------------------------------------------
   A Graph API devolve, em `actions`, TODOS os eventos do pixel de uma
   vez: view_content, add_to_cart, initiate_checkout, purchase, lead,
   link_click… Somar o array inteiro conta a mesma pessoa cinco vezes.
   É preciso escolher UM tipo, e o certo depende do que a conta vende.

   O padrão do código era `..._lead` para todo mundo. Numa loja virtual
   isso não acha nada e imprime "0 conversões, R$ 0,00 de receita" — o
   relatório fica plausível e errado, que é o pior resultado possível.

   Por isso o padrão passa a vir do SEGMENTO, que já está no cadastro do
   cliente e já decide o template do relatório. Quem tiver um pixel fora
   do comum sobrescreve por conta, em `client_integrations`.
   ===================================================================== */

/** Padrão por segmento. Sobrescrito por `conversion_action_type`. */
const POR_SEGMENTO: Record<ClientSegment, string> = {
  /* Compra registrada pelo pixel. É o evento que carrega `value`, e sem
     ele `action_values` volta vazio — some a receita e o ROAS junto. */
  ecommerce: "offsite_conversion.fb_pixel_purchase",

  /* Delivery fecha pedido no site ou no app: também é purchase. Contar
     `lead` aqui mediria intenção, não pedido faturado. */
  delivery: "offsite_conversion.fb_pixel_purchase",

  /* Captação: o formulário enviado é a conversão que se cobra. */
  leads: "offsite_conversion.fb_pixel_lead",

  /* Negócio físico não tem carrinho — a conversão é a conversa que
     começa. `_7d` é a janela padrão da Meta para esse evento. */
  local_business: "onsite_conversion.messaging_conversation_started_7d",
};

/**
 * Qual `action_type` conta como conversão nesta conta.
 *
 * A escolha explícita ganha; o segmento é o padrão. Devolve sempre uma
 * string — o provider não deve ter que decidir isso.
 */
export function conversionActionFor(
  segment: ClientSegment | null | undefined,
  override: string | null | undefined,
): string {
  const escolhido = override?.trim();
  if (escolhido) return escolhido;

  return segment ? POR_SEGMENTO[segment] : POR_SEGMENTO.leads;
}

/** Opções para o seletor da tela, na ordem em que fazem sentido ler. */
export const CONVERSION_ACTION_OPTIONS = [
  {
    value: "offsite_conversion.fb_pixel_purchase",
    label: "Compra (pixel)",
    hint: "loja virtual e delivery — traz receita e ROAS",
  },
  {
    value: "offsite_conversion.fb_pixel_lead",
    label: "Lead (pixel)",
    hint: "formulário enviado no site",
  },
  {
    value: "onsite_conversion.messaging_conversation_started_7d",
    label: "Conversa iniciada",
    hint: "WhatsApp, Messenger e Direct",
  },
  {
    value: "offsite_conversion.fb_pixel_complete_registration",
    label: "Cadastro concluído",
    hint: "criação de conta",
  },
  {
    value: "offsite_conversion.fb_pixel_initiate_checkout",
    label: "Checkout iniciado",
    hint: "quando a compra não é rastreada até o fim",
  },
  {
    value: "landing_page_view",
    label: "Visita à landing page",
    hint: "último recurso — não é conversão de verdade",
  },
] as const;
