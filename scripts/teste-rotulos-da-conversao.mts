// Nome dos cartões pela conversão escolhida. Rodar: npx tsx scripts/teste-rotulos-da-conversao.mts
import assert from "node:assert/strict";
import { rotulosDaConversao, VISITA_AO_PERFIL } from "../src/lib/ads/conversion-action";

assert.equal(rotulosDaConversao(["landing_page_view"]).results, "Visitas ao site");
assert.equal(rotulosDaConversao(["landing_page_view"]).cpa, "Custo por visita ao site");
// Conversão do nicho ou conjunto: o template decide (nada a sobrescrever).
assert.deepEqual(rotulosDaConversao([VISITA_AO_PERFIL]), {});
assert.deepEqual(rotulosDaConversao(["landing_page_view", "offsite_conversion.fb_pixel_lead"]), {});
assert.deepEqual(rotulosDaConversao([]), {});
console.log("ok: rótulos da conversão");
