// Visão geral da carteira. Rodar: npx tsx scripts/teste-visao-geral.mts
import assert from "node:assert/strict";
import { agrupar, pontas, resumir, type ContaNaMeta } from "../src/lib/metrics/visao-geral";

const conta = (id: string, p: Partial<ContaNaMeta>): ContaNaMeta => ({
  id, nome: id, slug: id, cor: null, segmento: "Leads", squad: "Sem squad", agencia: "Elo Marketing",
  status: "no-ritmo", ritmo: 1, metaLabel: "50", executadoLabel: "40",
  verbaPlanejada: 100_000, gasto: 50_000, verbaEsperada: 60_000, ...p,
});

const contas = [
  conta("a", { segmento: "Delivery", ritmo: 4, status: "acelerado" }), // limitado a 150% na média
  conta("b", { segmento: "Delivery", ritmo: 0.5, status: "atrasado" }),
  conta("c", { segmento: "Leads", ritmo: 0.95 }),
  conta("d", { segmento: "Leads", status: "sem-meta", ritmo: null, metaLabel: null, executadoLabel: null }),
  conta("e", { segmento: "E-commerce", ritmo: 0.3, status: "atrasado" }),
];

const r = resumir(contas);
assert.deepEqual(
  { total: r.total, comMeta: r.comMeta, noRitmo: r.noRitmo, atrasadas: r.atrasadas, semMeta: r.semMeta },
  { total: 5, comMeta: 4, noRitmo: 2, atrasadas: 2, semMeta: 1 },
);
assert.equal(r.gasto, 250_000);

const g = agrupar(contas, "segmento");
assert.deepEqual(g.map((x) => x.nome), ["Delivery", "Leads", "E-commerce"]);
assert.equal(g[0].ritmoMedio, (1.5 + 0.5) / 2);
assert.equal(g[1].ritmoMedio, 0.95); // a conta sem meta não entra na média

const p = pontas(contas, 5);
assert.deepEqual(p.adiantadas.map((c) => c.id), ["a", "c"]); // ≥ 90%, maior primeiro
assert.deepEqual(p.atrasadas.map((c) => c.id), ["e", "b"]); // < 90%, menor primeiro
assert.equal(pontas(contas, 1).atrasadas[0].id, "e");

console.log("ok: visão geral");
