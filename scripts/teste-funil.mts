/* =====================================================================
   Teste de mesa do funil do relatório
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-funil.mts

   O funil vai impresso no documento que o cliente abre. O que se testa
   aqui não é desenho: é UNIDADE e OMISSÃO.

   UNIDADE, porque a primeira versão devolvia porcentagem para uma
   função que espera fração, e o relatório imprimiu "696,7% seguem para
   a próxima etapa" onde o certo era 6,97%. Passou pela revisão de
   tipos, pela compilação e pela tela — só caiu quando alguém conferiu o
   número contra a divisão à mão.

   OMISSÃO, porque alcance e cliques no link só existem quando a Graph
   API respondeu. Sem isso o funil tem de ENCOLHER, nunca imprimir zero:
   "Alcance 0" afirma que ninguém foi atingido, que é diferente de "não
   medimos".
   ===================================================================== */

import { etapasDoFunil } from "../src/lib/reports/rolagem";

let falhas = 0;
const ok = (nome: string, condicao: boolean, detalhe?: string) => {
  if (!condicao) {
    falhas++;
    console.log(`✗ ${nome}${detalhe ? `\n   ${detalhe}` : ""}`);
  } else console.log(`✓ ${nome}`);
};

const TOTAIS = {
  reach: 18_430,
  frequency: 2.37,
  impressions: 43_679,
  clicks: 1_284,
  linkClicks: 862,
  pageEngagement: 3_105,
  spendCents: 539_627,
};

const base = {
  spendCents: 539_627,
  resultados: 61,
  impressoes: 43_679,
  cliques: 1_284,
};

/* --- unidade: o defeito de 27/09/2026 -------------------------------- */

const completo = etapasDoFunil({ ...base, totais: TOTAIS });
const porRotulo = (r: string) => completo.find((e) => e.rotulo === r);

/* A taxa aparece SOB a etapa e descreve a passagem para a seguinte.
   Sob "Alcance" está alcance → cliques: 1.284 / 18.430. */
const alcance = porRotulo("Alcance")!;
ok(
  "a taxa é FRAÇÃO, não porcentagem",
  Math.abs((alcance.taxa ?? 0) - 1284 / 18430) < 1e-9,
  `esperado ~0,0697 · recebido ${alcance.taxa}`,
);
ok(
  "nenhuma taxa passa de 1 quando a etapa só encolhe",
  completo.every((e) => e.taxa === null || e.taxa <= 1),
  JSON.stringify(completo.map((e) => [e.rotulo, e.taxa])),
);

/* --- as taxas ligam as etapas certas --------------------------------- */

ok(
  "cliques → cliques no link",
  Math.abs((porRotulo("Cliques")!.taxa ?? 0) - 862 / 1284) < 1e-9,
);
ok(
  "cliques no link → resultados",
  Math.abs((porRotulo("Cliques no link")!.taxa ?? 0) - 61 / 862) < 1e-9,
);

/* --- onde a taxa NÃO pode existir ------------------------------------ */
/* Reais não viram impressões, e impressões → alcance é desduplicação:
   imprimir "42% seguem para a próxima etapa" ali seria inventar uma
   perda que não aconteceu. */

ok("investimento não tem taxa", porRotulo("Investimento")!.taxa === null);
ok("impressões → alcance não tem taxa", porRotulo("Impressões")!.taxa === null);
ok(
  "a última etapa não tem taxa",
  completo[completo.length - 1].taxa === null,
);

/* --- sem apuração, o funil ENCOLHE ----------------------------------- */

const curto = etapasDoFunil({ ...base, totais: null });
const rotulos = curto.map((e) => e.rotulo);

ok("sem totais, 4 etapas", curto.length === 4, rotulos.join(" · "));
ok("sem totais, nenhum alcance", !rotulos.includes("Alcance"));
ok("sem totais, nenhum clique no link", !rotulos.includes("Cliques no link"));
ok(
  "sem totais, nenhuma etapa imprime zero inventado",
  !curto.some((e) => e.valor === "0" && e.rotulo !== "Resultados"),
);
ok(
  "sem totais, a taxa parte das impressões",
  Math.abs((curto[1].taxa ?? 0) - 1284 / 43679) < 1e-9,
);

/* --- conta que não veiculou ------------------------------------------ */
/* Divisão por zero viraria Infinity impresso como "∞%". */

const zerado = etapasDoFunil({
  spendCents: 0,
  resultados: 0,
  impressoes: 0,
  cliques: 0,
  totais: null,
});
ok(
  "conta zerada não produz taxa infinita",
  zerado.every((e) => e.taxa === null || Number.isFinite(e.taxa)),
  JSON.stringify(zerado.map((e) => e.taxa)),
);

/* --- a API manda quando respondeu ------------------------------------ */
/* Misturar impressão do banco com alcance da API daria uma frequência
   que não bate com a divisão dos dois na mesma folha. */

const divergente = etapasDoFunil({
  ...base,
  impressoes: 999, // o banco atrasado
  cliques: 7,
  totais: TOTAIS,
});
ok(
  "com totais apurados, as impressões vêm da API",
  porRotuloEm(divergente, "Impressões").valor.includes("43.679"),
  porRotuloEm(divergente, "Impressões").valor,
);
ok(
  "com totais apurados, os cliques vêm da API",
  porRotuloEm(divergente, "Cliques").valor.includes("1.284"),
);

function porRotuloEm(lista: ReturnType<typeof etapasDoFunil>, r: string) {
  return lista.find((e) => e.rotulo === r)!;
}

console.log(
  "\n--- funil completo ---\n" +
    completo
      .map(
        (e) =>
          `${e.rotulo.padEnd(16)} ${e.valor.padStart(12)}   ${
            e.taxa === null ? "" : `↓ ${(e.taxa * 100).toFixed(2)}%`
          }`,
      )
      .join("\n"),
);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
