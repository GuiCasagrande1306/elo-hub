/* =====================================================================
   Teste de mesa do plano da folha
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-plano-do-relatorio.mts

   ⚠️ O QUE ESTE ARQUIVO PROTEGE É A ALTURA DA PÁGINA. O relatório sai
   numa página só, de altura calculada: se a soma erra, a folha termina
   com um palmo de branco ou corta a última tabela ao meio — e os dois
   defeitos chegam ao cliente, porque ninguém confere um PDF que
   "abriu".

   A asserção central é a última: a altura da folha é EXATAMENTE a soma
   dos blocos mais os respiros. Nada de arredondar, nada de folga.
   ===================================================================== */

import {
  ALTURA,
  LARGURA_DA_FOLHA,
  MAX_ANUNCIOS,
  fatiarEmFileiras,
  planoDoRelatorio,
  truncar,
} from "../src/lib/reports/pdf/plano";
import type { ReportPayload } from "../src/lib/reports/payload";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const kpi = (key: string, label = key) =>
  ({ key, label, formatted: "1", indefinido: false }) as never;

const payload = (p: Partial<ReportPayload>): ReportPayload =>
  ({ platformDetail: [], creatives: [], trend: [], ...p }) as ReportPayload;

/* --- fatiar em fileiras ---------------------------------------------- */

ok("quatro KPIs = uma fileira", fatiarEmFileiras([1, 2, 3, 4]).length, 1);
ok("cinco KPIs = duas fileiras", fatiarEmFileiras([1, 2, 3, 4, 5]).length, 2);
ok("oito KPIs = duas fileiras", fatiarEmFileiras([1, 2, 3, 4, 5, 6, 7, 8]).length, 2);
ok("nenhum KPI = nenhuma fileira", fatiarEmFileiras([]).length, 0);

/* --- truncar ---------------------------------------------------------- */

ok("texto curto passa inteiro", truncar("Campanha", 20), "Campanha");
ok("texto longo ganha reticência", truncar("Campanha de reconhecimento regional", 14), "Campanha de r…");
ok("nulo vira vazio", truncar(null, 10), "");
ok(
  "⚠️ o resultado nunca passa do limite — é o que protege a altura",
  truncar("a".repeat(100), 12).length <= 12,
  true,
);

/* --- a folha mais simples possível ------------------------------------ */

const vazio = planoDoRelatorio(payload({}));
ok("sem plataforma, sobram capa e rodapé", vazio.blocos.map((b) => b.tipo), ["capa", "rodape"]);
ok(
  "e a altura é capa + rodapé + um respiro",
  vazio.altura,
  ALTURA.capa + ALTURA.rodape + ALTURA.respiro,
);

/* --- uma plataforma --------------------------------------------------- */

const umaPlataforma = planoDoRelatorio(
  payload({
    platformDetail: [
      { platform: "meta_ads", label: "Meta Ads", spendShare: 1, kpis: [kpi("spend"), kpi("clicks")], campaigns: [] },
    ] as never,
  }),
);
const cartao = umaPlataforma.blocos.find((b) => b.tipo === "plataforma")!;
ok("uma fileira de KPI", cartao.tipo === "plataforma" && cartao.fileiras.length, 1);
/* `spend` e `clicks` são degraus do funil, então o cartão carrega o
   título do funil e dois degraus além da fileira de KPI. A primeira
   versão deste teste esqueceu isso e acusou o código — a conta estava
   certa, a expectativa é que estava curta. */
ok(
  "altura do cartão = filete + recheio + cabeçalho + fileira + funil",
  cartao.altura,
  ALTURA.filete +
    ALTURA.recheioDoCartao +
    ALTURA.cabecalhoDaPlataforma +
    ALTURA.fileiraDeKpi +
    ALTURA.tituloDeBloco +
    2 * ALTURA.degrauDoFunil,
);

/* --- ⚠️ o gráfico não soma quando há duas fileiras -------------------- */

const comGrafico = (qtdKpis: number) =>
  planoDoRelatorio(
    payload({
      trend: [{ date: "2026-09-01" }, { date: "2026-09-02" }] as never,
      platformDetail: [
        {
          platform: "meta_ads", label: "Meta Ads", spendShare: 1,
          kpis: Array.from({ length: qtdKpis }, (_, i) => kpi(`k${i}`)),
          campaigns: [],
        },
      ] as never,
    }),
  ).blocos.find((b) => b.tipo === "plataforma")!;

const umaFileira = comGrafico(3);
const duasFileiras = comGrafico(6);
ok(
  "com UMA fileira, o gráfico soma altura própria",
  umaFileira.altura - (ALTURA.filete + ALTURA.recheioDoCartao + ALTURA.cabecalhoDaPlataforma + ALTURA.fileiraDeKpi),
  ALTURA.grafico,
);
ok(
  "⚠️ com DUAS fileiras o gráfico ocupa o vazio à direita e NÃO soma",
  duasFileiras.altura,
  ALTURA.filete + ALTURA.recheioDoCartao + ALTURA.cabecalhoDaPlataforma + 2 * ALTURA.fileiraDeKpi,
);

/* --- o funil só conta degrau apurado ---------------------------------- */

const comFunil = planoDoRelatorio(
  payload({
    platformDetail: [
      {
        platform: "meta_ads", label: "Meta Ads", spendShare: 1,
        kpis: [
          kpi("spend", "Investido"),
          kpi("impressions", "Impressões"),
          { key: "reach", label: "Alcance", formatted: "—", indefinido: true } as never,
          kpi("clicks", "Cliques"),
        ],
        campaigns: [],
      },
    ] as never,
  }),
).blocos.find((b) => b.tipo === "plataforma")!;
ok(
  "⚠️ degrau sem dado fica FORA do funil",
  comFunil.tipo === "plataforma" && comFunil.funil.map((d) => d.rotulo),
  ["Investido", "Impressões", "Cliques"],
);

/* --- tabelas têm teto -------------------------------------------------- */

const muitosAnuncios = planoDoRelatorio(
  payload({ creatives: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })) as never }),
).blocos.find((b) => b.tipo === "anuncios")!;
ok(
  "a tabela de anúncios para no teto",
  muitosAnuncios.tipo === "anuncios" && muitosAnuncios.anuncios.length,
  MAX_ANUNCIOS,
);

/* --- ⚠️ A ASSERÇÃO CENTRAL -------------------------------------------- */

const completo = planoDoRelatorio(
  payload({
    trend: [{ date: "1" }, { date: "2" }] as never,
    platformDetail: [
      { platform: "meta_ads", label: "Meta", spendShare: 0.7, kpis: [kpi("spend"), kpi("clicks"), kpi("impressions")], campaigns: [{ name: "a" }, { name: "b" }] },
      { platform: "google_ads", label: "Google", spendShare: 0.3, kpis: [kpi("spend")], campaigns: [] },
    ] as never,
    creatives: [{ id: "1" }, { id: "2" }] as never,
  }),
);
const soma = completo.blocos.reduce((a, b) => a + b.altura, 0);
const respiros = (completo.blocos.length - 1) * ALTURA.respiro;
ok(
  "⚠️ a altura da folha é EXATAMENTE a soma dos blocos + respiros",
  completo.altura,
  soma + respiros,
);
ok("nenhum bloco tem altura zero ou negativa", completo.blocos.every((b) => b.altura > 0), true);
ok("a ordem é capa → plataformas → anúncios → rodapé", completo.blocos.map((b) => b.tipo), [
  "capa", "plataforma", "plataforma", "anuncios", "rodape",
]);
ok("a largura é a do Reportei", LARGURA_DA_FOLHA, 1080);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
