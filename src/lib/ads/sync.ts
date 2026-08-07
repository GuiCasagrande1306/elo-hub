import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { googleAdsProvider } from "./google-ads";
import { fetchActiveAds, fetchAdInsights, metaAdsProvider } from "./meta-ads";
import { currentMonthRange, lookbackRange } from "./normalize";
import { conversionActionFor } from "./conversion-action";
import type {
  AdsProvider,
  IntegrationSyncResult,
  NormalizedMetricRow,
  SyncReport,
} from "./types";
import type { AdPlatform, ClientSegment } from "@/types/database";

/* =====================================================================
   Motor de sincronização
   ---------------------------------------------------------------------
   ONDE O RESULTADO É GRAVADO — e por que não em `executed_*`
   ---------------------------------------------------------------------
   O sync escreve em `daily_metrics` (dia × plataforma × campanha), que
   já é a fonte da verdade de todo o sistema: dashboard, PDF e cards de
   meta leem dali.

   Ele NÃO escreve em `client_goals.executed_*_override`. Aquelas colunas
   significam "um humano corrigiu o número da plataforma" — é o que faz
   o card exibir o selo AJUSTADO. Se o cron escrevesse ali, cada rodada
   apagaria as correções manuais e todo card passaria a alegar ajuste
   humano que nunca houve.

   O efeito prático que o pedido descreve continua valendo: gravar em
   `daily_metrics` dispara o Realtime, o `ClientsDirectory` já assina
   essa tabela e as barras se movem sozinhas.

   GRANULARIDADE DA RODADA
   ---------------------------------------------------------------------
   O upsert é idempotente pela constraint
   (client_id, platform, metric_date, campaign_id): rodar duas vezes o
   mesmo dia atualiza, não duplica.

   `mode: "recent"` sincroniza só os últimos dias — é o que a rodada de
   hora em hora usa. Reprocessar o mês inteiro a cada hora geraria
   milhares de eventos de Realtime por rodada, transmitidos para toda
   sessão conectada, sem nenhum dado novo na maior parte das linhas.
   `mode: "month"` existe para a rodada diária, que captura as
   reatribuições retroativas (a Meta ajusta conversões por até 28 dias).
   ===================================================================== */

const PROVIDERS: Record<string, AdsProvider> = {
  google_ads: googleAdsProvider,
  meta_ads: metaAdsProvider,
};

/** Linhas por requisição de upsert — evita payload grande demais. */
const UPSERT_CHUNK = 500;

export interface SyncOptions {
  /** "recent" = janela curta (padrão). "month" = mês corrente inteiro. */
  mode?: "recent" | "month";
  lookbackDays?: number;
  /** Restringe a um cliente — usado pelo botão de sincronizar avulso. */
  clientId?: string;
  /**
   * Período explícito, para backfill.
   *
   * `mode` só alcança o mês corrente. Uma conta vinculada no meio da
   * relação chega com histórico que o sistema nunca viu — o Brazzo
   * Pizza tinha R$ 1.696,61 e 85 compras em julho, e um relatório
   * daquele mês sairia vazio. Ganha de `mode` quando presente.
   */
  range?: { since: string; until: string };
}

interface IntegrationRow {
  id: string;
  client_id: string;
  platform: AdPlatform;
  external_account_id: string;
  currency: string | null;
  conversion_action_type: string | null;
  clients: { name: string; status: string; segment: ClientSegment | null } | null;
  integration_secrets: { access_token: string | null; refresh_token: string | null } | null;
}

export async function syncAllClients(
  options: SyncOptions = {},
): Promise<SyncReport> {
  const startedAt = new Date();
  const mode = options.mode ?? "recent";

  const period =
    options.range ??
    (mode === "month"
      ? currentMonthRange()
      : lookbackRange(options.lookbackDays ?? 3));

  // service_role: o job não tem usuário na ponta, e `integration_secrets`
  // não tem policy alguma — só esta chave alcança os tokens.
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("client_integrations")
    .select(
      `
      id, client_id, platform, external_account_id, currency,
      conversion_action_type,
      clients!inner(name, status, segment),
      integration_secrets(access_token, refresh_token)
    `,
    )
    .eq("is_active", true)
    // Conta pausada ou encerrada não consome cota de API à toa.
    .in("clients.status", ["active", "onboarding"]);

  if (options.clientId) query = query.eq("client_id", options.clientId);

  const { data, error } = await query;

  if (error) {
    return emptyReport(startedAt, period, `Falha ao listar integrações: ${error.message}`);
  }

  const integrations = (data ?? []) as unknown as IntegrationRow[];
  const results: IntegrationSyncResult[] = [];

  // Sequencial de propósito: rodar tudo em paralelo estoura o rate limit
  // das duas plataformas com carteira grande, e aí a rodada inteira
  // falha em vez de apenas demorar.
  for (const integration of integrations) {
    results.push(await syncIntegration(admin, integration, period));
  }

  const finishedAt = new Date();
  const succeeded = results.filter((r) => r.ok);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    period: { since: period.since, until: period.until },
    integrationsProcessed: results.length,
    succeeded: succeeded.length,
    failed: results.length - succeeded.length,
    totalRowsUpserted: results.reduce((acc, r) => acc + r.rowsUpserted, 0),
    totals: {
      spendCents: succeeded.reduce((acc, r) => acc + r.spendCents, 0),
      conversions: succeeded.reduce((acc, r) => acc + r.conversions, 0),
    },
    results,
  };
}

