/* =====================================================================
   Teste de mesa da escala do gráfico
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-escala-do-grafico.mts

   O eixo vertical vai para o PDF que o cliente abre. Marca errada é
   pior que marca nenhuma: ela dá autoridade a um número inventado, e
   ninguém confere gráfico contra tabela depois de enviado.

   Os casos são os que o dado real produz — contagem pequena, dinheiro
   de três a cinco dígitos — e os que quebram a aritmética de propósito.
   ===================================================================== */

import {
  escalaDoGrafico,
  type UnidadeDaEscala,
} from "../src/lib/reports/escala-do-grafico";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const e = (max: number, u: UnidadeDaEscala) => escalaDoGrafico(max, u);

/* --- o caso da tela: "Leads por dia", pico 2 ------------------------ */

ok("2 leads → topo 2, meio 1", e(2, "contagem").marcas, [2, 1, 0]);

/* --- contagem: nenhuma marca pode ser quebrada ---------------------- */

const inteiras = (max: number) =>
  e(max, "contagem").marcas.every((m) => Number.isInteger(m));

ok(
  "toda contagem de 1 a 200 dá marcas inteiras",
  Array.from({ length: 200 }, (_, i) => inteiras(i + 1)).every(Boolean),
  true,
);

ok("1 lead → topo 2 (meio lead não existe)", e(1, "contagem").marcas, [2, 1, 0]);
ok("5 leads → topo 6, meio 3", e(5, "contagem").marcas, [6, 3, 0]);
ok("7 leads → topo 8, meio 4", e(7, "contagem").marcas, [8, 4, 0]);
ok("12 leads → topo 12, meio 6", e(12, "contagem").marcas, [12, 6, 0]);
ok("96 pedidos → topo 100, meio 50", e(96, "contagem").marcas, [100, 50, 0]);

/* --- o topo NUNCA pode ficar abaixo do dado ------------------------- */
/* Se ficasse, a barra mais alta vazaria para fora do quadro — e no
   react-pdf ela não é cortada, ela desenha por cima do que estiver
   acima. */

const cobre = (max: number, u: UnidadeDaEscala) => e(max, u).topo >= max;

ok(
  "topo cobre o dado em 500 valores de contagem",
  Array.from({ length: 500 }, (_, i) => cobre(i + 1, "contagem")).every(Boolean),
  true,
);
ok(
  "topo cobre o dado em 500 valores de dinheiro",
  Array.from({ length: 500 }, (_, i) => cobre((i + 1) * 7.37, "dinheiro")).every(Boolean),
  true,
);

/* --- o desperdício vertical tem teto -------------------------------- */
/* Só potências de dez dariam topo 20 para um máximo de 12 — metade do
   quadro vazia e a comparação entre dias achatada. */

const folga = (max: number, u: UnidadeDaEscala) => e(max, u).topo / max;

ok(
  "nenhuma contagem desperdiça mais de 1/3 da altura",
  Array.from({ length: 300 }, (_, i) => folga(i + 2, "contagem") <= 1.34).every(Boolean),
  true,
);

/* --- dinheiro ------------------------------------------------------- */

ok("R$ 191,72 → topo 200, meio 100", e(191.72, "dinheiro").marcas, [200, 100, 0]);
ok("R$ 39.865,11 → topo 40.000", e(39865.11, "dinheiro").topo, 40000);
ok("R$ 0,80 → topo 0,80", e(0.8, "dinheiro").marcas, [0.8, 0.4, 0]);

/* Dinheiro ACEITA 2,5, que contagem recusa: R$ 2,50 é um valor, meio
   lead não é. É a única diferença entre as duas listas de passos. */
ok("R$ 4,60 → topo 5, meio 2,50", e(4.6, "dinheiro").marcas, [5, 2.5, 0]);
ok("5 leads não usa 2,5", e(5, "contagem").marcas.includes(2.5), false);

/* --- o valor que É exatamente um passo ------------------------------ */
/* Ponto flutuante: sem a folga em `arredondarParaCima`, 0.1*3 vira
   0.30000000000000004 e o valor pula para o passo seguinte, dobrando a
   escala sem nada na tela explicando. */

ok("0,6 (dinheiro) não pula de passo", e(0.6, "dinheiro").topo, 0.6);
ok("6 (contagem) não pula de passo", e(6, "contagem").topo, 6);
ok("60 (contagem) não pula de passo", e(60, "contagem").topo, 60);

/* --- bordas --------------------------------------------------------- */

/* Zero nunca chega aqui — o componente já mostra "sem dados" antes —,
   mas devolver `topo: 0` faria a divisão da altura da barra dar NaN. */
ok("zero devolve topo positivo", e(0, "contagem").topo > 0, true);
ok("negativo devolve topo positivo", e(-5, "dinheiro").topo > 0, true);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
