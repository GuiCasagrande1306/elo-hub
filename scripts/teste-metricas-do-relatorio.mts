/* =====================================================================
   Teste de mesa das métricas escolhidas por cliente
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-metricas-do-relatorio.mts

   Automático mostra o que teve número; escolhido mostra a lista, na
   ordem do catálogo, mesmo zerada. Ver `metricas-do-relatorio.ts`.
   ===================================================================== */

import { buildPlatformDetail } from "../src/lib/reports/platform-detail";
import { metricasValidas } from "../src/lib/reports/metricas-do-relatorio";
import type { DailyMetric } from "../src/types/database";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const linha = (p: Partial<DailyMetric>): DailyMetric =>
  ({
    id: "x", client_id: "c", platform: "meta_ads", metric_date: "2026-10-01", campaign_id: "1",
    campaign_name: "Campanha", spend_cents: 10000, impressions: 5000, clicks: 100, conversions: 10,
    revenue_cents: 0, objective: null, optimization_goal: null, profile_visits: null,
    instagram_follows: 40, conversations: 0, ...p,
  }) as DailyMetric;

const atuais = [linha({})];
const chaves = (m: Parameters<typeof buildPlatformDetail>[6]) =>
  buildPlatformDetail(atuais, [], {}, [], {}, [], m)[0].kpis.map((k) => k.key);

ok("automático: sem CPM, com seguidores", chaves(null), [
  "spend", "impressions", "clicks", "ctr", "cpc", "results", "cpa", "meta_seguidores",
]);
ok("escolhido: CPM e mensagens zeradas aparecem, na ordem dada", chaves({ meta_ads: ["spend", "cpm", "meta_mensagens"] }), [
  "spend", "cpm", "meta_mensagens",
]);
ok("escolha só do Google não mexe na Meta", chaves({ google_ads: ["spend"] }), chaves(null));
const custo = (linhas: DailyMetric[]) =>
  buildPlatformDetail(linhas, [], {}, [], {}, [], { meta_ads: ["meta_custo_mensagem"] })[0].kpis[0];
const whats = { campaign_id: "w", objective: "OUTCOME_ENGAGEMENT", optimization_goal: "REPLIES" };
ok(
  "custo por mensagem: só o gasto da campanha de mensagem",
  custo([linha({ conversations: 0 }), linha({ ...whats, spend_cents: 3000, conversations: 10 })]).value,
  300,
);
ok(
  "custo por mensagem: mensagens de fora da origem caem na conta inteira",
  custo([linha({ conversations: 5 }), linha({ ...whats, spend_cents: 3000, conversations: 0 })]).value,
  2600,
);
ok("custo por mensagem: sem conversa é indefinido", custo([linha({ conversations: 0 })]).indefinido, true);
ok("validação: ordem do catálogo, sem lixo nem repetição", metricasValidas("meta_ads", ["cpm", "lixo", "spend", "cpm"]), [
  "spend", "cpm",
]);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
