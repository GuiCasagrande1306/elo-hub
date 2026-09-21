/* =====================================================================
   Teste de mesa da unidade do resultado por campanha
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-objetivo-da-campanha.mts

   A tabela de campanhas do PDF imprimia sempre a conversão da CONTA.
   Numa conta de captação isso é conversa iniciada, e a campanha que
   compra visita ao perfil não gera nenhuma: medido na Meu Case,
   11–17/09/2026, "01 | ENGAJAMENTO INSTAGRAM" saiu com R$ 79,80 e
   resultado 0 — enquanto o card do criativo, duas seções abaixo no
   MESMO arquivo, mostrava 131 visitas.

   Os pares aqui são os medidos em produção (159 anúncios de 12 contas,
   01–24/08/2026, e as 40 contas de 19/08), mais os que a regra existe
   para separar. O destinatário é o cliente final — não há revisão
   depois.
   ===================================================================== */

import {
  unidadeDaCampanha,
  ROTULO_DA_UNIDADE,
  objetivoDoCriativo,
  vitrineDoCriativo,
} from "../src/lib/ads/creative-goal";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

/* --- os seis pares medidos em produção ------------------------------ */

ok("OUTCOME_ENGAGEMENT / PROFILE_AND_PAGE_ENGAGEMENT → visitas",
   unidadeDaCampanha("PROFILE_AND_PAGE_ENGAGEMENT", "OUTCOME_ENGAGEMENT"), "visitas");

ok("LINK_CLICKS / PROFILE_VISIT → visitas",
   unidadeDaCampanha("PROFILE_VISIT", "LINK_CLICKS"), "visitas");

ok("LINK_CLICKS / VISIT_INSTAGRAM_PROFILE → visitas",
   unidadeDaCampanha("VISIT_INSTAGRAM_PROFILE", "LINK_CLICKS"), "visitas");

ok("OUTCOME_AWARENESS / IMPRESSIONS → impressoes",
   unidadeDaCampanha("IMPRESSIONS", "OUTCOME_AWARENESS"), "impressoes");

ok("OUTCOME_SALES / OFFSITE_CONVERSIONS → conversao",
   unidadeDaCampanha("OFFSITE_CONVERSIONS", "OUTCOME_SALES"), "conversao");

ok("OUTCOME_ENGAGEMENT / REPLIES → conversao (a conversa É a conversão)",
   unidadeDaCampanha("REPLIES", "OUTCOME_ENGAGEMENT"), "conversao");

ok("LINK_CLICKS / LANDING_PAGE_VIEWS → cliques",
   unidadeDaCampanha("LANDING_PAGE_VIEWS", "LINK_CLICKS"), "cliques");

/* --- o que a regra existe para separar ------------------------------ */

/* LINK_CLICKS sozinho aparece em campanha de perfil E de site. Só a
   meta separa — é a mesma hierarquia de `vitrineDoCriativo`. */
ok("LINK_CLICKS sem meta cai em cliques, não em visitas",
   unidadeDaCampanha(null, "LINK_CLICKS"), "cliques");

/* Captação otimiza para conversão igual a uma campanha de venda, e a
   conversão da conta é o que se cobra dela. Sem este veto,
   OUTCOME_LEADS com meta de tráfego viraria "cliques". */
ok("OUTCOME_LEADS / LANDING_PAGE_VIEWS → conversao, não cliques",
   unidadeDaCampanha("LANDING_PAGE_VIEWS", "OUTCOME_LEADS"), "conversao");

ok("OUTCOME_LEADS / OFFSITE_CONVERSIONS → conversao",
   unidadeDaCampanha("OFFSITE_CONVERSIONS", "OUTCOME_LEADS"), "conversao");

/* O Google Ads não tem campo de objetivo: os dois chegam nulos, e a
   coluna tem de continuar imprimindo o que sempre imprimiu. */
ok("Google Ads (tudo nulo) → conversao",
   unidadeDaCampanha(null, null), "conversao");

/* "Unknown Optimization Goal" já vira nulo no provedor; string vazia
   cobre o resto. */
ok("strings vazias → conversao", unidadeDaCampanha("", ""), "conversao");

ok("REACH → impressoes", unidadeDaCampanha("REACH", "OUTCOME_AWARENESS"), "impressoes");
ok("AD_RECALL_LIFT → impressoes", unidadeDaCampanha("AD_RECALL_LIFT", null), "impressoes");

/* IMPRESSIONS é ancorado (^...$) para não casar com CONVERSIONS nem com
   OFFSITE_CONVERSIONS, que contêm a palavra por dentro. */
ok("OFFSITE_CONVERSIONS não é confundido com IMPRESSIONS",
   unidadeDaCampanha("OFFSITE_CONVERSIONS", null), "conversao");

/* --- coerência com as outras duas funções --------------------------- */

/* `vitrineDoCriativo` decide a vitrine do CARD do criativo com a mesma
   pergunta. Se as duas discordarem, o card e a tabela mostram números
   diferentes para a mesma campanha, no mesmo PDF — que é exatamente o
   defeito que esta mudança conserta. */
const paresDePerfil = [
  ["PROFILE_AND_PAGE_ENGAGEMENT", "OUTCOME_ENGAGEMENT"],
  ["PROFILE_VISIT", "LINK_CLICKS"],
  ["VISIT_INSTAGRAM_PROFILE", "LINK_CLICKS"],
] as const;

ok("tabela e card concordam sobre o que é campanha de perfil",
   paresDePerfil.map(([m, o]) => unidadeDaCampanha(m, o) === "visitas" && vitrineDoCriativo(m, o) === "perfil"),
   [true, true, true]);

/* O SELO E A UNIDADE SÃO PERGUNTAS DIFERENTES, e este caso é a prova:
   a campanha é de "Engajamento" (o selo do card), mas o número que
   prova que ela funcionou é a visita ao perfil. Rotular a coluna com o
   selo imprimiria "Engajamento: 131" sem dizer 131 do quê. */
ok("PROFILE_AND_PAGE_ENGAGEMENT: selo diz Engajamento…",
   objetivoDoCriativo("PROFILE_AND_PAGE_ENGAGEMENT", "OUTCOME_ENGAGEMENT"), "Engajamento");
ok("…e a unidade diz Visitas ao perfil",
   ROTULO_DA_UNIDADE[unidadeDaCampanha("PROFILE_AND_PAGE_ENGAGEMENT", "OUTCOME_ENGAGEMENT") as "visitas"],
   "Visitas ao perfil");

/* --- os rótulos que vão ao cliente ---------------------------------- */

ok("rótulos são texto em português, sem sigla",
   Object.values(ROTULO_DA_UNIDADE),
   ["Visitas ao perfil", "Impressões", "Cliques"]);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
