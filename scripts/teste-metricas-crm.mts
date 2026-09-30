/* =====================================================================
   Teste de mesa das contas do funil
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-metricas-crm.mts

   Estes números vão para a tela de quem decide onde a agência gasta
   tempo comercial. O erro que este arquivo existe para impedir é o
   clássico do funil: conversão acima de 100%, que acontece na primeira
   vez que alguém arrasta um lead de indicação de "Novo" direto para
   "Proposta" — e é o tipo de número que destrói a confiança no painel
   inteiro de uma vez.
   ===================================================================== */

import {
  funil,
  tempoPorEtapa,
  tempoDeCiclo,
  ondeMorre,
  motivosDePerda,
  type EventoDeEtapa,
} from "../src/lib/crm/metricas";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const ev = (
  deal_id: string,
  from_stage: EventoDeEtapa["from_stage"],
  to_stage: EventoDeEtapa["to_stage"],
  dia: string,
): EventoDeEtapa => ({ deal_id, from_stage, to_stage, changed_at: `2026-09-${dia}T12:00:00Z` });

const degrau = (f: ReturnType<typeof funil>, etapa: string) =>
  f.find((d) => d.etapa === etapa)!;

/* --- funil vazio ----------------------------------------------------- */

const vazio = funil([]);
ok("funil vazio não quebra", vazio.length, 6);
ok("⚠️ sem dado a conversão é null, não 0", degrau(vazio, "novo").conversao, null);
ok("sem dado ninguém alcançou", degrau(vazio, "novo").alcancaram, 0);

/* --- o erro que o módulo existe para impedir ------------------------ */

/* Um lead de indicação que pulou direto de Novo para Proposta.
   Contando eventos literais, "contato" teria 1 alcance e "proposta"
   teria 2 — conversão de 200%. */
const pulou: EventoDeEtapa[] = [
  ev("a", null, "novo", "01"),
  ev("a", "novo", "contato", "02"),
  ev("b", null, "novo", "01"),
  ev("b", "novo", "proposta", "03"),
];
const fPulou = funil(pulou);
ok("⚠️ quem pulou conta nas etapas do caminho", degrau(fPulou, "contato").alcancaram, 2);
ok("proposta alcançada por um", degrau(fPulou, "proposta").alcancaram, 1);
ok(
  "⚠️ conversão JAMAIS passa de 100%",
  fPulou.every((d) => d.conversao === null || d.conversao <= 1),
  true,
);
ok("a série é monótona", fPulou.every((d, i, a) => i === 0 || d.alcancaram <= a[i - 1].alcancaram), true);

/* --- voltar de etapa não apaga o que foi alcançado ------------------ */

const voltou: EventoDeEtapa[] = [
  ev("c", null, "novo", "01"),
  ev("c", "novo", "proposta", "05"),
  ev("c", "proposta", "contato", "08"),
];
ok(
  "⚠️ quem voltou continua tendo passado pela proposta",
  degrau(funil(voltou), "proposta").alcancaram,
  1,
);

/* --- conversão com números redondos --------------------------------- */

const dez: EventoDeEtapa[] = [];
for (let i = 0; i < 10; i++) dez.push(ev(`d${i}`, null, "novo", "01"));
for (let i = 0; i < 5; i++) dez.push(ev(`d${i}`, "novo", "contato", "02"));
for (let i = 0; i < 2; i++) dez.push(ev(`d${i}`, "contato", "reuniao", "03"));
const fDez = funil(dez);
ok("10 entraram", degrau(fDez, "novo").alcancaram, 10);
ok("novo → contato é 50%", degrau(fDez, "novo").conversao, 0.5);
ok("contato → reunião é 40%", degrau(fDez, "contato").conversao, 0.4);
ok("reunião → proposta é 0%", degrau(fDez, "reuniao").conversao, 0);
ok("⚠️ o último degrau é null, não 0", degrau(fDez, "ganho").conversao, null);

/* --- perdido não avança no funil ------------------------------------ */

const comPerda: EventoDeEtapa[] = [
  ev("e", null, "novo", "01"),
  ev("e", "novo", "contato", "02"),
  ev("e", "contato", "perdido", "04"),
];
ok("perdido não vira degrau", funil(comPerda).length, 6);
ok("quem perdeu contou até onde chegou", degrau(funil(comPerda), "contato").alcancaram, 1);
ok("e não contou na reunião", degrau(funil(comPerda), "reuniao").alcancaram, 0);

/* --- tempo por etapa -------------------------------------------------- */

const tempos: EventoDeEtapa[] = [
  ev("f", null, "novo", "01"),
  ev("f", "novo", "contato", "04"),   // 3 dias em novo
  ev("f", "contato", "reuniao", "10"), // 6 dias em contato
  ev("g", null, "novo", "01"),
  ev("g", "novo", "contato", "06"),   // 5 dias em novo
];
const tp = tempoPorEtapa(tempos);
const naEtapa = (e: string) => tp.find((t) => t.etapa === e)!;
ok("média em novo é (3+5)/2", naEtapa("novo").mediaDias, 4);
ok("amostra de novo é 2", naEtapa("novo").amostra, 2);
ok("média em contato é 6", naEtapa("contato").mediaDias, 6);
ok(
  "⚠️ o intervalo ABERTO não entra: contato de 'g' está correndo",
  naEtapa("contato").amostra,
  1,
);
ok("etapa sem saída medida devolve null", naEtapa("proposta").mediaDias, null);
ok("ganho não é etapa de espera", tp.some((t) => t.etapa === "ganho"), false);

/* --- tempo de ciclo --------------------------------------------------- */

const ciclos: EventoDeEtapa[] = [
  ev("h", null, "novo", "01"),
  ev("h", "novo", "ganho", "11"),      // 10 dias
  ev("i", null, "novo", "01"),
  ev("i", "novo", "ganho", "21"),      // 20 dias
  ev("j", null, "novo", "01"),
  ev("j", "novo", "perdido", "03"),    // não entra
];
ok("ciclo médio é 15 dias", tempoDeCiclo(ciclos).mediaDias, 15);
ok("⚠️ perdido fica FORA do ciclo", tempoDeCiclo(ciclos).amostra, 2);
ok("sem ganho o ciclo é null", tempoDeCiclo([ev("k", null, "novo", "01")]).mediaDias, null);

/* --- onde morre ------------------------------------------------------- */

const mortes: EventoDeEtapa[] = [
  ev("l", "proposta", "perdido", "05"),
  ev("m", "proposta", "perdido", "06"),
  ev("n", "contato", "perdido", "07"),
  ev("o", "novo", "ganho", "08"),
];
const om = ondeMorre(mortes);
ok("morre mais na proposta", om[0].etapa, "proposta");
ok("duas mortes na proposta", om[0].perdidos, 2);
ok("uma no contato", om[1].perdidos, 1);
ok("ganho não é morte", om.length, 2);

/* --- motivos ---------------------------------------------------------- */

const md = motivosDePerda([
  { stage: "perdido", lost_reason: "preco" },
  { stage: "perdido", lost_reason: "preco" },
  { stage: "perdido", lost_reason: "timing" },
  { stage: "perdido", lost_reason: null },
  { stage: "negociacao", lost_reason: "preco" },
]);
ok("preço lidera", md[0], { motivo: "preco", perdidos: 2 });
ok("⚠️ motivo em negócio não perdido é ignorado", md.reduce((a, m) => a + m.perdidos, 0), 3);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
