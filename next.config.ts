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
