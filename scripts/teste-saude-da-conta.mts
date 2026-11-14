// Saúde atual da conta e desde quando. Rodar: npx tsx scripts/teste-saude-da-conta.mts
import assert from "node:assert/strict";
import { saudeDaSequencia } from "../src/lib/clientes/saude";

const hoje = "2026-11-14";
assert.equal(saudeDaSequencia([], hoje), null);
assert.equal(saudeDaSequencia([{ dia: "2026-11-10", account_health: null }], hoje), null);

// Mais nova primeiro. Verde nas duas últimas, amarelo antes: verde desde 07/11.
const r = saudeDaSequencia(
  [
    { dia: "2026-11-14", account_health: "green" },
    { dia: "2026-11-10", account_health: null }, // sem cor não interrompe
    { dia: "2026-11-07", account_health: "green" },
    { dia: "2026-10-31", account_health: "yellow" },
    { dia: "2026-10-24", account_health: "green" },
  ],
  hoje,
);
assert.deepEqual(r, { cor: "green", desde: "2026-11-07", dias: 7 });

console.log("ok: saúde da conta");
