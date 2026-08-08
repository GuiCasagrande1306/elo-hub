import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ESCOPOS_CRITICOS,
  ESCOPOS_ELOCHAT,
  type PermissoesInstagram,
} from "./elochat-scopes";

/* =====================================================================
   Instagram Login — troca de código, guarda e verificação
   ---------------------------------------------------------------------
   ESTE NÃO É O FLUXO DO META ADS. São dois produtos da Meta com hosts,
   credenciais e ciclos de token diferentes:

     autorização   www.instagram.com/oauth/authorize
     código→token  api.instagram.com/oauth/access_token   (POST, form)
     token longo   graph.instagram.com/access_token       (ig_exchange_token)
     renovação     graph.instagram.com/refresh_access_token
     leitura       graph.instagram.com/me

   Verificado em 08/08/2026 que os três primeiros hosts existem e
   respondem com erro estruturado (`error_type: OAuthException` no
   `api.instagram.com`, `IGApiException` no `graph.instagram.com`) — não
   com 404. O formato do erro difere entre eles, por isso o parse é
   separado.

   `INSTAGRAM_APP_ID` NÃO É `META_APP_ID`. São valores distintos no
   mesmo app: o segundo identifica o app do Facebook, o primeiro é o id
   específico do produto Instagram. Trocar um pelo outro devolve
   "Invalid platform app" na autorização.

   COMO SE SABE O QUE FOI CONCEDIDO. Não existe `/me/permissions` neste
   caminho — quem responde é a própria troca de token, que devolve
   `permissions`. Por isso a lista é gravada na conexão: é a resposta da
   Meta, não uma suposição nossa. A verificação ao vivo confirma que o
   token ainda vale; as permissões vêm de lá.
   ===================================================================== */

const AUTORIZAR = "https://www.instagram.com/oauth/authorize";
const TROCAR = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";

/** URL de callback — precisa estar registrada no painel do app. */
export function instagramRedirectUri(): string {
  return `${serverEnv.appUrl.replace(/\/$/, "")}/api/auth/instagram/callback`;
}

