import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { createState, redirectUri } from "@/lib/ads/oauth";

/**
 * GET /api/auth/google?clientId=<uuid>
 *
 * Inicia o consentimento do Google Ads.
 *
 * DOIS PARÂMETROS QUE NÃO SÃO OPCIONAIS AQUI:
 *
 *   access_type=offline  → sem isto o Google não devolve refresh token,
 *                          e a integração morre em uma hora.
 *   prompt=consent       → o Google só manda refresh token na PRIMEIRA
 *                          autorização de cada app+conta. Reconectar sem
 *                          isto devolve access token e nada mais, e o
 *                          sync volta a falhar sem explicação.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["https://www.googleapis.com/auth/adwords"];

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  if (!serverEnv.googleAdsClientId || !serverEnv.googleAdsClientSecret) {
    return NextResponse.json(
      {
        error: "GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET não configurados.",
        hint: "Defina no .env.local e no painel da Vercel antes de conectar.",
      },
      { status: 503 },
    );
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "Informe ?clientId=<uuid>." },
      { status: 400 },
    );
  }

  const state = createState({
    clientId,
    platform: "google_ads",
    returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/clientes",
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", serverEnv.googleAdsClientId);
  url.searchParams.set("redirect_uri", redirectUri("google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
