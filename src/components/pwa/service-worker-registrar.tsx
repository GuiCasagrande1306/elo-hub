"use client";

import { useEffect } from "react";

/**
 * Registra o service worker.
 *
 * Só em produção: em desenvolvimento um SW ativo intercepta as
 * requisições do Turbopack e faz o hot reload servir arquivo velho — o
 * sintoma é "salvei e a tela não mudou", que custa muito tempo até
 * alguém desconfiar do cache.
 *
 * Não renderiza nada; existe apenas pelo efeito.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    // Espera o load: registrar durante a hidratação compete por banda
    // com os assets da primeira pintura.
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // O browser revalida o script do SW a cada navegação em vez de
          // confiar no cache HTTP — junto com o header no next.config,
          // é o que garante que uma versão nova chegue ao usuário.
          updateViaCache: "none",
        });

        if (cancelled) return;

        // Se já houver um SW novo esperando, ativa na próxima navegação.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
               
              console.info("[pwa] nova versão disponível — recarregue a página.");
            }
          });
        });
      } catch (error) {
        // Falha ao registrar não pode quebrar o app: PWA é progressivo.
        console.error("[pwa] falha ao registrar o service worker:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
