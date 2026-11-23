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

// Resumo do período: com uma plataforma só gastando, o nome é o dela.
import { rotulosDoResumo } from "../src/lib/reports/platform-detail";
import type { DailyMetric } from "../src/types/database";
const linha = (platform: string, spend_cents: number) => ({ platform, spend_cents }) as DailyMetric;
const base = { results: "Visitas ao perfil", cpa: "Custo por visita" };
const google = { google_ads: { results: "Ligações", cpa: "Custo por ligação" } };
assert.equal(rotulosDoResumo(base, [linha("google_ads", 100), linha("meta_ads", 0)], google).results, "Ligações");
assert.equal(rotulosDoResumo(base, [linha("google_ads", 100), linha("meta_ads", 50)], google).results, "Visitas ao perfil");
assert.equal(rotulosDoResumo(base, [linha("meta_ads", 50)], google).results, "Visitas ao perfil");
console.log("ok: rótulos do resumo");
