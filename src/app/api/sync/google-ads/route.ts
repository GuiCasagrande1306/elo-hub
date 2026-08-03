import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/sync/google-ads
 *
 * Sincroniza métricas do Google Ads para `daily_metrics`.
 *
 * Contrato (Google Ads API v18, endpoint searchStream):
 *   POST https://googleads.googleapis.com/v18/customers/{id}/googleAds:searchStream
 *   Headers: Authorization: Bearer <oauth>, developer-token, login-customer-id
 *   Body: { "query": GAQL }
 *
 * Três armadilhas específicas do Google Ads:
 *
 *  1. `metrics.cost_micros` está em MICROS (1 real = 1.000.000 micros).
 *     Para centavos: round(cost_micros / 10_000).
 *
 *  2. `metrics.conversions` é DOUBLE, não inteiro — o Google atribui
 *     conversão fracionada em modelos de atribuição distribuída. Truncar
 *     para inteiro subestima o resultado do cliente.
 *
 *  3. `customer_id` vai SEM hífens na URL, mas o cadastro geralmente é
 *     feito com ("123-456-7890"). Normalizar antes de montar a chamada.
 *
 * O developer token exige aprovação do Google. Até sair, ele responde
 * apenas para contas de teste — por isso a rota degrada com uma resposta
 * explícita em vez de estourar exceção.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

/** GAQL: uma linha por campanha por dia. */
export const DAILY_METRICS_QUERY = `
  SELECT
    segments.date,
    campaign.id,
    campaign.name,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM campaign
  WHERE segments.date BETWEEN '{since}' AND '{until}'
    AND campaign.status != 'REMOVED'
`;

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!serverEnv.cronSecret || auth !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    since?: string;
    until?: string;
  };

  if (!serverEnv.googleAdsDeveloperToken || !serverEnv.googleAdsClientId) {
    return NextResponse.json(
      {
        error: "Credenciais do Google Ads ausentes.",
        hint:
          "Defina GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID e " +
          "GOOGLE_ADS_CLIENT_SECRET em .env.local.",
      },
      { status: 503 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: integration, error } = await admin
    .from("client_integrations")
    .select("id, client_id, external_account_id")
    .eq("platform", "google_ads")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!integration) {
    return NextResponse.json({
      synced: 0,
      message: "Nenhuma integração ativa do Google Ads configurada.",
    });
  }

  /* TODO(integração): habilitar quando o developer token for aprovado.

     const customerId = normalizeCustomerId(integration.external_account_id);
     const response = await fetch(
       `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`,
       {
         method: "POST",
         headers: {
           Authorization: `Bearer ${accessToken}`,
           "developer-token": serverEnv.googleAdsDeveloperToken,
           "login-customer-id": serverEnv.googleAdsLoginCustomerId,
           "Content-Type": "application/json",
         },
         body: JSON.stringify({
           query: DAILY_METRICS_QUERY
             .replace("{since}", body.since!)
             .replace("{until}", body.until!),
         }),
       },
     );

     await admin.from("daily_metrics").upsert(
       rows.map((r) => toDailyMetric(r, integration.client_id)),
       { onConflict: "client_id,platform,metric_date,campaign_id" },
     );
  */

  return NextResponse.json({
    ok: true,
    platform: "google_ads",
    clientId: body.clientId ?? null,
    period: { since: body.since, until: body.until },
    synced: 0,
    message:
      "Estrutura pronta. Ative a chamada quando o developer token for aprovado.",
  });
}

/** "123-456-7890" → "1234567890" (a API rejeita os hífens). */
export function normalizeCustomerId(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Converte uma linha do searchStream para `daily_metrics`. */
export function toDailyMetric(
  row: {
    segments: { date: string };
    campaign: { id: string; name: string };
    metrics: {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      conversions?: number;
      conversionsValue?: number;
    };
  },
  clientId: string,
) {
  return {
    client_id: clientId,
    platform: "google_ads" as const,
    metric_date: row.segments.date,
    campaign_id: row.campaign.id,
    campaign_name: row.campaign.name,
    // Micros → centavos. Dividir por 10.000, não por 1.000.000.
    spend_cents: Math.round(Number(row.metrics.costMicros ?? 0) / 10_000),
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
    // Fracionário de propósito: a coluna é numeric(12,2).
    conversions: Number(row.metrics.conversions ?? 0),
    revenue_cents: Math.round(Number(row.metrics.conversionsValue ?? 0) * 100),
  };
}
