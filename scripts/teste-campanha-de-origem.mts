/* =====================================================================
   Teste de mesa da campanha de origem
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-campanha-de-origem.mts

   Trava a regra que decide de qual gasto sai o custo por resultado e o
   ROAS do relatório do cliente. Errar aqui não quebra nada — publica um
   número plausível e falso, que é o pior modo de falhar deste sistema.

   Os casos são os MEDIDOS em 25/08/2026 na carteira real, não hipóteses:
   a Satö que motivou a mudança, as duas contas que zerariam sem a rede
   de segurança, e o par (família da conversão × família da campanha) que
   só casa enquanto `creative-goal.ts` e `campanha-de-origem.ts`
   concordarem nos rótulos.
   ===================================================================== */

import {
  ehDeOrigem,
  familiasDeOrigem,
  totaisDeOrigem,
} from "../src/lib/ads/campanha-de-origem";
import { VISITA_AO_PERFIL } from "../src/lib/ads/conversion-action";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) falhas++;
  console.log(`${bate ? "ok  " : "FALHA"} ${nome}`);
  if (!bate) {
    console.log(`        esperado ${JSON.stringify(esperado)}`);
    console.log(`        veio     ${JSON.stringify(real)}`);
  }
};

const COMPRA = "offsite_conversion.fb_pixel_purchase";
const CONVERSA = "onsite_conversion.messaging_conversation_started_7d";

/* --- as famílias que cada conversão procura ------------------------- */
ok("compra procura Vendas", [...familiasDeOrigem([COMPRA])], ["Vendas"]);
ok("conversa procura Mensagens", [...familiasDeOrigem([CONVERSA])], ["Mensagens"]);
ok(
  "visita ao perfil não procura nada — toda campanha traz visita",
  [...familiasDeOrigem([VISITA_AO_PERFIL])],
  [],
);

/* --- a classificação de cada campanha ------------------------------- */
const vendas = familiasDeOrigem([COMPRA]);
const linha = (objective: string | null, goal: string | null, conv = 0) => ({
  objective,
  optimization_goal: goal,
  conversions: conv,
});

ok("campanha de venda entra", ehDeOrigem(linha("OUTCOME_SALES", "OFFSITE_CONVERSIONS"), vendas), true);
ok("reconhecimento fica de fora, mesmo tendo vendido", ehDeOrigem(linha("OUTCOME_AWARENESS", "REACH", 2), vendas), false);
ok("tráfego fica de fora", ehDeOrigem(linha("LINK_CLICKS", null), vendas), false);
ok("whatsapp fica de fora", ehDeOrigem(linha("OUTCOME_ENGAGEMENT", "REPLIES"), vendas), false);

/* NULO É "NÃO SEI", e o critério vira "produziu?". Cobre o Google Ads e
   a linha gravada antes da migration 69. */
ok("sem objetivo e sem resultado: fora", ehDeOrigem(linha(null, null, 0), vendas), false);
ok("sem objetivo mas produziu: entra", ehDeOrigem(linha(null, null, 3), vendas), true);

/* --- a Satö, com os números reais de 17–23/08/2026 ------------------ */
const c = (
  id: string,
  gasto: number,
  conv: number,
  receita: number,
  objective: string | null,
  goal: string | null,
) => ({
  campaign_id: id,
  spend_cents: gasto,
  conversions: conv,
  revenue_cents: receita,
  objective,
  optimization_goal: goal,
});

