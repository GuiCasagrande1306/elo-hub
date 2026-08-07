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

/**
 * Padrão por segmento — um CONJUNTO, não um evento só.
 *
 * A versão anterior escolhia um único `action_type`, e isso zerava
 * contas inteiras: o Instituto Life Mind gasta R$ 1.100 por mês e não
 * dispara um único `fb_pixel_lead`, porque os leads dele chegam por
 * WhatsApp. O painel mostrava 0 leads e custo por lead de R$ 0,00 — dado
 * plausível e falso.
 *
 * O QUE PODE SER SOMADO. Só eventos DISJUNTOS: quem preenche formulário
 * no site não é a mesma pessoa que abre conversa no Direct. Ficam de
 * fora, de propósito, os que se contêm — medido nesta conta:
 *
 *     129  onsite_conversion.total_messaging_connection   ⊃
 *     122  onsite_conversion.messaging_conversation_started_7d   ⊃
 *     117  onsite_conversion.messaging_first_reply
 *
 * Somar os três daria 368 "leads" onde existem 122 pessoas. É a mesma
 * armadilha de somar `actions` inteiro (lead + link_click +
 * landing_page_view), só que mais difícil de enxergar.
 */
const POR_SEGMENTO: Record<ClientSegment, readonly string[]> = {
  /* Compra registrada pelo pixel. É o evento que carrega `value`, e sem
     ele `action_values` volta vazio — some a receita e o ROAS junto. */
  ecommerce: ["offsite_conversion.fb_pixel_purchase"],

  /* Delivery fecha pedido no site ou no app: também é purchase. Contar
     `lead` aqui mediria intenção, não pedido faturado. */
  delivery: ["offsite_conversion.fb_pixel_purchase"],

  /* Captação: o formulário enviado é a conversão que se cobra. */
  leads: [
    // Formulário no site.
    "offsite_conversion.fb_pixel_lead",
    // Formulário nativo da Meta, sem sair do app.
    "onsite_conversion.lead_grouped",
    // WhatsApp, Direct e Messenger. `_7d` é a janela padrão da Meta.
    "onsite_conversion.messaging_conversation_started_7d",
  ],

  /* Negócio físico não tem carrinho — a conversão é a conversa que
     começa. `_7d` é a janela padrão da Meta para esse evento. */
  local_business: ["onsite_conversion.messaging_conversation_started_7d"],
};

/**
 * Quais `action_type` contam como conversão nesta conta.
 *
 * A escolha explícita ganha e vira conjunto de UM: override significa
 * "conte exatamente isto", e é o escape para pixel fora do comum.
 * Devolve sempre um array — o provider não deve ter que decidir isso.
 */
export function conversionActionFor(
  segment: ClientSegment | null | undefined,
  override: string | null | undefined,
): string[] {
  const escolhido = override?.trim();
  if (escolhido) return [escolhido];

  return [...(segment ? POR_SEGMENTO[segment] : POR_SEGMENTO.leads)];
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
