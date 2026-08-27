/* =====================================================================
   Teste de mesa do arredondamento da tabela de campanhas
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-arredondamento.mts

   O Google Ads devolve conversão FRACIONÁRIA. Arredondando linha a
   linha, a coluna "Result." não fecha com o card "Resultados" da mesma
   página do PDF — somar os arredondados não é arredondar a soma. O
   cliente que somar a coluna acha um resultado a mais ou a menos que o
   título da seção.

   Os casos aqui são os medidos no banco em 27/08/2026, período
   18–24/08, mais os que quebram a aritmética de propósito.
   ===================================================================== */

import { distribuirArredondamento } from "../src/lib/reports/platform-detail";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) {
    console.log(`ok   ${nome}`);
  } else {
    falhas++;
    console.log(`FALHOU  ${nome}`);
    console.log(`        esperado ${JSON.stringify(esperado)}`);
    console.log(`        veio     ${JSON.stringify(real)}`);
  }
};

const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

/* --- os casos reais ------------------------------------------------- */

/* Atacado de Pratas, Google Ads: 16,49 + 12,07 + 1,40 = 29,96.
   O card imprime Math.round(29,96) = 30. A coluna precisa somar 30. */
const atacado = distribuirArredondamento([16.49, 12.07, 1.4]);
ok("Atacado: a coluna soma o mesmo que o card", soma(atacado), 30);
/* 16,49 · 12,07 · 1,40 → pisos 16 + 12 + 1 = 29, falta um para 30.
   A maior parte fracionária é 0,49, então ela leva o assento: [17,12,1].
   Parece contraintuitivo que 16,49 vire 17 — mas alguém TEM que subir
   para a coluna fechar, e o maior resto é quem está mais perto de subir
   sozinho. O leitor nunca vê 16,49; vê a coluna somando o título. */
ok("Atacado: o resto vai para a maior fração", atacado, [17, 12, 1]);

/* Dehon Store, Google Ads: 9,50 + 5,95 = 15,45 → card 15.
   Linha a linha dava 10 + 6 = 16. */
const dehon = distribuirArredondamento([9.5, 5.95]);
ok("Dehon: a coluna soma o mesmo que o card", soma(dehon), 15);
ok("Dehon: quem tem a maior fração leva o resto", dehon, [9, 6]);

/* --- os casos que quebram a conta ----------------------------------- */

ok("inteiros ficam intactos", distribuirArredondamento([10, 5, 3]), [10, 5, 3]);
ok("lista vazia devolve vazia", distribuirArredondamento([]), []);
ok("um valor só arredonda normal", distribuirArredondamento([2.6]), [3]);
ok("tudo zero continua zero", distribuirArredondamento([0, 0]), [0, 0]);

/* Empate na parte fracionária: o índice desempata, para a saída não
   depender da ordem de iteração do Map que veio antes. */
ok("empate resolve pelo primeiro", distribuirArredondamento([1.5, 1.5]), [2, 1]);
ok("e a soma continua certa", soma(distribuirArredondamento([1.5, 1.5])), 3);

/* Muitas frações pequenas: 10 × 0,4 = 4,0 exato. Cada linha vira 0,
   e quatro delas recebem o resto. */
const dez = distribuirArredondamento(Array.from({ length: 10 }, () => 0.4));
ok("dez de 0,4 somam 4", soma(dez), 4);
ok("e nenhuma linha passa de 1", Math.max(...dez), 1);

/* O caso simétrico: pisos que já passam do alvo. Não acontece com
   valores positivos, mas o laço precisa terminar. */
ok("soma que arredonda para baixo", soma(distribuirArredondamento([1.4, 1.4])), 3);

/* Nenhuma linha pode ficar a mais de uma unidade do valor real — é o
   que mantém cada linha honesta enquanto a coluna fecha. */
const amostra = [16.49, 12.07, 1.4, 0.5, 9.5, 5.95, 0.01];
const ajustada = distribuirArredondamento(amostra);
ok(
  "cada linha fica a menos de 1 do valor real",
  ajustada.every((v, i) => Math.abs(v - amostra[i]) < 1),
  true,
);
ok("e a coluna fecha", soma(ajustada), Math.round(soma(amostra)));

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
