import "server-only";

import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { microsToCents, normalizeCustomerId, toDecimal } from "./normalize";
import type { NoDaArvore } from "./meta-structure";

/* =====================================================================
   Estrutura do Google — campanha › grupo de anúncios › anúncio
   ---------------------------------------------------------------------
   `FROM ad_group_ad` já traz os três níveis em cada linha, como o
   `level=ad` da Meta. Uma query, árvore montada em memória, totais que
   fecham por construção.

   NÃO HÁ MINIATURA. O anúncio do Google é texto (títulos e descrições)
   ou um asset de imagem em outra tabela; não existe um `thumbnail_url`
   equivalente ao da Meta. A tabela mostra o nome e, quando ele vem
   vazio, o ID — melhor que um quadrado cinza fingindo criativo.

   `ad_group_ad.ad.name` é opcional no Google e quase sempre vazio em
   anúncio responsivo. Cair no id evita uma coluna inteira de
   "Anúncio sem nome".
   ===================================================================== */

const QUERY = `
  SELECT
    campaign.id,
    campaign.name,
    ad_group.id,
    ad_group.name,
    ad_group_ad.ad.id,
    ad_group_ad.ad.name,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.conversions_value
  FROM ad_group_ad
  WHERE segments.date BETWEEN '{since}' AND '{until}'
`;

interface LinhaGoogle {
  campaign?: { id?: string; name?: string };
  adGroup?: { id?: string; name?: string };
  adGroupAd?: { ad?: { id?: string; name?: string } };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    conversionsValue?: number;
  };
}

/**
 * Campanhas do Google para o período, ou lista vazia.
 *
 * NUNCA lança: a árvore da Meta não pode sumir da tela porque o Google
 * recusou uma query. Conta sem Google, token vencido ou erro da API
 * viram lista vazia, e o card mostra o que conseguiu.
 */
export async function fetchGoogleStructure(
  externalAccountId: string | null | undefined,
  refreshToken: string | null | undefined,
  since: string,
  until: string,
): Promise<NoDaArvore[]> {
  if (
    !serverEnv.googleAdsDeveloperToken ||
    !externalAccountId ||
    externalAccountId.startsWith("pending:") ||
    !refreshToken
  ) {
    return [];
  }

  try {
    const token = await exchangeRefreshToken(refreshToken);
    if (!token.ok) return [];

    const resposta = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${normalizeCustomerId(
        externalAccountId,
      )}/googleAds:searchStream`,
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
        body: JSON.stringify({
          query: QUERY.replace("{since}", since).replace("{until}", until),
        }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      },
    );

    const payload = (await resposta.json()) as
      | { results?: LinhaGoogle[]; error?: unknown }[]
      | { results?: LinhaGoogle[]; error?: unknown };

    const chunks = Array.isArray(payload) ? payload : [payload];
    if (!resposta.ok || chunks[0]?.error) return [];

    return montarArvoreGoogle(chunks.flatMap((c) => c.results ?? []));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */

/** Pura, para poder ser conferida sem rede. */
export function montarArvoreGoogle(linhas: LinhaGoogle[]): NoDaArvore[] {
  const campanhas = new Map<string, NoDaArvore>();
  const grupos = new Map<string, NoDaArvore>();

  for (const l of linhas) {
    const campId = l.campaign?.id ?? "_sem_campanha";
    const grupoId = l.adGroup?.id ?? "_sem_grupo";
    const adId = l.adGroupAd?.ad?.id ?? `${grupoId}-?`;

    const anuncio: NoDaArvore = {
      id: `g-${adId}`,
      /* Nome vazio é a regra em anúncio responsivo do Google. O id é
         menos bonito e infinitamente mais útil que "Anúncio sem nome"
         repetido dez vezes. */
      name: l.adGroupAd?.ad?.name?.trim() || `Anúncio ${adId}`,
      nivel: "anuncio",
      plataforma: "google_ads",
      spendCents: microsToCents(l.metrics?.costMicros),
      impressions: toDecimal(l.metrics?.impressions),
      clicks: toDecimal(l.metrics?.clicks),
      /* `conversions` é DOUBLE no Google: conversão fracionada em
         modelo de atribuição distribuída. Truncar aqui subestimaria o
         resultado — o arredondamento acontece só na exibição. */
      results: l.metrics?.conversions ?? 0,
      revenueCents: Math.round((l.metrics?.conversionsValue ?? 0) * 100),
      thumbnailUrl: null,
      permalink: null,
      filhos: [],
    };

    let campanha = campanhas.get(campId);
    if (!campanha) {
      campanha = vazio(`g-${campId}`, l.campaign?.name ?? "Campanha sem nome", "campanha");
      campanhas.set(campId, campanha);
    }

    const chaveGrupo = `${campId}:${grupoId}`;
    let grupo = grupos.get(chaveGrupo);
    if (!grupo) {
      grupo = vazio(`g-${grupoId}`, l.adGroup?.name ?? "Grupo sem nome", "conjunto");
      grupos.set(chaveGrupo, grupo);
      campanha.filhos.push(grupo);
    }

    grupo.filhos.push(anuncio);

    for (const no of [grupo, campanha]) {
      no.spendCents += anuncio.spendCents;
      no.impressions += anuncio.impressions;
      no.clicks += anuncio.clicks;
      no.results += anuncio.results;
      no.revenueCents += anuncio.revenueCents;
    }
  }

  const porGasto = (a: NoDaArvore, b: NoDaArvore) => b.spendCents - a.spendCents;
  const lista = [...campanhas.values()].sort(porGasto);
  for (const c of lista) {
    c.filhos.sort(porGasto);
    for (const g of c.filhos) g.filhos.sort(porGasto);
  }
  return lista;
}

function vazio(
  id: string,
  name: string,
  nivel: NoDaArvore["nivel"],
): NoDaArvore {
  return {
    id,
    name,
    nivel,
    plataforma: "google_ads",
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    results: 0,
    revenueCents: 0,
    thumbnailUrl: null,
    permalink: null,
    filhos: [],
  };
}
