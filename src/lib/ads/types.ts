import type { AdPlatform } from "@/types/database";

/* =====================================================================
   Contrato comum dos provedores de mídia
   ---------------------------------------------------------------------
   Google e Meta expõem APIs muito diferentes. O orquestrador não deve
   saber disso: ele pede "métricas deste período para esta conta" e
   recebe sempre a mesma forma, já normalizada em centavos.

   O resultado é um tipo DISCRIMINADO em vez de exceção. Falha de um
   cliente não pode derrubar a rodada dos outros, e `try/catch` genérico
   perde a distinção entre "token expirou" (precisa de ação humana) e
   "a API deu 500" (basta tentar de novo depois).
   ===================================================================== */

/** Uma linha de métrica normalizada: dia × plataforma × campanha. */
export interface NormalizedMetricRow {
  metricDate: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string | null;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  /**
   * Para que a campanha foi criada, como a plataforma responde.
   *
   * `null` é estado legítimo e NÃO quer dizer "nenhum objetivo": o
   * Google Ads não tem campo equivalente, e a Meta às vezes devolve a
   * campanha sem ele. Quem lê trata nulo como "não sei" — ver
   * `campanha-de-origem.ts`.
   */
  objective: string | null;
  /** O que o leilão otimiza. Mais específico que `objective`. */
  optimizationGoal: string | null;
}

export type SyncFailureCode =
  /** Falta credencial no .env — configuração, não erro de execução. */
  | "not_configured"
  /** Token expirado ou revogado. Exige reautenticação do cliente. */
  | "auth_expired"
  /** Cota da API estourada. Vale tentar de novo mais tarde. */
  | "rate_limited"
  /** Conta em moeda diferente de BRL — somar produziria número errado. */
  | "unsupported_currency"
  /** Qualquer outra falha da plataforma. */
  | "platform_error"
  /** Rede/timeout. */
  | "network_error";

export type ProviderResult =
  | { ok: true; rows: NormalizedMetricRow[] }
  | { ok: false; code: SyncFailureCode; message: string };

export interface ProviderRequest {
  externalAccountId: string;
  accessToken: string | null;
  currency: string | null;
  since: string;
  until: string;
  /** Qual `action_type` da Meta representa a conversão desta conta. */
  /** Conjunto de action_types que contam como conversão. Ver
   *  `conversion-action.ts` — soma só eventos disjuntos. */
  conversionActionType?: string | string[] | null;
}

export interface AdsProvider {
  readonly platform: AdPlatform;
  readonly label: string;
  fetchMetrics(request: ProviderRequest): Promise<ProviderResult>;
}

/* ------------------------------------------------------------------ */
/* Relatório da rodada                                                 */
/* ------------------------------------------------------------------ */

export interface IntegrationSyncResult {
  clientId: string;
  clientName: string;
  platform: AdPlatform;
  ok: boolean;
  rowsUpserted: number;
  spendCents: number;
  conversions: number;
  code?: SyncFailureCode;
  message?: string;
  durationMs: number;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  period: { since: string; until: string };
  integrationsProcessed: number;
  succeeded: number;
  failed: number;
  totalRowsUpserted: number;
  /** Consolidado do que entrou no banco nesta rodada. */
  totals: { spendCents: number; conversions: number };
  results: IntegrationSyncResult[];
}
