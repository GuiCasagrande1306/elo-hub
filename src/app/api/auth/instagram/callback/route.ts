import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { verifyState } from "@/lib/ads/oauth";
import {
  salvarConexao,
  trocarCodigo,
  trocarPorLongo,
} from "@/lib/instagram/connection";

/**
 * GET /api/auth/instagram/callback
 *
 * O Instagram devolve o usuário aqui com `code` + `state`.
 *
 * NÃO HÁ CHECAGEM DE SESSÃO, e é proposital — mesma razão do callback do
 * Meta: o navegador volta de um domínio externo e pode não trazer
 * cookie. Quem autoriza é o `state` assinado, emitido por uma sessão de
 * admin, válido por 10 minutos e carregando de qual cliente é a conexão.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  /* O Instagram recusa com `error_reason=user_denied` quando a pessoa
     cancela — não é falha nossa e a mensagem precisa dizer isso. */
  const erro = params.get("error_description") ?? params.get("error");
  if (erro) return falhar(request, `O Instagram recusou a autorização: ${erro}`);

  const verificado = verifyState(params.get("state"));
  if (!verificado.valid) return falhar(request, verificado.reason);

  const code = params.get("code");
  if (!code) return falhar(request, "O Instagram não devolveu o código.");

  /* --- 1. Código → token curto -------------------------------------
     É AQUI que se descobre o que foi concedido: este caminho não tem
     `/me/permissions`, e a resposta da troca traz `permissions`. Se
     alguém desmarcar uma permissão no diálogo, é neste ponto — e só
     neste — que dá para saber. */
  const curto = await trocarCodigo(code);
  if (!curto.ok) return falhar(request, curto.error);

  /* --- 2. Token curto → token longo --------------------------------
     O do passo 1 vive 1 hora. Sem esta troca a automação para sozinha
     depois do almoço, e o sintoma (fluxo que não dispara) não aponta
     para a causa. */
  const longo = await trocarPorLongo(curto.dados.accessToken);
  if (!longo.ok) return falhar(request, longo.error);

  /* --- 3. Quem é o perfil ------------------------------------------
     Só para gravar o @ e o tipo de conta. Falha aqui NÃO derruba a
     conexão: o token é válido, e um perfil sem nome na tela é melhor do
     que mandar a pessoa refazer o consentimento inteiro. */
  let username: string | null = null;
  let accountType: string | null = null;

  try {
    const url = new URL("https://graph.instagram.com/me");
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", longo.accessToken);
    const r = await fetch(url, { cache: "no-store" });
    const json = (await r.json().catch(() => null)) as {
      username?: string;
      account_type?: string;
    } | null;
    username = json?.username ?? null;
    accountType = json?.account_type ?? null;
  } catch {
    // Segue com o que já se tem.
  }

  const gravado = await salvarConexao({
    clientId: verificado.state.clientId,
    igUserId: curto.dados.userId,
    username,
    accountType,
    grantedScopes: curto.dados.permissions,
    accessToken: longo.accessToken,
    expiresAt: longo.expiresAt,
  });

  if (!gravado.ok) return falhar(request, gravado.error);

  const destino = new URL(verificado.state.returnTo, base(request));
  destino.searchParams.set(
    "instagram",
    username ? `conectado:${username}` : "conectado",
  );
  return NextResponse.redirect(destino);
}

/* ------------------------------------------------------------------ */

function base(request: NextRequest): string {
  return serverEnv.appUrl || request.nextUrl.origin;
}

/**
 * Devolve o usuário à tela de onde saiu, com o motivo na URL.
 *
 * Página de erro própria seria um beco: a pessoa está no meio de uma
 * configuração e precisa voltar para ela, não ficar num aviso sem saída.
 */
function falhar(request: NextRequest, motivo: string) {
  const destino = new URL("/clientes", base(request));
  destino.searchParams.set("instagram_erro", motivo.slice(0, 300));
  return NextResponse.redirect(destino);
}
