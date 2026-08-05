import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AdPlatform } from "@/types/database";

/* =====================================================================
   OAuth das plataformas de mídia
   ---------------------------------------------------------------------
   O fluxo tem uma peculiaridade que define o desenho: quem começa o
   consentimento é uma pessoa logada no nosso sistema, mas quem VOLTA do
   callback é o navegador vindo da Meta/Google — sem garantia de que é a
   mesma sessão, e carregando um `code` que vale um token.

   Por isso o `state` é ASSINADO e carrega o cliente e a plataforma:

   • sem assinatura, qualquer um chamaria nosso callback com um `code`
     próprio e vincularia a conta de anúncios dele a um cliente nosso;
   • sem o clientId dentro dele, o callback não saberia de quem é o
     token que acabou de receber.

   O segredo é o CRON_SECRET, mesma classe (servidor-para-servidor) e
   uma variável a menos para esquecer de configurar.
   ===================================================================== */

/** Janela curta: o consentimento leva segundos, não minutos. */
const STATE_TTL_S = 600;

export interface OAuthState {
  clientId: string;
  platform: AdPlatform;
  /** Para onde devolver o usuário no fim. */
  returnTo: string;
  exp: number;
}

function secret(): string {
  const value = serverEnv.cronSecret;
  if (!value) {
    throw new Error("CRON_SECRET é obrigatório para assinar o state do OAuth.");
  }
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createState(input: Omit<OAuthState, "exp">): string {
  const full: OAuthState = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_S,
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export type StateResult =
  | { valid: true; state: OAuthState }
  | { valid: false; reason: string };

export function verifyState(raw: string | null): StateResult {
  if (!raw) return { valid: false, reason: "State ausente." };

  const [body, signature] = raw.split(".");
  if (!body || !signature) return { valid: false, reason: "State malformado." };

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  // Tempo constante: `===` em string vaza, pelo tempo, quantos
  // caracteres iniciais bateram.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "Assinatura do state inválida." };
  }

  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "State ilegível." };
  }

  if (state.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "State expirado. Recomece a conexão." };
  }

  return { valid: true, state };
}

/** URL de callback registrada no app da Meta/Google. */
export function redirectUri(platform: "meta" | "google"): string {
  return `${serverEnv.appUrl.replace(/\/$/, "")}/api/auth/${platform}/callback`;
}

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

export interface TokenBundle {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scopes?: string[] | null;
}

/**
 * Grava a integração e o segredo.
 *
 * Duas tabelas, de propósito: `client_integrations` guarda o vínculo
 * (cliente, plataforma, id da conta) e é legível pela aplicação;
 * `integration_secrets` guarda o token e NÃO TEM POLICY NENHUMA — só
 * `service_role` chega nela. Por isso esta função usa o cliente admin.
 *
 * O `external_account_id` costuma ser desconhecido no momento do
 * consentimento: a pessoa autoriza a conta do Facebook, e só depois
 * escolhe QUAL conta de anúncios usar. Por isso ele entra vazio e é
 * preenchido no passo seguinte.
 */
export async function saveIntegrationTokens(input: {
  clientId: string;
  platform: AdPlatform;
  externalAccountId?: string;
  displayName?: string;
  tokens: TokenBundle;
}): Promise<{ ok: true; integrationId: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();

  // Placeholder distinguível: a constraint exige `not null`, e um valor
  // vazio ficaria indistinguível de uma conta chamada "". O sync ignora
  // integrações com este marcador.
  const contaPendente = `pending:${input.platform}`;

  const { data: integracao, error: erroIntegracao } = await admin
    .from("client_integrations")
    .upsert(
      {
        client_id: input.clientId,
        platform: input.platform,
        external_account_id: input.externalAccountId ?? contaPendente,
        display_name: input.displayName ?? null,
        is_active: true,
        sync_error: null,
      },
      { onConflict: "client_id,platform,external_account_id" },
    )
    .select("id")
    .single();

  if (erroIntegracao || !integracao) {
    return {
      ok: false,
      error: erroIntegracao?.message ?? "Falha ao registrar a integração.",
    };
  }

  const { error: erroSegredo } = await admin
    .from("integration_secrets")
    .upsert(
      {
        integration_id: integracao.id,
        access_token: input.tokens.accessToken,
        refresh_token: input.tokens.refreshToken ?? null,
        expires_at: input.tokens.expiresAt ?? null,
        scopes: input.tokens.scopes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "integration_id" },
    );

  if (erroSegredo) {
    return { ok: false, error: `Falha ao gravar o token: ${erroSegredo.message}` };
  }

  return { ok: true, integrationId: integracao.id };
}

/** Marcador de conta ainda não escolhida. */
export function isPendingAccount(externalAccountId: string): boolean {
  return externalAccountId.startsWith("pending:");
}
