/* =====================================================================
   Teste de mesa da mensagem enviada ao cliente
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-mensagem.mts

   O projeto não tem suíte de testes, e este arquivo não pretende criar
   uma. Ele existe porque a substituição de marcadores é o tipo de código
   que quebra em silêncio: o texto continua saindo, só que com um
   "{cliente}" cru no meio, ou dizendo "últimos 7 dias" sobre um mês
   inteiro. O destinatário é o cliente final — não há revisão depois.

   Os casos aqui são os que JÁ deram errado alguma vez, ou que a regra
   existe para impedir:
     - "últimos 7 dias" numa janela que não tem 7 dias (foi o defeito
       que derrubou o primeiro seletor de período da estação)
     - marcador repetido no mesmo texto (substituir só o primeiro)
     - marcador desconhecido, que a validação barra mas a função não
   ===================================================================== */

import { mensagemDoCliente, MENSAGEM_PADRAO, MARCADORES } from "../src/lib/reports/mensagem-do-cliente";
let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) { falhas++; console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${nome}`);
};
const semana = { periodoLabel: "18 – 24 de agosto de 2026", dias: 7, cliente: "Satö" };
const mes = { periodoLabel: "1 – 26 de agosto de 2026", dias: 26, cliente: "Satö" };

ok("padrão, 7 dias → 'dos últimos 7 dias'",
   mensagemDoCliente(semana).split("\n")[0],
   "Olá! Aqui está o nosso relatório de performance dos últimos 7 dias.");

ok("padrão, 26 dias → data por extenso",
   mensagemDoCliente(mes).split("\n")[0],
   "Olá! Aqui está o nosso relatório de performance de 1 – 26 de agosto de 2026.");

ok("{cliente} substitui o nome",
   mensagemDoCliente(semana, "Oi {cliente}, segue o relatório."),
   "Oi Satö, segue o relatório.");

ok("marcador repetido é substituído todas as vezes",
   mensagemDoCliente(semana, "{cliente} — {cliente}"),
   "Satö — Satö");

ok("marcador desconhecido fica cru (a validação é quem barra)",
   mensagemDoCliente(semana, "Oi {fulano}"),
   "Oi {fulano}");

ok("um dia só ainda usa a data",
   mensagemDoCliente({ ...semana, dias: 1 }, "{periodo}"),
   "de 18 – 24 de agosto de 2026");

ok("texto sem marcador nenhum sai igual",
   mensagemDoCliente(semana, "Segue o relatório."),
   "Segue o relatório.");

ok("os marcadores anunciados são os que a função resolve",
   MARCADORES.map((m) => mensagemDoCliente(semana, m.chave) !== m.chave),
   [true, true]);

ok("o padrão exportado contém {periodo}", MENSAGEM_PADRAO.includes("{periodo}"), true);

console.log(falhas === 0 ? "\n8/8 passaram" : `\n${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
