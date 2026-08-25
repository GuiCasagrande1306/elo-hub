/* =====================================================================
   Backfill do objetivo das campanhas em daily_metrics
   ---------------------------------------------------------------------
   Rode com:  node scripts/backfill-objetivo-campanha.mjs
   Depois da migration 20260825000069_objetivo_da_campanha.sql.

   POR QUE PRECISA EXISTIR. O sync passa a gravar `objective` e
   `optimization_goal` a cada rodada, mas só nas datas que ele
   sincroniza. O relatório compara o período com o ANTERIOR, e o
   histórico ficaria sem objetivo — o período atual isolaria o custo na
   campanha de origem e o anterior não, produzindo uma variação enorme
   que não aconteceu. Uma queda de 33% no custo por compra inventada por
   uma coluna vazia é exatamente o tipo de número que ninguém confere.

   BARATO. O objetivo é atributo da CAMPANHA, não do dia: medido em
   25/08/2026 são 53 pares (cliente, campanha) para 9.591 linhas de
   Meta. Uma chamada por conta resolve todas as datas.

   IDEMPOTENTE. Roda de novo sem estragar nada — reescreve os mesmos
   valores. Só toca em `meta_ads`: o Google não tem campo equivalente e
   nulo é a resposta honesta lá (ver `google-ads.ts`).
   ===================================================================== */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* A mesma limpeza de `meta-ads.ts`: "Unknown Optimization Goal" é o que
   a Meta devolve quando ela própria não sabe. Guardar essa string faria
   a classificação tentar casá-la com um padrão real. */
const metaLimpa = (v) => (v && !/unknown/i.test(v) ? v : null);

async function objetivosDaConta(conta, token) {
  const mapa = new Map();

  /* Insights primeiro: é a única fonte que traz `optimization_goal` no
     nível de campanha. Cobre toda campanha que gastou. */
  const insights = new URL(
    `https://graph.facebook.com/v21.0/${conta}/insights`,
  );
  insights.searchParams.set("level", "campaign");
  insights.searchParams.set(
    "time_range",
    JSON.stringify({ since: "2025-01-01", until: "2026-12-31" }),
  );
  insights.searchParams.set("fields", "campaign_id,objective,optimization_goal");
  insights.searchParams.set("limit", "500");
  insights.searchParams.set("access_token", token);

  const r1 = await fetch(insights, { signal: AbortSignal.timeout(60_000) });
  const j1 = await r1.json();
  if (!j1.error) {
    for (const c of j1.data ?? []) {
      if (!c.campaign_id) continue;
      mapa.set(c.campaign_id, {
        objective: c.objective ?? null,
        optimization_goal: metaLimpa(c.optimization_goal),
      });
    }
  }

  /* Depois `/campaigns`, para a campanha que existe em daily_metrics com
     gasto zero e não aparece no insights. Não sobrescreve o que já veio
     — ali há `optimization_goal`, aqui não. */
  const campanhas = new URL(
    `https://graph.facebook.com/v21.0/${conta}/campaigns`,
  );
  campanhas.searchParams.set("fields", "id,objective");
  campanhas.searchParams.set("limit", "500");
  campanhas.searchParams.set("access_token", token);

  const r2 = await fetch(campanhas, { signal: AbortSignal.timeout(60_000) });
  const j2 = await r2.json();
  if (!j2.error) {
    for (const c of j2.data ?? []) {
      if (!c.id || mapa.has(c.id)) continue;
      mapa.set(c.id, { objective: c.objective ?? null, optimization_goal: null });
    }
  }

  return mapa;
}

const { data: integracoes, error: eItg } = await admin
  .from("client_integrations")
  .select(
    "client_id, external_account_id, clients!inner(name), integration_secrets(access_token)",
  )
  .eq("platform", "meta_ads");

if (eItg) {
  console.error("não deu para listar as integrações:", eItg.message);
  process.exit(1);
}

let contas = 0;
let linhas = 0;
let semObjetivo = 0;

for (const itg of integracoes ?? []) {
  const token = itg.integration_secrets?.access_token;
  if (!token || !itg.external_account_id?.startsWith("act_")) continue;

  /* Quais campanhas desta conta existem no banco. Buscar só elas evita
     escrever para campanha que nunca teve linha.

     PAGINADO, e a primeira versão não era — foi o defeito que a
     verificação pegou. O PostgREST corta em 1.000 linhas SEM AVISAR:
     medido no Brazzo Pizza, 1.357 linhas e 10 campanhas, a consulta
     devolvia 1.000 linhas e 8 campanhas. As duas que sobravam nunca
     entravam no laço, e ficavam sem objetivo para sempre — incluindo
     uma "04 | VENDAS" do Seu Parma com R$1.754 e 83 conversões. O
     script terminava anunciando "0 campanhas sem objetivo", porque ele
     de fato preencheu todas as que enxergou. */
  const doBanco = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("daily_metrics")
      .select("campaign_id")
      .eq("client_id", itg.client_id)
      .eq("platform", "meta_ads")
      .range(from, from + 999);
    if (!data?.length) break;
    doBanco.push(...data);
    if (data.length < 1000) break;
  }

  const alvos = [...new Set(doBanco.map((r) => r.campaign_id))];
  if (alvos.length === 0) continue;

  const mapa = await objetivosDaConta(itg.external_account_id, token);
  contas += 1;

  for (const campaignId of alvos) {
    const info = mapa.get(campaignId);
    if (!info || (!info.objective && !info.optimization_goal)) {
      semObjetivo += 1;
      continue;
    }

    const { count, error } = await admin
      .from("daily_metrics")
      .update(
        {
          objective: info.objective,
          optimization_goal: info.optimization_goal,
        },
        { count: "exact" },
      )
      .eq("client_id", itg.client_id)
      .eq("platform", "meta_ads")
      .eq("campaign_id", campaignId);

    if (error) {
      console.error(`  ${itg.clients.name} / ${campaignId}: ${error.message}`);
      continue;
    }
    linhas += count ?? 0;
  }

  console.log(
    `${itg.clients.name.padEnd(24)} ${String(alvos.length).padStart(3)} campanhas`,
  );
  await new Promise((r) => setTimeout(r, 150));
}

console.log(
  `\n${contas} contas · ${linhas} linhas preenchidas · ${semObjetivo} campanhas sem objetivo na plataforma`,
);

const { count: total } = await admin
  .from("daily_metrics")
  .select("*", { count: "exact", head: true })
  .eq("platform", "meta_ads");
const { count: comObjetivo } = await admin
  .from("daily_metrics")
  .select("*", { count: "exact", head: true })
  .eq("platform", "meta_ads")
  .not("objective", "is", null);

console.log(`meta_ads com objetivo: ${comObjetivo}/${total}`);
