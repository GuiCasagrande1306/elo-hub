import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/sync/meta-ads
 *
 * Sincroniza métricas e criativos do Meta Ads para `daily_metrics` e
 * `ad_creatives`. Estrutura pronta; a chamada real fica atrás da
 * checagem de credenciais.
 *
 * Executa com service_role — não há usuário na ponta, é um job. Por
 * isso a rota é protegida por CRON_SECRET: sem ele, qualquer um poderia
 * disparar sync e estourar a cota da API da Meta.
 *
 * Contrato da Graph API (v21.0):
 *   GET /{ad_account_id}/insights
 *     ?level=ad
 *     &fields=ad_id,ad_name,campaign_name,spend,impressions,clicks,
 *             actions,action_values
 *     &time_range={"since":"2026-07-01","until":"2026-07-31"}
 *     &time_increment=1          ← 1 linha por dia, essencial para a série
 *     &limit=500
 *
 * Dois detalhes que quebram integração de Meta se ignorados:
 *
 *  1. `spend` vem em UNIDADE MONETÁRIA como string ("123.45"), não em
 *     centavos. Converter com round(parseFloat * 100) — nunca somar os
 *     floats antes de converter.
 *
 *  2. `actions` é um array de todos os tipos de conversão. Somar tudo
 *     conta o mesmo lead várias vezes (lead + link_click + view). É
 *     preciso escolher o `action_type` que representa a conversão da
 *     conta, guardado em `client_integrations`.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

interface SyncBody {
  clientId?: string;
  since?: string;
  until?: string;
}

export async function POST(request: NextRequest) {
  /* --- Autenticação do job ------------------------------------------ */
  const auth = request.headers.get("authorization");
  if (!serverEnv.cronSecret || auth !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SyncBody;

  if (!serverEnv.metaAppId || !serverEnv.metaAppSecret) {
    return NextResponse.json(
      {
        error: "Credenciais do Meta ausentes.",
        hint: "Defina META_APP_ID e META_APP_SECRET em .env.local.",
      },
      { status: 503 },
    );
  }

  const admin = createSupabaseAdminClient();

  /* --- Contas a sincronizar ------------------------------------------
     `integration_secrets` só é legível por service_role: a RLS dela não
     tem policy nenhuma, então nem um admin logado alcança os tokens
     pelo PostgREST. */
  const { data: integrations, error } = await admin
    .from("client_integrations")
    .select("id, client_id, external_account_id, integration_secrets(access_token)")
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!integrations) {
    return NextResponse.json({
      synced: 0,
      message: "Nenhuma integração ativa do Meta Ads configurada.",
    });
  }

  /* --- Chamada à Graph API -------------------------------------------
     TODO(integração): habilitar quando o app da Meta tiver ads_read
     aprovado. O mapeamento abaixo é o formato final de gravação.

     const url = new URL(
       `https://graph.facebook.com/${serverEnv.metaApiVersion}/act_${accountId}/insights`,
     );
     url.searchParams.set("level", "ad");
     url.searchParams.set("time_increment", "1");
     url.searchParams.set("fields", FIELDS.join(","));
     url.searchParams.set(
       "time_range",
       JSON.stringify({ since: body.since, until: body.until }),
     );

     const rows = await fetchAllPages(url, accessToken);

     await admin.from("daily_metrics").upsert(
       rows.map(toDailyMetric),
       // Idempotência: rodar o mesmo dia duas vezes atualiza, não duplica.
       { onConflict: "client_id,platform,metric_date,campaign_id" },
     );
  */

  return NextResponse.json({
    ok: true,
    platform: "meta_ads",
    clientId: body.clientId ?? null,
    period: { since: body.since, until: body.until },
    synced: 0,
    message:
      "Estrutura pronta. Ative a chamada à Graph API quando o app tiver ads_read aprovado.",
  });
}

/**
 * Converte uma linha de insight da Meta para `daily_metrics`.
 *
 * Exportada para poder ser testada sem rede — é aqui que moram as
 * armadilhas de unidade e de contagem de conversão.
 */
export function toDailyMetric(
  row: {
    date_start: string;
    campaign_id?: string;
    campaign_name?: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    actions?: { action_type: string; value: string }[];
    action_values?: { action_type: string; value: string }[];
  },
  clientId: string,
  conversionActionType = "offsite_conversion.fb_pixel_purchase",
) {
  const conversions = Number(
    row.actions?.find((a) => a.action_type === conversionActionType)?.value ?? 0,
  );

  const revenue = Number(
    row.action_values?.find((a) => a.action_type === conversionActionType)
      ?.value ?? 0,
  );

  return {
    client_id: clientId,
    platform: "meta_ads" as const,
    metric_date: row.date_start,
    campaign_id: row.campaign_id ?? "_all",
    campaign_name: row.campaign_name ?? null,
    // `spend` chega como "123.45": para centavos com arredondamento, uma
    // única vez, antes de qualquer soma.
    spend_cents: Math.round(Number(row.spend ?? 0) * 100),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    conversions,
    revenue_cents: Math.round(revenue * 100),
  };
}