const sato = [
  c("04", 33508, 20, 413821, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
  c("03", 4000, 2, 33660, "OUTCOME_AWARENESS", null),
  c("01", 10666, 0, 0, "LINK_CLICKS", null),
  c("02", 6855, 0, 0, "OUTCOME_ENGAGEMENT", "REPLIES"),
];

const origemSato = totaisDeOrigem(sato, [COMPRA]);
ok("Satö: gasto de origem", origemSato.spendCents, 33508);
ok("Satö: campanhas", origemSato.campanhas, 1);
ok("Satö: isolou", origemSato.isolado, true);
ok(
  "Satö: custo por compra R$16,75",
  (origemSato.spendCents / origemSato.conversions / 100).toFixed(2),
  "16.75",
);
ok(
  "Satö: ROAS 12,35",
  (origemSato.revenueCents / origemSato.spendCents).toFixed(2),
  "12.35",
);

/* O mesmo conjunto, sem isolamento, é o número antigo. */
const tudo = totaisDeOrigem(sato, [VISITA_AO_PERFIL]);
ok("sem isolamento: gasto é a conta inteira", tudo.spendCents, 55029);
ok("sem isolamento: não marca selo", tudo.isolado, false);
ok(
  "sem isolamento: custo por compra R$25,01 (o número antigo)",
  (tudo.spendCents / tudo.conversions / 100).toFixed(2),
  "25.01",
);

/* --- a rede de segurança -------------------------------------------
   Istituto Burgo, medido: 196 conversas e nenhuma campanha de família
   "Mensagens" — os leads chegam por campanhas de engajamento. Sem a
   rede, o relatório do cliente mostraria custo "—". */
const burgo = [
  c("a", 80000, 120, 0, "OUTCOME_ENGAGEMENT", "PROFILE_AND_PAGE_ENGAGEMENT"),
  c("b", 66000, 76, 0, "OUTCOME_AWARENESS", "REACH"),
];
const origemBurgo = totaisDeOrigem(burgo, [CONVERSA]);
ok("origem vazia volta para a conta inteira", origemBurgo.spendCents, 146000);
ok("origem vazia não marca selo", origemBurgo.isolado, false);

/* Way Coonecta: a campanha de origem existe mas não converteu. */
const way = [
  c("a", 8100, 0, 0, "OUTCOME_ENGAGEMENT", "REPLIES"),
  c("b", 195600, 86, 0, "OUTCOME_AWARENESS", "REACH"),
];
const origemWay = totaisDeOrigem(way, [CONVERSA]);
ok("origem sem resultado volta para a conta inteira", origemWay.spendCents, 203700);
ok("origem sem resultado não marca selo", origemWay.isolado, false);

/* Conta em que TODA campanha é de venda: certo dos dois jeitos, e o
   selo não aparece — anunciá-lo sugeriria um corte que não houve. */
const soVenda = [
  c("a", 100000, 40, 500000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
  c("b", 104300, 38, 480000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
];
const origemSoVenda = totaisDeOrigem(soVenda, [COMPRA]);
ok("tudo é origem: soma tudo", origemSoVenda.spendCents, 204300);
ok("tudo é origem: sem selo", origemSoVenda.isolado, false);
ok("tudo é origem: duas campanhas", origemSoVenda.campanhas, 2);

/* --- a decisão é por CAMPANHA, não por linha -----------------------
   `daily_metrics` tem uma linha por DIA. Uma campanha sem objetivo (o
   Google, ou a linha ainda sem backfill) é julgada por "produziu o
   resultado?" — e julgar isso dia a dia recortava o gasto dela pelos
   dias bons, deixando o custo por resultado barato demais.

   Medido: a "04 | VENDAS" do Seu Parma ficou sem objetivo depois do
   backfill, com R$1.754 e 83 conversões em 51 dias. Nenhum desses dias
   é igual aos outros. */
const semObjetivoTresDias = [
  c("x", 50000, 0, 0, null, null), // dia sem conversão
  c("x", 30000, 5, 250000, null, null), // dia com conversão
  c("x", 20000, 0, 0, null, null), // outro dia sem
  c("y", 40000, 0, 0, "OUTCOME_AWARENESS", "REACH"),
];
const porCampanha = totaisDeOrigem(semObjetivoTresDias, [COMPRA]);
ok(
  "campanha sem objetivo entra INTEIRA quando produziu",
  porCampanha.spendCents,
  100000,
);
ok("e conta como uma campanha só", porCampanha.campanhas, 1);
ok("a de alcance continua fora", porCampanha.isolado, true);

/* O contrário: campanha sem objetivo que nunca converteu fica fora
   inteira, e não só nos dias ruins. */
const nuncaConverteu = [
  c("x", 50000, 0, 0, null, null),
  c("x", 30000, 0, 0, null, null),
  c("v", 60000, 10, 700000, "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
];
ok(
  "campanha sem objetivo que não produziu fica fora inteira",
  totaisDeOrigem(nuncaConverteu, [COMPRA]).spendCents,
  60000,
);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
