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

/* =====================================================================
   O objetivo da campanha, na língua do cliente
   ---------------------------------------------------------------------
   O card do PDF mostrava `platformLabel · campaignName`, e o nome da
   campanha é NULO nos 461 criativos ativos do banco — conferido em
   24/08/2026. Na prática todo cartão dizia "META ADS · —": um traço
   ocupando o lugar da informação que responde "por que esse anúncio
   entregou isso?".

   O objetivo resolve, e ele existe: chega vivo da API de insights em
   `objective` e `optimization_goal`, os mesmos dois campos que
   `vitrineDoCriativo` já usa para escolher as métricas do card.

   A META MANDA, o objetivo é desempate — mesma hierarquia da função
   acima, e pelo mesmo motivo: `LINK_CLICKS` aparece tanto em campanha
   de perfil quanto de site, e só a meta separa.

   MEDIDO EM 159 ANÚNCIOS de 12 contas, 01 a 24/08/2026. Seis pares, e
   nenhum outro:

       48  OUTCOME_AWARENESS   / IMPRESSIONS
       44  OUTCOME_ENGAGEMENT  / PROFILE_AND_PAGE_ENGAGEMENT
       23  LINK_CLICKS         / PROFILE_VISIT
       19  OUTCOME_SALES       / OFFSITE_CONVERSIONS
       13  OUTCOME_ENGAGEMENT  / REPLIES
       12  LINK_CLICKS         / LANDING_PAGE_VIEWS

   O mapa cobre esses seis e mais os vizinhos previsíveis. O que não
   casar cai em `null`, e o card omite o selo em vez de imprimir uma
   sigla em inglês no documento do cliente.
   ===================================================================== */

const POR_META: [RegExp, string][] = [
  [/PROFILE_VISIT|VISIT_INSTAGRAM_PROFILE/, "Visitas ao perfil"],
  [/PROFILE_AND_PAGE_ENGAGEMENT|POST_ENGAGEMENT|PAGE_LIKES/, "Engajamento"],
  [/REPLIES|CONVERSATIONS|MESSAGING/, "Mensagens"],
  [/LEAD_GENERATION|QUALITY_LEAD|QUALITY_CALL/, "Cadastros"],
  [/LANDING_PAGE_VIEWS|LINK_CLICKS/, "Tráfego"],
  [/THRUPLAY|VIDEO_VIEWS/, "Visualizações"],
  [/^IMPRESSIONS$|REACH|AD_RECALL_LIFT/, "Alcance"],
  [/OFFSITE_CONVERSIONS|ONSITE_CONVERSIONS|VALUE|PURCHASE/, "Vendas"],
];

const POR_OBJETIVO: [RegExp, string][] = [
  [/SALES|CONVERSIONS/, "Vendas"],
  [/LEADS/, "Cadastros"],
  [/ENGAGEMENT/, "Engajamento"],
  [/TRAFFIC|LINK_CLICKS/, "Tráfego"],
  [/AWARENESS|REACH|BRAND/, "Alcance"],
  [/APP/, "Instalações"],
];

/**
 * "Vendas", "Visitas ao perfil", "Alcance"… `null` quando não dá para
 * afirmar.
 *
 * ⚠️ CADASTRO VENCE VENDA quando o objetivo é de lead. Uma campanha de
 * captação otimiza para `OFFSITE_CONVERSIONS` igual a uma de venda — a
 * conversão é que é outra. Sem este veto o relatório de uma clínica
 * diria "Vendas" para um formulário preenchido, e é a mesma armadilha
 * que `vitrineDoCriativo` desarma logo acima.
 */
export function objetivoDoCriativo(
  optimizationGoal: string | null,
  objective: string | null,
): string | null {
  const meta = optimizationGoal?.toUpperCase() ?? "";
  const objetivo = objective?.toUpperCase() ?? "";

  if (meta && /CONVERSIONS/.test(meta) && /LEAD/.test(objetivo)) {
    return "Cadastros";
  }

  for (const [padrao, rotulo] of POR_META) {
    if (padrao.test(meta)) return rotulo;
  }

  for (const [padrao, rotulo] of POR_OBJETIVO) {
    if (padrao.test(objetivo)) return rotulo;
  }

  return null;
}
