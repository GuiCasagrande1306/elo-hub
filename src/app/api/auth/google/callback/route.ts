import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { redirectUri, saveIntegrationTokens, verifyState } from "@/lib/ads/oauth";

/**
 * GET /api/auth/google/callback
 *
 * Sem checagem de sessão pelo mesmo motivo do callback da Meta: o
 * navegador volta de domínio externo e pode não trazer cookie. Quem
 * autoriza é o `state` assinado.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const erroGoogle = params.get("error");
  if (erroGoogle) {
    return falhar(request, `O Google recusou a autorização: ${erroGoogle}`);
  }

  const verificado = verifyState(params.get("state"));
  if (!verificado.valid) return falhar(request, verificado.reason);

  const code = params.get("code");
  if (!code) return falhar(request, "O Google não devolveu o código.");

  let dado: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };

  try {
    const resposta = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: serverEnv.googleAdsClientId,
        client_secret: serverEnv.googleAdsClientSecret,
        redirect_uri: redirectUri("google"),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(20_000),
    });

    dado = await resposta.json().catch(() => ({}));

    if (!resposta.ok || !dado.access_token) {
      return falhar(
        request,
        dado.error_description ?? `O Google respondeu ${resposta.status}.`,
      );
    }
  } catch (error) {
    return falhar(
      request,
      error instanceof Error ? error.message : "Falha de rede.",
    );
  }

  /* Sem refresh token a integração dura uma hora e morre calada.
     Acontece quando a conta já autorizou este app antes: o Google só
     manda o refresh na primeira vez, e sem `prompt=consent` na ida ele
     é omitido. Melhor recusar agora, com instrução, do que gravar uma
     conexão que vai falhar amanhã. */
  if (!dado.refresh_token) {
    return falhar(
      request,
      "O Google não devolveu refresh token. Remova o acesso do Elo Hub em myaccount.google.com/permissions e conecte de novo.",
    );
  }

  const salvo = await saveIntegrationTokens({
    clientId: verificado.state.clientId,
    platform: "google_ads",
    tokens: {
      accessToken: dado.access_token,
      refreshToken: dado.refresh_token,
      expiresAt: dado.expires_in
        ? new Date(Date.now() + dado.expires_in * 1000).toISOString()
        : null,
      scopes: dado.scope ? dado.scope.split(" ") : null,
    },
  });

  if (!salvo.ok) return falhar(request, salvo.error);

  const destino = new URL(verificado.state.returnTo, request.nextUrl.origin);
  destino.searchParams.set("google", "conectado");
  return NextResponse.redirect(destino);
}

function falhar(request: NextRequest, motivo: string) {
  const destino = new URL("/clientes", request.nextUrl.origin);
  destino.searchParams.set("erro", motivo.slice(0, 200));
  return NextResponse.redirect(destino);
}
