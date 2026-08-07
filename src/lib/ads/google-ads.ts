import "server-only";

import { serverEnv } from "@/lib/env";
import {
  isSupportedCurrency,
  microsToCents,
  normalizeCustomerId,
  toDecimal,
  toInt,
} from "./normalize";
import type { AdsProvider, NormalizedMetricRow, ProviderResult } from "./types";

/* =====================================================================
   Google Ads — searchStream (API v21)
   ---------------------------------------------------------------------
   POST /v21/customers/{customerId}/googleAds:searchStream
   Headers: Authorization, developer-token, login-customer-id

   Três armadilhas específicas desta API:

   1. `cost_micros` está em MICROS. 1 real = 1.000.000 micros. Para
      centavos divide-se por 10.000 — não por 1.000.000, que é o erro
      que faz o gasto aparecer 100× menor.

   2. `conversions` é DOUBLE, não inteiro: o Google atribui conversão
      fracionada em modelos distribuídos. Truncar subestima o resultado.

   3. O `customer_id` vai SEM hífens na URL, mas o cadastro quase sempre
      é feito com ("123-456-7890").

   Autenticação: o refresh token de longa duração é trocado por um
   access token de 1h a cada rodada. Guardar o access token não vale a
   pena — a troca custa uma requisição e evita toda a classe de bug de
   token vencido em cache.
   ===================================================================== */

/* A Google aposenta versão da API a cada poucos meses, e a resposta de
   uma versão morta NÃO é um JSON de erro: é a página HTML 404 do
   gateway. Foi assim que apareceu "[network_error] Unexpected token '<',
   \"<!DOCTYPE\"" na tela — erro de parse disfarçando um endpoint que
   deixou de existir. Medido em 07/08/2026: v18 e v19 dão 404; v20 e v21
   respondem. */
const API_VERSION = "v21";

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

interface GoogleAdsRow {
  segments?: { date?: string };
  campaign?: { id?: string; name?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    conversionsValue?: number;
  };
}

interface SearchStreamChunk {
  results?: GoogleAdsRow[];
  error?: { message?: string; status?: string; code?: number };
}

export const googleAdsProvider: AdsProvider = {
  platform: "google_ads",
  label: "Google Ads",

  async fetchMetrics(request): Promise<ProviderResult> {
    if (
      !serverEnv.googleAdsDeveloperToken ||
      !serverEnv.googleAdsClientId ||
      !serverEnv.googleAdsClientSecret
    ) {
      return {
        ok: false,
        code: "not_configured",
        message:
          "Credenciais do Google Ads ausentes. O developer token depende de aprovação do Google.",
      };
    }

    if (!request.accessToken) {
      return {
        ok: false,
        code: "auth_expired",
        message: "Sem refresh token salvo para esta conta do Google Ads.",
      };
    }

    if (!isSupportedCurrency(request.currency)) {
      return {
        ok: false,
        code: "unsupported_currency",
        message: `Conta em ${request.currency}. Somar com contas em BRL produziria um total sem significado.`,
      };
    }

    // O que guardamos é o REFRESH token; o access token dura 1h.
    const token = await exchangeRefreshToken(request.accessToken);
    if (!token.ok) return token;

    const customerId = normalizeCustomerId(request.externalAccountId);
    const query = DAILY_METRICS_QUERY.replace("{since}", request.since).replace(
      "{until}",
      request.until,
    );

    try {
      const response = await fetch(
        `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "developer-token": serverEnv.googleAdsDeveloperToken,
            ...(serverEnv.googleAdsLoginCustomerId
              ? {
                  "login-customer-id": normalizeCustomerId(
                    serverEnv.googleAdsLoginCustomerId,
                  ),
                }
              : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(45_000),
          cache: "no-store",
        },
      );

      // searchStream devolve um ARRAY de chunks, não um objeto único.
      const payload = (await response.json()) as SearchStreamChunk[] | SearchStreamChunk;

      if (!response.ok) {
        const error = Array.isArray(payload) ? payload[0]?.error : payload.error;
        return {
          ok: false,
          code:
            response.status === 401 || response.status === 403
              ? "auth_expired"
              : response.status === 429
                ? "rate_limited"
                : "platform_error",
          message: error?.message ?? `Google Ads respondeu ${response.status}.`,
        };
      }

      const chunks = Array.isArray(payload) ? payload : [payload];
      const rows: NormalizedMetricRow[] = [];

      for (const chunk of chunks) {
        for (const row of chunk.results ?? []) {
          rows.push(toNormalizedRow(row));
        }
      }

      return { ok: true, rows };
    } catch (error) {
      return {
        ok: false,
        code: "network_error",
        message:
          error instanceof Error
            ? error.message
            : "Falha de rede ao chamar o Google Ads.",
      };
    }
  },
};

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

type TokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: "auth_expired" | "network_error"; message: string };

async function exchangeRefreshToken(refreshToken: string): Promise<TokenResult> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: serverEnv.googleAdsClientId,
        client_secret: serverEnv.googleAdsClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !data.access_token) {
      return {
        ok: false,
        code: "auth_expired",
        message:
          data.error_description ??
          data.error ??
          "Não foi possível renovar o access token do Google.",
      };
    }

    return { ok: true, accessToken: data.access_token };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message:
        error instanceof Error ? error.message : "Falha ao renovar token do Google.",
    };
  }
}

/* ------------------------------------------------------------------ */

/** Converte uma linha do searchStream para o formato do banco. */
export function toNormalizedRow(row: GoogleAdsRow): NormalizedMetricRow {
  return {
    metricDate: row.segments?.date ?? "",
    campaignId: row.campaign?.id ?? "_all",
    campaignName: row.campaign?.name ?? null,
    // Micros → centavos: dividir por 10.000.
    spendCents: microsToCents(row.metrics?.costMicros),
    impressions: toInt(row.metrics?.impressions),
    clicks: toInt(row.metrics?.clicks),
    // Fracionário de propósito — a coluna é numeric(12,2).
    conversions: toDecimal(row.metrics?.conversions),
    revenueCents: Math.round((row.metrics?.conversionsValue ?? 0) * 100),
  };
}
