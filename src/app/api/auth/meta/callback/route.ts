import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { redirectUri, saveIntegrationTokens, verifyState } from "@/lib/ads/oauth";

/**
 * GET /api/auth/meta/callback
 *
 * A Meta devolve o usuário aqui com `code` + `state`.
 *
 * NÃO HÁ CHECAGEM DE SESSÃO nesta rota, e é proposital: o navegador
 * volta de um domínio externo e pode não trazer cookie. Quem autoriza é
 * o `state` assinado — foi emitido por uma sessão de admin, vale 10
 * minutos e carrega de qual cliente é a conexão. Sem ele, qualquer um
 * chamaria este endpoint com um `code` próprio e vincularia a conta de
 * anúncios dele a um cliente nosso.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // A Meta devolve `error` quando o usuário recusa o consentimento.
  const erroMeta = params.get("error_description") ?? params.get("error");
  if (erroMeta) {
    return falhar(request, `A Meta recusou a autorização: ${erroMeta}`);
  }

  const verificado = verifyState(params.get("state"));
  if (!verificado.valid) {
    return falhar(request, verificado.reason);
  }

  const code = params.get("code");
  if (!code) return falhar(request, "A Meta não devolveu o código.");

  /* --- 1. Código → token curto ------------------------------------- */
  const curto = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/oauth/access_token`,
  );
  curto.searchParams.set("client_id", serverEnv.metaAppId);
  curto.searchParams.set("client_secret", serverEnv.metaAppSecret);
  curto.searchParams.set("redirect_uri", redirectUri("meta"));
  curto.searchParams.set("code", code);

  const tokenCurto = await pegarToken(curto);
  if (!tokenCurto.ok) return falhar(request, tokenCurto.error);

  /* --- 2. Token curto → token longo --------------------------------
     O token do passo 1 vive ~1 hora. Sem esta troca, a sincronização
     do dia seguinte já falharia com `auth_expired` — e o sintoma
     (relatório vazio) não apontaria para a causa. O longo dura ~60
     dias e é renovado a cada uso. */
  const longo = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/oauth/access_token`,
  );
  longo.searchParams.set("grant_type", "fb_exchange_token");
  longo.searchParams.set("client_id", serverEnv.metaAppId);
  longo.searchParams.set("client_secret", serverEnv.metaAppSecret);
  longo.searchParams.set("fb_exchange_token", tokenCurto.accessToken);

  const tokenLongo = await pegarToken(longo);
  const final = tokenLongo.ok ? tokenLongo : tokenCurto;

  /* --- 3. Persistir ------------------------------------------------- */
  const salvo = await saveIntegrationTokens({
    clientId: verificado.state.clientId,
    platform: "meta_ads",
    tokens: {
      accessToken: final.accessToken,
      expiresAt: final.expiresIn
        ? new Date(Date.now() + final.expiresIn * 1000).toISOString()
        : null,
      scopes: ["ads_read", "business_management"],
    },
  });

  if (!salvo.ok) return falhar(request, salvo.error);

  const destino = new URL(verificado.state.returnTo, request.nextUrl.origin);
  destino.searchParams.set("meta", "conectado");
  return NextResponse.redirect(destino);
}

type TokenOk = { ok: true; accessToken: string; expiresIn: number | null };
type TokenErro = { ok: false; error: string };

async function pegarToken(url: URL): Promise<TokenOk | TokenErro> {
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const dado = (await resposta.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };

    if (!resposta.ok || !dado.access_token) {
      return {
        ok: false,
        error: dado.error?.message ?? `A Meta respondeu ${resposta.status}.`,
      };
    }

    return {
      ok: true,
      accessToken: dado.access_token,
      expiresIn: dado.expires_in ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha de rede.",
    };
  }
}

/** Devolve o usuário à tela com o motivo — nunca deixa um JSON cru. */
function falhar(request: NextRequest, motivo: string) {
  const destino = new URL("/clientes", request.nextUrl.origin);
  destino.searchParams.set("erro", motivo.slice(0, 200));
  return NextResponse.redirect(destino);
}
