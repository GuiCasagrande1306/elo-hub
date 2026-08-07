import "server-only";

import { serverEnv } from "@/lib/env";
import {
  decimalToCents,
  isSupportedCurrency,
  toDecimal,
  toInt,
} from "./normalize";
import type { AdsProvider, NormalizedMetricRow, ProviderResult } from "./types";

/* =====================================================================
   Meta Ads — Graph API Insights
   ---------------------------------------------------------------------
   Endpoint:
     GET /v21.0/act_<id>/insights
       ?level=campaign
       &time_increment=1        ← 1 linha por DIA; sem isso vem o período
                                  agregado e a série do gráfico some
       &fields=campaign_id,campaign_name,spend,impressions,clicks,
               actions,action_values

   Duas armadilhas que quebram a integração se ignoradas:

   1. `spend` é STRING decimal ("123.45"), não número. Somar as strings
      concatena; somar após parse acumula erro de float. Convertemos
      cada linha para centavos na entrada.

   2. `actions` traz TODOS os tipos de conversão do pixel. Somar o array
      inteiro conta o mesmo lead várias vezes (lead + link_click +
      landing_page_view + view_content). É preciso escolher o
      `action_type` que representa a conversão daquela conta — guardado
      em `client_integrations`.
   ===================================================================== */

const DEFAULT_CONVERSION_ACTION = "offsite_conversion.fb_pixel_lead";

const FIELDS = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "action_values",
].join(",");

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsightRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

interface MetaResponse {
  data?: MetaInsightRow[];
  paging?: { next?: string };
  error?: { message?: string; code?: number; type?: string };
}

/** Códigos de erro da Graph API que exigem reautenticação. */
const AUTH_ERROR_CODES = new Set([102, 190, 463, 467]);
/** Códigos de limite de requisição — vale tentar de novo depois. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

export const metaAdsProvider: AdsProvider = {
  platform: "meta_ads",
  label: "Meta Ads",

  async fetchMetrics(request): Promise<ProviderResult> {
    if (!serverEnv.metaAppId || !serverEnv.metaAppSecret) {
      return {
        ok: false,
        code: "not_configured",
        message:
          "META_APP_ID e META_APP_SECRET ausentes. Defina-os no .env.local / painel da Vercel.",
      };
    }

    if (!request.accessToken) {
      return {
        ok: false,
        code: "auth_expired",
        message: "Sem access token salvo para esta conta do Meta Ads.",
      };
    }

    if (!isSupportedCurrency(request.currency)) {
      return {
        ok: false,
        code: "unsupported_currency",
        message: `Conta em ${request.currency}. Somar com contas em BRL produziria um total sem significado.`,
      };
    }

    const conversionAction =
      request.conversionActionType ?? DEFAULT_CONVERSION_ACTION;

    // O id pode vir com ou sem o prefixo `act_`; a API exige o prefixo.
    const accountId = request.externalAccountId.startsWith("act_")
      ? request.externalAccountId
      : `act_${request.externalAccountId}`;

    const url = new URL(
      `https://graph.facebook.com/${serverEnv.metaApiVersion}/${accountId}/insights`,
    );
    url.searchParams.set("level", "campaign");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set(
      "time_range",
      JSON.stringify({ since: request.since, until: request.until }),
    );
    url.searchParams.set("limit", "500");

    const rows: NormalizedMetricRow[] = [];
    let nextUrl: string | null = url.toString();
    let page = 0;

    try {
      // Paginação com teto: uma conta grande pode devolver dezenas de
      // páginas, e sem limite um `paging.next` em loop trava o cron.
      while (nextUrl && page < 25) {
        const response: Response = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${request.accessToken}` },
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        });

        const payload = (await response.json()) as MetaResponse;

        if (!response.ok || payload.error) {
          const code = payload.error?.code ?? 0;
          return {
            ok: false,
            code: AUTH_ERROR_CODES.has(code)
              ? "auth_expired"
              : RATE_LIMIT_CODES.has(code)
                ? "rate_limited"
                : "platform_error",
            message:
              payload.error?.message ?? `Graph API respondeu ${response.status}.`,
          };
        }

        for (const row of payload.data ?? []) {
          rows.push(toNormalizedRow(row, conversionAction));
        }

        nextUrl = payload.paging?.next ?? null;
        page += 1;
      }

      return { ok: true, rows };
    } catch (error) {
      return {
        ok: false,
        code: "network_error",
        message:
          error instanceof Error ? error.message : "Falha de rede ao chamar a Meta.",
      };
    }
  },
};

/**
 * Converte uma linha de insight da Meta para o formato do banco.
 *
 * Exportada para poder ser testada sem rede — é aqui que moram os erros
 * de unidade e de contagem dupla de conversão.
 */
