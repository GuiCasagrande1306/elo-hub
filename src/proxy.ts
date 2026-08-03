import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Proxy (o antigo `middleware.ts` — renomeado no Next.js 16).
 *
 * Faz duas coisas, nesta ordem:
 *   1. Renova o token do Supabase e reescreve os cookies na resposta.
 *      Sem isto, a sessão expira em Server Components e o usuário é
 *      deslogado silenciosamente.
 *   2. Redireciona não autenticados para /login — uma checagem otimista.
 *
 * ⚠️ Isto é conveniência de navegação, NÃO é a camada de segurança.
 * Quem realmente protege o dado é o RLS no Postgres: mesmo que alguém
 * contorne este redirect, cada query continua filtrada por policy.
 */
export async function proxy(request: NextRequest) {
  if (isDemoMode) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida o JWT contra o servidor de auth — não confie no cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/webhooks");

  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname.startsWith("/login")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Tudo, exceto assets estáticos e imagens. Manter o proxy fora
     * desses caminhos evita uma chamada de auth por ícone carregado.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
