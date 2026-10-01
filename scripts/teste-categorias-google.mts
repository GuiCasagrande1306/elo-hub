/* =====================================================================
   Teste de mesa da classificação de conversão do Google
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-categorias-google.mts

   ⚠️ A ASSERÇÃO QUE JUSTIFICA O ARQUIVO É A DO ATACADO DE PRATAS.
   Setembro de 2026, medido na API: 9.322 "adicionar ao carrinho", 98 +
   79 compras, 17 conversas iniciadas. Somar tudo dá 9.516 e seria o
   que apareceria no relatório do cliente se alguém trocasse
   `conversions` por `all_conversions` — 54 vezes o número certo.

   O caso oposto é a Agenda Contabilidade: 1 ligação, 6 rotas, 3
   interações, e a coluna "Conversões" do Google mostrando zero porque
   ação local do Perfil da Empresa não entra nela.

   As duas contas estão abaixo com os números reais.
   ===================================================================== */

import {
  categoriaDe,
  ehResultado,
  resumir,
  CATEGORIAS,
} from "../src/lib/ads/categorias-google";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

/* --- as três que o Guilherme pediu ----------------------------------- */

ok("CONTACT é resultado", ehResultado("CONTACT"), true);
ok("PHONE_CALL_LEAD é resultado", ehResultado("PHONE_CALL_LEAD"), true);
ok("GET_DIRECTIONS é resultado", ehResultado("GET_DIRECTIONS"), true);
ok("rótulo de contato", categoriaDe("CONTACT").label, "Contato");
ok("rótulo de ligação", categoriaDe("PHONE_CALL_LEAD").label, "Ligação");
ok("rótulo de rota", categoriaDe("GET_DIRECTIONS").label, "Rota");

/* --- micro-eventos NÃO são resultado --------------------------------- */

ok("⚠️ ADD_TO_CART não é resultado", ehResultado("ADD_TO_CART"), false);
ok("PAGE_VIEW não é resultado", ehResultado("PAGE_VIEW"), false);
ok("BEGIN_CHECKOUT não é resultado", ehResultado("BEGIN_CHECKOUT"), false);
ok("ENGAGEMENT não é resultado", ehResultado("ENGAGEMENT"), false);
ok(
  "⚠️ STORE_VISIT não é resultado: o Google ESTIMA, não mede",
  ehResultado("STORE_VISIT"),
  false,
);

/* --- categoria desconhecida cai para o lado seguro ------------------- */

ok("⚠️ categoria nova vira micro, nunca resultado", ehResultado("CATEGORIA_QUE_NAO_EXISTE"), false);
ok("null vira micro", ehResultado(null), false);
ok("undefined vira micro", ehResultado(undefined), false);
ok(
  "⚠️ o id cru aparece no rótulo, para a falta de mapeamento ser visível",
  categoriaDe("ALGO_NOVO").label,
  "algo novo",
);

/* --- ATACADO DE PRATAS, setembro/2026, números reais da API ---------- */

const atacado = resumir([
  { category: "ADD_TO_CART", allConversions: 9322 },
  { category: "PURCHASE", allConversions: 98 },
  { category: "PURCHASE", allConversions: 79 },
  { category: "UNKNOWN", allConversions: 17 },
]);
ok(
  "⚠️ Atacado: o resultado é 177 compras, não 9.516",
  atacado.totalDeResultados,
  177,
);
ok("as compras somam numa linha só", atacado.resultados, [
  { id: "PURCHASE", label: "Compra", total: 177 },
]);
ok(
  "o carrinho aparece, mas do lado de micro",
  atacado.micros.map((m) => `${m.id}:${m.total}`),
  ["ADD_TO_CART:9322", "UNKNOWN:17"],
);
ok(
  "⚠️ o total NUNCA inclui micro",
  atacado.totalDeResultados < 200,
  true,
);

/* --- AGENDA CONTABILIDADE, setembro/2026, números reais -------------- */

const agenda = resumir([
  { category: "PHONE_CALL_LEAD", allConversions: 1 },
  { category: "GET_DIRECTIONS", allConversions: 6 },
  { category: "ENGAGEMENT", allConversions: 3 },
]);
ok("⚠️ Agenda: 7 resultados onde o painel mostrava 0", agenda.totalDeResultados, 7);
ok("rota lidera", agenda.resultados[0], { id: "GET_DIRECTIONS", label: "Rota", total: 6 });
ok("ligação vem depois", agenda.resultados[1], { id: "PHONE_CALL_LEAD", label: "Ligação", total: 1 });
ok("interação fica em micro", agenda.micros, [
  { id: "ENGAGEMENT", label: "Outras interações", total: 3 },
]);

/* --- bordas ----------------------------------------------------------- */

ok("sem linha nenhuma não quebra", resumir([]), { resultados: [], micros: [], totalDeResultados: 0 });
ok("zero não entra na lista", resumir([{ category: "CONTACT", allConversions: 0 }]).resultados, []);
ok(
  "ordena do maior para o menor",
  resumir([
    { category: "CONTACT", allConversions: 2 },
    { category: "GET_DIRECTIONS", allConversions: 9 },
  ]).resultados.map((r) => r.id),
  ["GET_DIRECTIONS", "CONTACT"],
);

/* --- o catálogo em si -------------------------------------------------- */

ok("não há id repetido", new Set(CATEGORIAS.map((c) => c.id)).size, CATEGORIAS.length);
ok("todo rótulo tem texto", CATEGORIAS.every((c) => c.label.length > 0), true);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
