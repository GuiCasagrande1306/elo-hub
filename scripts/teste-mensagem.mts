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
     - o bloco de números discordando do PDF, que é o defeito de
       27/08/2026 e o motivo de `linhasDaLegenda` existir
   ===================================================================== */

import {
  linhasDaLegenda,
  mensagemDoCliente,
  MENSAGEM_PADRAO,
  MARCADORES,
  type LinhaDeNumero,
} from "../src/lib/reports/mensagem-do-cliente";
import type { KpiResult } from "../src/lib/metrics/kpi";
import type { MetricKey } from "../src/types/database";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) { falhas++; console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`); }
  else console.log(`✓ ${nome}`);
};

const numeros: LinhaDeNumero[] = [
  { label: "Investimento", valor: "R$ 551,90", origem: null },
  { label: "Pedidos", valor: "30", origem: null },
  { label: "Custo por pedido", valor: "R$ 16,75", origem: 1 },
];

const semana = { periodoLabel: "18 – 24 de agosto de 2026", dias: 7, cliente: "Satö", numeros };
const mes = { periodoLabel: "1 – 26 de agosto de 2026", dias: 26, cliente: "Satö", numeros };

/* --- período e marcadores ------------------------------------------- */

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
   [true, true, true]);

ok("o padrão exportado contém {periodo}", MENSAGEM_PADRAO.includes("{periodo}"), true);
ok("o padrão exportado contém {numeros}", MENSAGEM_PADRAO.includes("{numeros}"), true);

/* --- o bloco de números --------------------------------------------- */

ok("{numeros} vira uma linha por métrica, com marcador",
   mensagemDoCliente(semana, "{numeros}"),
   "• Investimento: R$ 551,90\n• Pedidos: 30\n• Custo por pedido: R$ 16,75 (de 1 campanha)");

/* O selo é a peça que faltava em agosto: sem ele, 12,35x ao lado de
   R$ 551,90 parece erro de conta. A frase tem que ser IGUAL à do PDF —
   ver `SeloDeOrigem` em `pdf/document.tsx`. */
ok("selo no plural quando são várias campanhas",
   mensagemDoCliente({ ...semana, numeros: [{ label: "Retorno", valor: "4,2x", origem: 3 }] }, "{numeros}"),
   "• Retorno: 4,2x (de 3 campanhas)");

ok("sem recorte não há selo",
   mensagemDoCliente({ ...semana, numeros: [{ label: "Retorno", valor: "4,2x", origem: null }] }, "{numeros}"),
   "• Retorno: 4,2x");

/* Sem números o marcador some JUNTO com a linha em branco que o cercava.
   Sem o colapso, a mensagem chegaria ao cliente com um vão no meio. */
ok("{numeros} vazio não deixa buraco no texto",
   mensagemDoCliente({ ...semana, numeros: [] }, "Antes.\n\n{numeros}\n\nDepois."),
   "Antes.\n\nDepois.");

ok("relatório sem snapshot (numeros ausente) também não deixa buraco",
   mensagemDoCliente({ periodoLabel: "x", dias: 7, cliente: "Satö" }, "Antes.\n\n{numeros}\n\nDepois."),
   "Antes.\n\nDepois.");

/* --- a seleção de métricas ------------------------------------------ */

const kpi = (key: MetricKey, label: string, formatted: string, extra: Partial<KpiResult> = {}): KpiResult => ({
  key, label, hint: "", value: 0, formatted,
  deltaPercent: null, direction: "flat", sentiment: "neutral",
  previousValue: 0, previousFormatted: "—", indefinido: false, origem: null,
  ...extra,
});

/* Template de delivery: 8 métricas, das quais só 5 vão ao WhatsApp. As
   de diagnóstico ficam no PDF — na mensagem elas empurram para baixo o
   que o dono do negócio abre o celular para ver. */
const grade = [
  kpi("spend", "Investimento", "R$ 551,90"),
  kpi("revenue", "Faturamento", "R$ 4.137,74"),
  kpi("roas", "Retorno", "12,35x", { origem: 1 }),
  kpi("results", "Pedidos", "30"),
  kpi("cpa", "Custo por pedido", "R$ 16,75", { origem: 1 }),
  kpi("ctr", "CTR", "1,82%"),
  kpi("cpc", "CPC", "R$ 0,43"),
  kpi("aov", "Ticket Médio", "R$ 137,92"),
];

ok("as métricas de diagnóstico não entram na legenda",
   linhasDaLegenda(grade).map((l) => l.label),
   ["Investimento", "Faturamento", "Retorno", "Pedidos", "Custo por pedido"]);

/* A ordem é a do template, que é a dos cartões do PDF: quem compara a
   mensagem com a capa acha os números na mesma sequência. */
ok("a ordem é a da grade, não uma minha",
   linhasDaLegenda(grade)[2].label, "Retorno");

/* O rótulo é o da CONTA. "21 resultados" onde a conta chama de pedidos
   foi metade do defeito de 23/08. */
ok("o rótulo vem do KPI, com o nome que a conta usa",
   linhasDaLegenda(grade)[3], { label: "Pedidos", valor: "30", origem: null });

/* "• Custo por pedido: —" no WhatsApp lê como falha do sistema. O PDF
   tem espaço para explicar o traço; a legenda não. */
ok("razão sem denominador não vira linha",
   linhasDaLegenda([kpi("cpa", "Custo por pedido", "—", { indefinido: true })]),
   []);

/* SNAPSHOT ANTIGO. `report_history` guarda o payload como JSON, e cinco
   das onze linhas foram gravadas antes de o campo `origem` existir — uma
   delas ainda em `ready`, esperando na fila. O tipo diz `number | null`;
   o JSON entrega `undefined`. Sem a guarda por `typeof`, um reenvio
   mandaria "(de undefined campanhas)" ao cliente. */
ok("KPI sem o campo origem (snapshot pré-27/08) não inventa selo",
   mensagemDoCliente(
     { ...semana, numeros: linhasDaLegenda([kpi("cpa", "Custo", "R$ 8,00", { origem: undefined as never })]) },
     "{numeros}",
   ),
   "• Custo: R$ 8,00");

ok("e uma linha montada à mão sem origem também não",
   mensagemDoCliente(
     { ...semana, numeros: [{ label: "Custo", valor: "R$ 8,00" } as never] },
     "{numeros}",
   ),
   "• Custo: R$ 8,00");

ok("o selo do KPI atravessa para a linha",
   linhasDaLegenda(grade).find((l) => l.label === "Retorno")?.origem, 1);

/* O padrão de fábrica montado com uma grade real — é isto que chega ao
   cliente quando ninguém editou o texto. */
console.log("\n--- a mensagem de fábrica, com a grade acima ---");
console.log(mensagemDoCliente({ ...semana, numeros: linhasDaLegenda(grade) }));
console.log("---");

console.log(falhas === 0 ? "\n22/22 passaram" : `\n${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