export function toNormalizedRow(
  row: MetaInsightRow,
  conversionActionType: string,
): NormalizedMetricRow {
  const conversions = toDecimal(
    row.actions?.find((a) => a.action_type === conversionActionType)?.value ?? 0,
  );

  const revenue = row.action_values?.find(
    (a) => a.action_type === conversionActionType,
  )?.value;

  return {
    metricDate: row.date_start,
    campaignId: row.campaign_id ?? "_all",
    campaignName: row.campaign_name ?? null,
    spendCents: decimalToCents(row.spend),
    impressions: toInt(row.impressions),
    clicks: toInt(row.clicks),
    conversions,
    revenueCents: decimalToCents(revenue),
  };
}

/* =====================================================================
   Anúncios ativos
   ---------------------------------------------------------------------
   Endpoint diferente do de insights: `act_<id>/ads`, não `/insights`.
   Aqui a pergunta é "o que está no ar agora e com que cara", não "quanto
   gastou em cada dia".

   NÃO É CHAMADA DE RENDERIZAÇÃO. O resultado é gravado em
   `ad_creatives` pelo mesmo job que sincroniza as métricas, e a tela lê
   do banco. Buscar na Graph API a cada abertura da página repetiria o
   erro que a listagem de grupos do WhatsApp já nos custou: chamada
   lenta, limitada pela plataforma e no caminho crítico de quem só quer
   ver o painel.

   `thumbnail_url` vem SEMPRE, inclusive em vídeo — é o frame de capa.
   `image_url` só existe em criativo de imagem e é maior. Preferimos o
   segundo quando há, com o primeiro como base: uma miniatura de 64px
   esticada num card de 160 fica borrada.
   ===================================================================== */

const AD_FIELDS = [
  "name",
  "effective_status",
  "creative{thumbnail_url,image_url,body,title}",
].join(",");

export interface MetaActiveAd {
  externalAdId: string;
  name: string;
  /** `image_url` quando existe; `thumbnail_url` como base. */
  imageUrl: string | null;
  /** Copy principal do anúncio. */
  body: string | null;
  headline: string | null;
}

interface MetaAdNode {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    body?: string;
    title?: string;
  };
}

/**
 * Anúncios no ar de uma conta.
 *
 * O filtro de status vai na API e não em memória: uma conta antiga tem
 * centenas de anúncios pausados, e paginar todos para descartar 95%
 * gasta cota da Graph API sem necessidade.
 *
 * Devolve lista vazia — nunca lança — quando a conta não responde. A
 * galeria de criativos é complemento do painel; falhar aqui não pode
 * derrubar a sincronização de métricas, que é o dado que importa.
 */
export async function fetchActiveAds(
  accessToken: string,
  externalAccountId: string,
): Promise<MetaActiveAd[]> {
  const accountId = externalAccountId.startsWith("act_")
    ? externalAccountId
    : `act_${externalAccountId}`;

  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/${accountId}/ads`,
  );
  url.searchParams.set("fields", AD_FIELDS);
  url.searchParams.set(
    "filtering",
    JSON.stringify([
      { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
    ]),
  );
  url.searchParams.set("limit", "100");

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: MetaAdNode[] };

    return (payload.data ?? [])
      .filter((ad) => ad.id)
      .map((ad) => ({
        externalAdId: ad.id,
        name: ad.name?.trim() || "(sem nome)",
        imageUrl:
          ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null,
        body: ad.creative?.body?.trim() || null,
        headline: ad.creative?.title?.trim() || null,
      }));
  } catch {
    return [];
  }
}
