import assert from "node:assert/strict";
import { checklistDoCliente, listaPadrao, progresso } from "../src/lib/onboarding/checklist";

const padrao = checklistDoCliente({ onboarding_checklist: null });
assert.equal(padrao.length, 10);
assert.equal(progresso(padrao), 0);
assert.equal(progresso([]), 0);

const metade = listaPadrao().map((i, n) => ({ ...i, done: n < 5 }));
assert.equal(progresso(metade), 50);
assert.equal(progresso(metade.map((i) => ({ ...i, done: true }))), 100);
// 1 de 3 arredonda, não trunca para baixo nem passa de 100.
assert.equal(progresso(metade.slice(0, 3).map((i, n) => ({ ...i, done: n === 0 }))), 33);
console.log("ok: checklist de onboarding");
