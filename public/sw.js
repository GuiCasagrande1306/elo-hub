/* =====================================================================
   Service Worker — Elo Hub
   ---------------------------------------------------------------------
   ⚠️ DECISÃO CENTRAL: este service worker NÃO faz cache de dados.

   O padrão de PWA que a maioria dos tutoriais ensina — cache-first,
   guardando respostas de API para funcionar offline — seria ativamente
   perigoso aqui. Este é um painel financeiro: mostrar um investimento de
   R$ 20 mil que na verdade já é R$ 34 mil, sem nenhum aviso de que o
   número está velho, é pior do que mostrar uma tela de erro. O gestor
   toma decisão de verba em cima disso.

   Some-se a isso que toda resposta é filtrada por RLS: um cache
   compartilhado por origem poderia servir dado de uma sessão para outra
   depois de uma troca de usuário no mesmo dispositivo.

   O que este SW faz, então:
     • pré-carrega a casca (rota offline + ícones), para o app abrir
       instalado mesmo sem rede;
     • network-first para navegação, com fallback para a página offline;
     • cache-first APENAS para assets versionados do Next
       (/_next/static/*), que têm hash no nome e são imutáveis;
     • ignora completamente /api/*, /auth/* e qualquer não-GET.
   ===================================================================== */

const VERSION = "elo-hub-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

const OFFLINE_URL = "/offline";

const SHELL_ASSETS = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` evita popular o cache a partir do cache HTTP do browser.
      await cache.addAll(
        SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" })),
      );
      // Ativa imediatamente, sem esperar as abas antigas fecharem.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches de versões anteriores.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só GET. POST/PATCH/DELETE nunca passam pelo SW.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Só a própria origem — nada de interceptar chamadas ao Supabase.
  if (url.origin !== self.location.origin) return;

  // Rotas de dados e de sessão jamais são cacheadas nem servidas do SW.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login")
  ) {
    return;
  }

  // Assets do Next têm hash no nome: imutáveis, cache-first é seguro.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navegação: sempre rede primeiro. Offline cai na página dedicada,
  // que diz claramente que está sem conexão — em vez de mostrar
  // números velhos como se fossem atuais.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      new Response("Sem conexão.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}
