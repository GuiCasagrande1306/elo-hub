/* =====================================================================
   Que números o card de um anúncio deve mostrar
   ---------------------------------------------------------------------
   Módulo PURO de propósito: sem `server-only`, sem banco, sem rede. A
   regra decide o que o cliente lê no PDF, e uma regra que não pode ser
   executada num teste é uma regra que ninguém confere.
   ===================================================================== */

/** venda · perfil · genérica — ver `vitrineDoCriativo`. */
export type VitrineDoCriativo = "venda" | "perfil" | "generica";

/**
 * Que números o card deste anúncio deve mostrar.
 *
 * PRECISA DOS DOIS CAMPOS, e nesta ordem. `optimization_goal` é o que o
 * leilão de fato compra e é o discriminador bom — `objective` sozinho
 * engana nas duas direções:
 *
 *   • `LINK_CLICKS` é objetivo tanto de campanha de perfil quanto de
 *     campanha de site. Só a meta separa (`PROFILE_VISIT`).
 *   • `OUTCOME_SALES` aparece com meta `REPLIES`: a campanha compra
 *     conversa, não venda. Mostrar ROAS ali imprimiria zero com cara de
 *     fracasso no relatório do cliente.
 *
 * E O OBJETIVO AINDA VETA. `OUTCOME_LEADS / OFFSITE_CONVERSIONS` tem
 * meta de conversão mas a conversão é LEAD: o card diria "Vendas 12" e
 * "ROAS —" para uma captação. Objetivo de lead vai para a vitrine
 * genérica, onde "Resultados" é o rótulo honesto.
 *
 * Medido em 19/08/2026 sobre os 569 anúncios veiculados em julho:
 *
 *   perfil    213   PROFILE_VISIT, VISIT_INSTAGRAM_PROFILE,
 *                   PROFILE_AND_PAGE_ENGAGEMENT
 *   venda      94   OFFSITE_CONVERSIONS sem objetivo de lead
 *   genérica  262   REPLIES, REACH, IMPRESSIONS, LEAD_GENERATION…
 */
export function vitrineDoCriativo(
  optimizationGoal: string | null,
  objective: string | null,
): VitrineDoCriativo {
  const meta = optimizationGoal?.toUpperCase() ?? "";
  const objetivo = objective?.toUpperCase() ?? "";

  if (meta.includes("PROFILE")) return "perfil";

  // Captação não é venda, mesmo otimizando para conversão do pixel.
  if (objetivo.includes("LEAD")) return "generica";

  if (meta.endsWith("CONVERSIONS")) return "venda";

  /* Sem meta de otimização — conta antiga ou apuração que não veio —,
     o objetivo ainda separa venda do resto. */
  if (!meta && /SALES|CONVERSIONS/.test(objetivo)) return "venda";

  return "generica";
}
