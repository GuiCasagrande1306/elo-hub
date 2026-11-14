// Contas do Painel do CS. Rodar: npx tsx scripts/teste-painel-do-cs.mts
import assert from "node:assert/strict";
import { diasEntre, prazo, proximaOcorrencia, rotuloDaSemana, segundaDaSemana } from "../src/lib/cs/semana";

assert.equal(segundaDaSemana("2026-11-13"), "2026-11-09"); // sexta
assert.equal(segundaDaSemana("2026-11-09"), "2026-11-09"); // segunda
assert.equal(segundaDaSemana("2026-11-15"), "2026-11-09"); // domingo fica na semana que termina nele
assert.equal(rotuloDaSemana("2026-11-09"), "09 a 13/11");
assert.equal(rotuloDaSemana("2026-11-30"), "30/11 a 04/12");

assert.equal(diasEntre("2026-11-04", "2026-11-13"), 9);
assert.deepEqual(prazo("2026-11-12", "2026-11-13"), { texto: "atrasada 1 dia", atrasado: true });
assert.deepEqual(prazo("2026-11-13", "2026-11-13"), { texto: "hoje", atrasado: false });
assert.deepEqual(prazo("2026-11-15", "2026-11-13"), { texto: "15/11", atrasado: false });

assert.equal(proximaOcorrencia("22/11", "2026-11-13"), "2026-11-22");
assert.equal(proximaOcorrencia("12/03 — aniversário", "2026-11-13"), "2027-03-12");
assert.equal(proximaOcorrencia("13/11/2019", "2026-11-13"), "2026-11-13");
assert.equal(proximaOcorrencia("março", "2026-11-13"), null);
assert.equal(proximaOcorrencia("40/13", "2026-11-13"), null);

console.log("ok: painel do CS");
