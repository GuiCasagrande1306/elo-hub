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
  /**
   * Quem, no Elo Hub, começou o consentimento — nome e não id, porque o
   * destino é `authorized_by_user_name`, que é fotografia do ato.
   *
   * VEM NO STATE e não da sessão: o callback recebe o navegador voltando
   * de domínio externo, sem garantia de cookie — é justamente por isso
   * que aquela rota não checa sessão. O state é assinado, então este
   * campo é tão confiável quanto o `clientId` ao lado dele.
   *
   * Opcional porque um state emitido antes deste campo existir ainda
   * pode estar em voo. Eles duram dez minutos.
   */
  userName?: string;
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
  /**
   * Quem é o dono deste token.
   *
   * ⚠️ NÃO É DETALHE DE AUDITORIA, é o que explica a lista de contas de
   * anúncio. O token do Meta pertence a uma PESSOA, e o seletor mostra
   * exatamente o que `me/adaccounts` dela alcança — nada no código
   * filtra por Business Manager. Sem este registro, "por que a conta do
   * cliente novo não aparece?" não tem resposta na tela.
   */
  authorizedBy?: {
    /** Nome do dono do token na plataforma. Nulo quando ela não conta. */
    name?: string | null;
    externalId?: string | null;
    /** Quem conduziu o consentimento dentro do Elo Hub. */
    userName?: string | null;
  };
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
        /* REESCREVE A CADA REAUTORIZAÇÃO, de propósito: o dono do token
           é o da autorização mais recente, e é esse que manda na lista
           de contas. Guardar o primeiro seria guardar a informação
           errada justamente depois de alguém trocar o autorizador. */
        authorized_by_name: input.authorizedBy?.name ?? null,
        authorized_by_external_id: input.authorizedBy?.externalId ?? null,
        authorized_by_user_name: input.authorizedBy?.userName ?? null,
        authorized_at: new Date().toISOString(),
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
