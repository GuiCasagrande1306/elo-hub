import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { createState, redirectUri } from "@/lib/ads/oauth";

/**
 * GET /api/auth/meta?clientId=<uuid>
 *
 * Inicia o consentimento do Meta Ads. Redireciona para a tela da Meta
 * com um `state` assinado que carrega de qual cliente é a conexão.
 *
 * ADMIN. Vincular conta de anúncios é ato administrativo — e quem
 * conclui o fluxo grava um token com poder sobre a verba de mídia.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* `ads_read` basta para ler métricas; `ads_management` daria poder de
   ALTERAR campanhas, que este sistema não faz. Pedir a menor permissão
   que resolve também acelera a revisão do app pela Meta. */
const SCOPES = ["ads_read", "business_management"];

/**
 * `?elochat=1` pede TAMBÉM as permissões de automação de direct.
 *
 * Separado do consentimento normal de propósito: o vínculo de anúncios
 * funciona hoje para 43 contas, e acrescentar quatro permissões ao
 * pedido padrão faria toda reautorização de rotina exibir um diálogo
 * mais assustador — com risco de a pessoa recusar o conjunto e derrubar
 * a sincronização que já estava de pé.
 *
 * ⚠️ PEDIR NÃO É RECEBER. `pages_messaging` e `instagram_manage_messages`
 * são de Acesso Avançado: fora do modo de desenvolvimento, a Meta só as
 * concede depois de revisão do app e verificação do negócio. Enquanto
 * isso não acontecer, este fluxo completa sem erro e volta sem as
 * permissões — que é exatamente o que o verificador vai apontar.
 */
const SCOPES_ELOCHAT = [
  ...SCOPES,
  "pages_show_list",
  "instagram_basic",
  "pages_messaging",
  "instagram_manage_messages",
];

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  if (!serverEnv.metaAppId || !serverEnv.metaAppSecret) {
    return NextResponse.json(
      {
        error: "META_APP_ID e META_APP_SECRET não configurados.",
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
    platform: "meta_ads",
    returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/clientes",
  });

  const url = new URL(
    `https://www.facebook.com/${serverEnv.metaApiVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", serverEnv.metaAppId);
  url.searchParams.set("redirect_uri", redirectUri("meta"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  /* Dois produtos de login, dois formatos de pedido:
     • "Login do Facebook" clássico  → lista de `scope`
     • "Login do Facebook para empresas" → `config_id` de uma
       configuração salva, onde as permissões já estão declaradas

     Mandar `scope` para o segundo faz a Meta abrir o diálogo sem
     permissão nenhuma, e o erro só aparece depois — na primeira chamada
     de insights, como "permissão ausente". Por isso a escolha é
     explícita: se houver config_id no ambiente, ele manda. */
  const paraEloChat = request.nextUrl.searchParams.get("elochat") === "1";

  if (serverEnv.metaLoginConfigId) {
    url.searchParams.set("config_id", serverEnv.metaLoginConfigId);
  } else {
    url.searchParams.set(
      "scope",
      (paraEloChat ? SCOPES_ELOCHAT : SCOPES).join(","),
    );
  }

  /* `auth_type=rerequest` só no fluxo do EloChat, e é o que faz a
     diferença entre o botão funcionar e não funcionar: depois de a
     pessoa recusar uma permissão, a Meta NÃO pergunta de novo num
     consentimento comum. Sem isto o usuário atravessa o fluxo inteiro,
     volta, e o verificador aponta a mesma pendência — sem nada na tela
     explicando por quê. */
  if (paraEloChat) {
    url.searchParams.set("auth_type", "rerequest");
  }

  return NextResponse.redirect(url.toString());
}
