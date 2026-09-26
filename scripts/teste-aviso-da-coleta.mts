/* =====================================================================
   Teste de mesa do aviso de coleta parada
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-aviso-da-coleta.mts

   Este texto vai para o grupo de trabalho da agência todo dia. O que
   está sendo testado não é formatação: é o RESUMO — a decisão de quais
   linhas a equipe não vai ler.

   Errar para o lado do excesso é pior que errar para o lado da falta:
   cinquenta linhas quase idênticas enterram as três linhas de saldo que
   vêm depois e treinam todo mundo a rolar a tela sem ler. Foi esse
   cenário que aconteceu de verdade — 49 integrações caídas de uma vez,
   todas pela mesma causa.
   ===================================================================== */

import {
  secaoDaColeta,
  type IntegracaoParada,
} from "../src/lib/ads/aviso-da-coleta";

let falhas = 0;
const ok = (nome: string, condicao: boolean, detalhe?: string) => {
  if (!condicao) {
    falhas++;
    console.log(`✗ ${nome}${detalhe ? `\n   ${detalhe}` : ""}`);
  } else console.log(`✓ ${nome}`);
};

const p = (
  n: number,
  causa: IntegracaoParada["causa"],
  dias: number | null,
  dono: string | null = "Geraldo Reis Dos Santos",
): IntegracaoParada => ({
  clientId: `c${n}`,
  clientName: `Cliente ${n}`,
  platform: "meta_ads",
  causa,
  detalhe: causa === "erro" ? "A conta foi desabilitada." : null,
  diasSemDado: dias,
  autorizadoPor: dono,
});

/* --- o caso de 18/09/2026: a carteira inteira de uma vez ------------- */

const carteira = Array.from({ length: 49 }, (_, i) =>
  p(i + 1, "reautorizar", (i % 5) + 1),
);
const texto = secaoDaColeta(carteira).join("\n");

ok(
  "49 contas não produzem 49 linhas",
  texto.split("\n").length <= 8,
  `produziu ${texto.split("\n").length} linhas:\n${texto}`,
);
ok("o total aparece no cabeçalho", texto.includes("49 contas"));
ok(
  "avisa que o resto da mensagem pode estar velho",
  texto.includes("podem estar velhos"),
);
ok("diz quantas ficaram de fora da lista", texto.includes("e outras 46"));

/* ⚠️ A LINHA QUE RESOLVE O PROBLEMA EM UM PASSO. Com um autorizador só,
   não são 49 problemas: é um, com 49 sintomas. */
ok(
  "aponta o acesso único como causa",
  texto.includes("Todas autorizadas por Geraldo Reis Dos Santos"),
);

/* --- não afirma o que não sabe --------------------------------------- */

const doisDonos = [
  p(1, "reautorizar", 3, "Geraldo Reis Dos Santos"),
  p(2, "reautorizar", 3, "Guilherme Casagrande"),
];
ok(
  "com dois autorizadores, não culpa ninguém",
  !secaoDaColeta(doisDonos).join("\n").includes("Todas autorizadas por"),
);

const semDono = [p(1, "reautorizar", 3, null), p(2, "reautorizar", 2, null)];
ok(
  "sem nome registrado, omite a linha do acesso",
  !secaoDaColeta(semDono).join("\n").includes("Todas autorizadas"),
);

/* Uma conta só não precisa da frase "é um acesso só que caiu" — ela já
   é evidentemente um acesso só. */
ok(
  "uma conta sozinha não ganha a frase do acesso único",
  !secaoDaColeta([p(1, "reautorizar", 3)]).join("\n").includes("um acesso só"),
);

/* --- as três causas pedem ações diferentes --------------------------- */

const misto = [
  p(1, "reautorizar", 4),
  p(2, "erro", 2),
  p(3, "sem_dado", 9),
];
const t3 = secaoDaColeta(misto).join("\n");

ok("separa por ação, não por código", 
  t3.includes("precisam de reautorização") &&
  t3.includes("com erro da plataforma") &&
  t3.includes("sem dado novo, sem erro registrado"));

/* O código técnico não serve a quem lê o grupo. */
ok("não vaza código técnico", !t3.includes("auth_expired"));

/* --- contagem de clientes, não de integrações ------------------------ */
/* Um cliente com Meta e Google caídos são DUAS contas e UM cliente.
   Dizer "2 clientes" exageraria o alcance do problema. */

const mesmoCliente: IntegracaoParada[] = [
  { ...p(1, "reautorizar", 3), platform: "meta_ads" },
  { ...p(1, "reautorizar", 3), platform: "google_ads" },
];
const t4 = secaoDaColeta(mesmoCliente).join("\n");
ok("conta clientes distintos", t4.includes("2 contas") && t4.includes("1 cliente"));

/* --- tempo por extenso ---------------------------------------------- */

ok("um dia no singular", secaoDaColeta([p(1, "erro", 1)]).join("\n").includes("há 1 dia"));
ok("hoje não vira 'há 0 dias'", secaoDaColeta([p(1, "erro", 0)]).join("\n").includes("parou hoje"));
ok(
  "nunca coletou é dito assim",
  secaoDaColeta([p(1, "sem_dado", null)]).join("\n").includes("nunca coletou"),
);

/* --- as mais antigas primeiro --------------------------------------- */
/* `coletaParada` já ordena; o teto de três por grupo só serve se a
   ordem sobreviver ao corte. */

const ordenadas = [p(1, "erro", 30), p(2, "erro", 20), p(3, "erro", 10), p(4, "erro", 1)];
const t5 = secaoDaColeta(ordenadas).join("\n");
ok(
  "o corte preserva as mais antigas",
  t5.includes("Cliente 1") && t5.includes("Cliente 3") && !t5.includes("Cliente 4"),
);

/* ⚠️ ENTRADA FORA DE ORDEM, que é o caso que o teste acima NÃO cobria.
   A primeira versão confiava em quem chama e o exemplo impresso saía com
   as três MAIS NOVAS sob um teto que existe para mostrar as antigas. */
const bagunçadas = [p(1, "erro", 2), p(2, "erro", 40), p(3, "erro", 1), p(4, "erro", 35)];
const t6 = secaoDaColeta(bagunçadas).join("\n");
ok(
  "ordena sozinha quando a entrada vem fora de ordem",
  t6.includes("Cliente 2") && t6.includes("Cliente 4") && !t6.includes("Cliente 3"),
  t6,
);

/* Nunca coletou é a pior de todas, mesmo ao lado de uma parada há meses. */
const nunca = [p(1, "sem_dado", 60), p(2, "sem_dado", 50), p(3, "sem_dado", 40), p(4, "sem_dado", null)];
ok(
  "'nunca coletou' vem na frente",
  secaoDaColeta(nunca).join("\n").includes("Cliente 4"),
);

console.log(`\n--- exemplo do que vai para o grupo ---\n${texto}\n`);
console.log(falhas === 0 ? "TUDO PASSOU" : `${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
