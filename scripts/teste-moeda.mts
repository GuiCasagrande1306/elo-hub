// Formatação na moeda da conta de anúncio. Rodar: npx tsx scripts/teste-moeda.mts
import assert from "node:assert/strict";
import { formatCurrency, formatCurrencyCompact, simboloDaMoeda } from "../src/lib/format";
import { computeKpi, sumMetrics } from "../src/lib/metrics/kpi";

const nbsp = (s: string) => s.replace(/ /g, " ");

assert.equal(nbsp(formatCurrency(18042)), "R$ 180,42");
assert.equal(nbsp(formatCurrency(18042, "USD")), "US$ 180,42");
assert.equal(simboloDaMoeda(), "R$");
assert.equal(simboloDaMoeda("USD"), "US$");
assert.ok(nbsp(formatCurrencyCompact(1_500_000, "USD")).startsWith("US$"));

const t = sumMetrics([]);
const gasto = computeKpi("spend", { ...t, spendCents: 18042 }, t, "USD");
assert.equal(nbsp(gasto.formatted), "US$ 180,42");
const resultados = computeKpi("results", { ...t, conversions: 40 }, t, "USD");
assert.equal(resultados.formatted, "40"); // contagem não ganha símbolo

console.log("ok: moeda");
