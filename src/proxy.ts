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
    // O service worker busca /offline durante o install para guardá-la
    // na casca. Com redirect ligado, ele cacheria a TELA DE LOGIN sob a
    // chave /offline e a mostraria toda vez que a rede caísse.
    pathname === "/offline" ||
    /**
     * Página que o Puppeteer fotografa para virar PDF. Ele chega SEM
     * cookie de sessão — com o redirect ligado, o relatório enviado ao
     * cliente sairia com a tela de login dentro, e o erro passaria
     * despercebido porque o arquivo é gerado normalmente.
     *
     * "Público" aqui é só quanto a sessão: a própria página exige um
     * token HMAC de vida curta na query e responde 404 sem ele — ver
     * `lib/reports/print-token.ts`.
     */
    pathname.startsWith("/reports/render/") ||
    /**
     * Mesma história para o brief de conteúdo: o Chromium fotografa
     * esta rota para gerar o PDF e chega sem sessão. Ela exige um token
     * HMAC de vida curta na query e responde 404 sem ele — ver
     * `lib/content/print-token.ts`.
     */
    pathname.startsWith("/briefs/render/") ||
    /**
     * O documento que o cliente abre. É público de verdade: quem tem o
     * link entra, sem conta no sistema.
     *
     * "Público" para pouca coisa, ainda assim. O token tem 24 bytes
     * aleatórios, a consulta filtra por igualdade exata no servidor
     * (`getBriefPorToken`) e a página é `noindex` — o endereço é para
     * uma pessoa, não para o Google.
     */
    pathname.startsWith("/c/");

  /**
   * Rotas de API nunca são redirecionadas.
   *
   * Dois motivos, e o primeiro já quebrou o cron uma vez:
   *
   *  1. O Vercel Cron chama `/api/cron/sync-ads` SEM cookie de sessão.
   *     Com o redirect ligado, a resposta era 307 → /login e o job
   *     jamais executava — falhando em silêncio, porque a Vercel
   *     considera o 307 uma invocação bem-sucedida.
   *
   *  2. Devolver uma página HTML de login para um cliente que pediu
   *     JSON está errado em qualquer caso. Uma API responde 401.
   *
   * Cada rota se autentica sozinha: as de relatório pelo RLS (o cliente
   * Supabase carrega o JWT do usuário), a de cron pelo CRON_SECRET.
   * A sessão continua sendo renovada acima, então o cookie não expira
   * por causa desta exceção.
   */
  const isApiRoute = pathname.startsWith("/api/");

  if (!user && !isPublicRoute && !isApiRoute) {
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
     * Tudo, exceto assets estáticos, imagens e os arquivos do PWA.
     * Manter o proxy fora desses caminhos evita uma chamada de auth por
     * ícone carregado.
     *
     * ⚠️ `sw.js` e `manifest.webmanifest` PRECISAM estar aqui.
     * Sem a exceção, o proxy responde 307 → /login para os dois:
     *   • o browser não lê o manifest e o app deixa de ser instalável;
     *   • o registro do service worker falha, porque o script vem como
     *     um redirect em vez de JavaScript.
     * Os ícones já escapavam pela regra de `.png`, o que mascarava o
     * problema — tudo parecia certo até tentar instalar de verdade.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