/* ------------------------------------------------------------------ */
/* Uma integração                                                      */
/* ------------------------------------------------------------------ */

async function syncIntegration(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  integration: IntegrationRow,
  period: { since: string; until: string },
): Promise<IntegrationSyncResult> {
  const started = Date.now();

  const base = {
    clientId: integration.client_id,
    clientName: integration.clients?.name ?? "—",
    platform: integration.platform,
  };

  // ⚠️ O try/catch envolve TUDO. Um cliente com token vencido não pode
  // interromper a rodada dos outros — é o requisito central do job.
  try {
    const provider = PROVIDERS[integration.platform];

    if (!provider) {
      return await recordFailure(admin, integration, {
        ...base,
        code: "platform_error",
        message: `Sem provedor implementado para ${integration.platform}.`,
        durationMs: Date.now() - started,
      });
    }

    const result = await provider.fetchMetrics({
      externalAccountId: integration.external_account_id,
      // Google usa refresh token; Meta usa access token de longa duração.
      accessToken:
        integration.platform === "google_ads"
          ? (integration.integration_secrets?.refresh_token ?? null)
          : (integration.integration_secrets?.access_token ?? null),
      currency: integration.currency,
      /* Sem isto o provider caía no padrão do código e contava lead em
         conta de e-commerce — zerando conversão e receita com cara de
         mês fraco. O segmento resolve o caso comum; a coluna existe
         para o pixel fora do padrão. */
      conversionActionType: conversionActionFor(
        integration.clients?.segment,
        integration.conversion_action_type,
      ),
      since: period.since,
      until: period.until,
    });

    if (!result.ok) {
      return await recordFailure(admin, integration, {
        ...base,
        code: result.code,
        message: result.message,
        durationMs: Date.now() - started,
      });
    }

    const rows = result.rows.filter((r) => r.metricDate);
    const upserted = await upsertMetrics(admin, integration, rows);

    /* Criativos DEPOIS das métricas, e sem poder derrubá-las.
       `syncCreatives` engole o próprio erro: a galeria de anúncios é
       complemento do painel, e uma conta que recuse o endpoint `/ads`
       não pode fazer a sincronização de gasto e conversão contar como
       falha. É por isso que não está dentro do mesmo `try` de negócio. */
    await syncCreatives(admin, integration, rows);

    await admin
      .from("client_integrations")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .eq("id", integration.id);

    return {
      ...base,
      ok: true,
      rowsUpserted: upserted,
      spendCents: rows.reduce((acc, r) => acc + r.spendCents, 0),
      conversions: rows.reduce((acc, r) => acc + r.conversions, 0),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    // Rede caiu, JSON malformado, timeout — qualquer coisa inesperada.
    return await recordFailure(admin, integration, {
      ...base,
      code: "platform_error",
      message: error instanceof Error ? error.message : "Erro inesperado.",
      durationMs: Date.now() - started,
    });
  }
}

async function upsertMetrics(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  integration: IntegrationRow,
  rows: NormalizedMetricRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const payload = rows.map((row) => ({
    client_id: integration.client_id,
    platform: integration.platform,
    metric_date: row.metricDate,
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    spend_cents: row.spendCents,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    revenue_cents: row.revenueCents,
    synced_at: new Date().toISOString(),
  }));

  let total = 0;

  for (let i = 0; i < payload.length; i += UPSERT_CHUNK) {
    const chunk = payload.slice(i, i + UPSERT_CHUNK);

    const { error } = await admin.from("daily_metrics").upsert(chunk, {
      // Idempotência: rodar o mesmo dia de novo atualiza, não duplica.
      onConflict: "client_id,platform,metric_date,campaign_id",
    });

    if (error) throw new Error(`Upsert em daily_metrics falhou: ${error.message}`);
    total += chunk.length;
  }

  return total;
}

/** Persiste o erro na integração e devolve o resultado da rodada. */
async function recordFailure(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  integration: IntegrationRow,
  failure: Omit<IntegrationSyncResult, "ok" | "rowsUpserted" | "spendCents" | "conversions">,
): Promise<IntegrationSyncResult> {
  // O erro fica gravado na própria integração, visível em
  // /configuracoes — console de serverless some, banco não.
  await admin
    .from("client_integrations")
    .update({
      sync_error: `[${failure.code}] ${failure.message}`,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  console.error(
    `[sync] ${failure.clientName} / ${failure.platform}: ${failure.code} — ${failure.message}`,
  );

  return {
    ...failure,
    ok: false,
    rowsUpserted: 0,
    spendCents: 0,
    conversions: 0,
  };
}

function emptyReport(
  startedAt: Date,
  period: { since: string; until: string },
  message: string,
): SyncReport {
  const finishedAt = new Date();
  console.error(`[sync] ${message}`);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    period,
    integrationsProcessed: 0,
    succeeded: 0,
    failed: 0,
    totalRowsUpserted: 0,
    totals: { spendCents: 0, conversions: 0 },
    results: [],
  };
}

/* ------------------------------------------------------------------ */

/**
 * Espelha os anúncios no ar em `ad_creatives`.
 *
 * A tabela existia e era LIDA pela galeria desde o começo, mas nada
 * nunca escreveu nela — daí o "Nenhum criativo ativo sincronizado"
 * permanente. Mesmo padrão de campo legível e nunca gravável que já
 * apareceu em `conversion_action_type` e `logo_url`.
 *
 * O gasto por anúncio NÃO vem daqui. O provider de insights agrega por
 * CAMPANHA, e inventar um rateio (dividir o gasto da campanha entre seus
 * anúncios) produziria número plausível e falso — exatamente o defeito
 * que este projeto vem caçando. Os criativos entram com métrica zerada
 * até existir uma chamada `level=ad`, e a galeria mostra imagem e copy,
 * que é informação verdadeira.
 *
 * `is_active` é reescrito para todos antes do upsert: anúncio que saiu
 * do ar some da lista da API, e sem esse passo ficaria marcado como
 * ativo para sempre.
 */
async function syncCreatives(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  integration: IntegrationRow,
  rows: NormalizedMetricRow[],
): Promise<void> {
  if (integration.platform !== "meta_ads") return;

  const token = integration.integration_secrets?.access_token;
  if (!token || !integration.external_account_id) return;

  try {
    const ads = await fetchActiveAds(token, integration.external_account_id);
    if (ads.length === 0) return;

    /* Gasto e conversão POR ANÚNCIO. A galeria já desenhava Investido,
       Resultados e CPA — vinham zerados porque o provider de insights
       agrega por CAMPANHA e nada preenchia esses campos.

       Ratear o gasto da campanha entre seus anúncios teria sido o
       atalho, e seria mentira: a Meta distribui verba de forma desigual
       dentro do conjunto, e um número plausível-e-errado num card de
       criativo leva alguém a pausar o anúncio certo. */
    /* MÍNIMO e MÁXIMO, não primeiro e último. As linhas vêm agrupadas
       por campanha, não ordenadas por data — pegar as pontas do array
       produzia `since` maior que `until` em boa parte das contas, e a
       Graph API recusa a janela invertida devolvendo lista vazia. Foi
       por isso que o gasto por anúncio não chegou na primeira tentativa. */
    const datas = rows.map((r) => r.metricDate).filter(Boolean).sort();
    const janela = datas.length
      ? { since: datas[0], until: datas[datas.length - 1] }
      : null;

    const insights = janela
      ? await fetchAdInsights(
          token,
          integration.external_account_id,
          janela.since,
          janela.until,
          conversionActionFor(
            integration.clients?.segment,
            integration.conversion_action_type,
          ),
        )
      : new Map();

    await admin
      .from("ad_creatives")
      .update({ is_active: false })
      .eq("client_id", integration.client_id)
      .eq("platform", "meta_ads");

    const periodo = rows.length
      ? {
          start: rows[0].metricDate,
          end: rows[rows.length - 1].metricDate,
        }
      : { start: null, end: null };

    await admin.from("ad_creatives").upsert(
      ads.map((ad) => ({
        client_id: integration.client_id,
        platform: "meta_ads" as const,
        external_ad_id: ad.externalAdId,
        ad_name: ad.name,
        thumbnail_url: ad.imageUrl,
        primary_text: ad.body,
        headline: ad.headline,
        is_active: true,
        /* Zero quando o anúncio não teve entrega na janela — é verdade,
           não ausência de dado: criativo no ar sem gasto existe. */
        spend_cents: insights.get(ad.externalAdId)?.spendCents ?? 0,
        conversions: insights.get(ad.externalAdId)?.conversions ?? 0,
        impressions: insights.get(ad.externalAdId)?.impressions ?? 0,
        clicks: insights.get(ad.externalAdId)?.clicks ?? 0,
        period_start: periodo.start,
        period_end: periodo.end,
      })),
      { onConflict: "client_id,platform,external_ad_id" },
    );
  } catch {
    // Silencioso de propósito — ver a nota no chamador.
  }
}
