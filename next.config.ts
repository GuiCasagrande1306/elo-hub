import type { NextConfig } from "next";

/**
 * Configuração do Next.
 *
 * SOBRE O PWA: não há plugin envolvido.
 *
 * O pedido sugeria `@ducanh2912/next-pwa`. Ele depende de
 * `workbox-webpack-plugin` e declara `webpack` como peer dependency —
 * mas o Next 16 usa Turbopack por padrão em dev e build, e o hook
 * `webpack()` do next.config simplesmente não roda nesse caminho. O
 * plugin não daria erro: ele geraria service worker NENHUM, em silêncio,
 * e o app pareceria um PWA sem nunca instalar de verdade. (A última
 * publicação do pacote é de setembro de 2024, anterior ao Next 15.)
 *
 * Seguimos o caminho nativo documentado neste próprio Next
 * (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`):
 * `app/manifest.ts` + `public/sw.js` + registro no cliente. Menos
 * dependência, e o comportamento de cache fica sob nosso controle — o
 * que importa num painel financeiro (ver o comentário em `public/sw.js`).
 */
const nextConfig: NextConfig = {
  /**
   * Chromium e Puppeteer NÃO podem ser empacotados.
   *
   * `@sparticuz/chromium` carrega um binário de ~50MB comprimido em
   * brotli e o descompacta em /tmp no primeiro uso. Se o bundler tentar
   * incluí-lo, duas coisas quebram: o binário é tratado como módulo JS
   * e falha o build, ou passa e a função estoura o limite de tamanho da
   * Vercel. `serverExternalPackages` faz o Next deixá-los como
   * `require` de runtime.
   */
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],

  /**
   * As fontes do PDF viajam com a função.
   *
   * `src/lib/reports/pdf/document.tsx` lê os dois `.ttf` do disco com
   * `join(process.cwd(), "src/assets/fonts", ...)`. O rastreador de
   * arquivos do Next segue `import`, não caminho montado em tempo de
   * execução — sem esta lista os arquivos ficam de fora do bundle da
   * Vercel e o `Font.register` falha ao abrir, EM PRODUÇÃO APENAS.
   * Local funciona porque o disco tem o repositório inteiro, o que faz
   * deste o tipo de defeito que só aparece depois do deploy.
   *
   * As chaves são globs de ROTA. Quatro caminhos geram PDF: a rota de
   * geração, a de pré-visualização, o cron diário e a rota de impressão.
   */
  outputFileTracingIncludes: {
    "/api/reports/generate": ["src/assets/fonts/**/*"],
    "/api/reports/preview": ["src/assets/fonts/**/*"],
    "/api/cron/daily": ["src/assets/fonts/**/*"],
    "/reports/render/[clientId]": ["src/assets/fonts/**/*"],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Impede o browser de adivinhar o tipo do arquivo.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Este é um painel autenticado: não deve ser embutido em
          // iframe de terceiro (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          // Sem isto, um service worker antigo fica preso no cache HTTP
          // e o usuário nunca recebe a versão nova — o bug de PWA mais
          // difícil de diagnosticar, porque só acontece com quem já
          // visitou o site antes.
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
