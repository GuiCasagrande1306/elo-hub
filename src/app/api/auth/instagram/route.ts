import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { createState } from "@/lib/ads/oauth";
import { instagramAuthUrl, instagramRedirectUri } from "@/lib/instagram/connection";

/**
 * GET /api/auth/instagram?clientId=<uuid>
 *
 * Inicia o consentimento do Instagram Direct para o EloChat.
 *
 * ROTA SEPARADA DA DO META ADS, e não um parâmetro dela: o login é em
 * `instagram.com`, com id e segredo próprios do produto Instagram, e o
 * callback recebe uma resposta de formato diferente. Espremer os dois na
 * mesma rota só criaria dois caminhos dentro de cada função.
 *
 * ADMIN. Conectar o Instagram de um cliente é ato administrativo — e
 * quem conclui o fluxo grava um token que responde mensagens em nome
 * dele.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  if (!serverEnv.instagramAppId || !serverEnv.instagramAppSecret) {
    return NextResponse.json(
      {
        error: "INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET não configurados.",
        hint:
          "No painel do app da Meta, produto Instagram → API setup with Instagram login. " +
          "Não são os mesmos valores de META_APP_ID/SECRET.",
        redirectUriEsperada: instagramRedirectUri(),
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

  /* Reaproveita o `state` assinado do OAuth de mídia: mesma proteção,
     mesmo segredo, uma variável a menos para esquecer. O `platform` é
     tipado como `AdPlatform` lá, e Instagram não é plataforma de
     anúncio — vai como `organic`, que é o valor neutro do enum, e quem
     lê no callback é esta rota, que já sabe de qual fluxo veio. */
  const state = createState({
    clientId,
    platform: "organic",
    returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/clientes",
  });

  return NextResponse.redirect(instagramAuthUrl(state));
}