export function instagramAuthUrl(state: string): string {
  const url = new URL(AUTORIZAR);
  url.searchParams.set("client_id", serverEnv.instagramAppId);
  url.searchParams.set("redirect_uri", instagramRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ESCOPOS_ELOCHAT.join(","));
  /* Sem `state` o callback não tem como saber de qual cliente é o token
     que acabou de chegar, nem que o pedido partiu daqui — qualquer um
     chamaria nosso callback com um `code` próprio e vincularia o
     Instagram dele a um cliente nosso. */
  url.searchParams.set("state", state);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Troca do código                                                     */
/* ------------------------------------------------------------------ */

interface TokenCurto {
  accessToken: string;
  userId: string;
  /** O que a Meta concedeu de fato. */
  permissions: string[];
}

/**
 * A resposta traz `permissions` ora como array, ora como string separada
 * por vírgula, dependendo da versão. Normaliza os dois em vez de
 * escolher um — errar aqui grava a lista vazia e o verificador passa a
 * dizer "faltam as três" numa conexão perfeita.
 */
function normalizarPermissoes(bruto: unknown): string[] {
  if (Array.isArray(bruto)) return bruto.map(String).filter(Boolean);
  if (typeof bruto === "string") {
    return bruto
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function trocarCodigo(
  code: string,
): Promise<{ ok: true; dados: TokenCurto } | { ok: false; error: string }> {
  const corpo = new URLSearchParams({
    client_id: serverEnv.instagramAppId,
    client_secret: serverEnv.instagramAppSecret,
    grant_type: "authorization_code",
    redirect_uri: instagramRedirectUri(),
    code,
  });

  const r = await fetch(TROCAR, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo,
    cache: "no-store",
  });

  const json = (await r.json().catch(() => null)) as {
    access_token?: string;
    user_id?: string | number;
    permissions?: unknown;
    /* `api.instagram.com` erra em formato PRÓPRIO — `error_message` na
       raiz, não `error.message` como o resto da Graph. */
    error_message?: string;
    error_type?: string;
  } | null;

  if (!r.ok || !json?.access_token) {
    return {
      ok: false,
      error: json?.error_message ?? `Falha na troca do código (HTTP ${r.status}).`,
    };
  }

  return {
    ok: true,
    dados: {
      accessToken: json.access_token,
      userId: String(json.user_id ?? ""),
      permissions: normalizarPermissoes(json.permissions),
    },
  };
}

/**
 * Token curto (1 hora) → token longo (~60 dias).
 *
 * Sem esta troca a automação para sozinha depois do almoço, e o sintoma
 * — fluxo que não dispara — não aponta para a causa.
 */
export async function trocarPorLongo(
  curto: string,
): Promise<
  { ok: true; accessToken: string; expiresAt: string | null } | { ok: false; error: string }
> {
  const url = new URL(`${GRAPH}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", serverEnv.instagramAppSecret);
  url.searchParams.set("access_token", curto);

  const r = await fetch(url, { cache: "no-store" });
  const json = (await r.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  } | null;

  if (!r.ok || !json?.access_token) {
    return {
      ok: false,
      error: json?.error?.message ?? `Falha ao gerar o token longo (HTTP ${r.status}).`,
    };
  }

  return {
    ok: true,
    accessToken: json.access_token,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

export async function salvarConexao(input: {
  clientId: string;
  igUserId: string;
  username: string | null;
  accountType: string | null;
  grantedScopes: string[];
  accessToken: string;
  expiresAt: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient();

  const { error: erroConexao } = await supabase
    .from("instagram_connections")
    .upsert(
      {
        client_id: input.clientId,
        ig_user_id: input.igUserId,
        username: input.username,
        account_type: input.accountType,
        granted_scopes: input.grantedScopes,
        expires_at: input.expiresAt,
        /* Reconectar limpa o erro anterior: o que quebrou pode ter sido
           exatamente o que a reconexão resolveu. */
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );

  if (erroConexao) {
    return { ok: false, error: `Falha ao gravar a conexão: ${erroConexao.message}` };
  }

  /* O token vai DEPOIS e em outra tabela: a linha de cima é a que a
     equipe lê, esta é a que só o service_role alcança. */
  const { error: erroSegredo } = await supabase
    .from("instagram_secrets")
    .upsert(
      {
        client_id: input.clientId,
        access_token: input.accessToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );

  if (erroSegredo) {
    return { ok: false, error: `Falha ao gravar o token: ${erroSegredo.message}` };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Verificação                                                         */
/* ------------------------------------------------------------------ */

function semConexao(error: string | null): PermissoesInstagram {
  return {
    conectado: false,
    isReadyForEloChat: false,
    missingPermissions: [...ESCOPOS_ELOCHAT],
    granted: [],
    username: null,
    expiresAt: null,
    error,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Diz se o Instagram deste cliente está pronto para automação.
 *
 * Duas perguntas, e as duas precisam de "sim": as permissões críticas
 * foram concedidas (lista que a Meta devolveu na conexão) E o token
 * ainda responde (`GET /me`). Checar só a lista mostraria "pronto" para
 * um acesso revogado ontem no aplicativo do Instagram.
 */
export async function checkInstagramConnection(
  clientId: string,
): Promise<PermissoesInstagram> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("instagram_connections")
    .select("ig_user_id, username, granted_scopes, expires_at")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return semConexao(`Falha ao ler a conexão: ${error.message}`);
  if (!data) return semConexao(null);

  const granted = (data.granted_scopes as string[] | null) ?? [];
  const missingPermissions = ESCOPOS_ELOCHAT.filter((p) => !granted.includes(p));

  const base = {
    conectado: true,
    missingPermissions,
    granted,
    username: (data.username as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
    checkedAt: new Date().toISOString(),
  };

  const { data: segredo } = await supabase
    .from("instagram_secrets")
    .select("access_token")
    .eq("client_id", clientId)
    .maybeSingle();

  const token = segredo?.access_token as string | undefined;
  if (!token) {
    return { ...base, isReadyForEloChat: false, error: "Conexão sem token gravado." };
  }

  const url = new URL(`${GRAPH}/me`);
  url.searchParams.set("fields", "user_id,username,account_type");
  url.searchParams.set("access_token", token);

  let r: Response;
  try {
    r = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return {
      ...base,
      isReadyForEloChat: false,
      error: `Não foi possível falar com o Instagram: ${e instanceof Error ? e.message : "erro de rede"}`,
    };
  }

  const json = (await r.json().catch(() => null)) as {
    username?: string;
    error?: { message?: string; code?: number };
  } | null;

  if (!r.ok || json?.error) {
    const msg = json?.error?.message ?? `HTTP ${r.status}`;
    return {
      ...base,
      isReadyForEloChat: false,
      error:
        json?.error?.code === 190
          ? `O acesso foi revogado ou expirou (${msg}). É preciso conectar de novo.`
          : `O Instagram recusou a consulta: ${msg}`,
    };
  }

  return {
    ...base,
    /* O @ da resposta ao vivo vence o gravado: a pessoa pode ter
       trocado o nome de usuário desde a conexão. */
    username: json?.username ?? base.username,
    isReadyForEloChat: ESCOPOS_CRITICOS.every((p) => granted.includes(p)),
    error: null,
  };
}
