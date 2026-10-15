"use client";

import { useEffect, useRef } from "react";

/* =====================================================================
   Camada interativa do relatório — SÓ no caminho web
   ---------------------------------------------------------------------
   Envolve a `FolhaDeRolagem` quando um humano abre o relatório no
   navegador (link público). Dá movimento de entrada às seções, uma
   barra de progresso de leitura e o acento da marca do cliente.

   ⚠️ NÃO entra na rota `/reports/render`: aquela é fotografada pelo
   Puppeteer, e animação brigaria com `networkidle0` / `document.fonts
   .ready`, sujando a captura. Esta camada vive só no caminho que um
   navegador humano percorre.

   ⚠️ PROGRESSIVE ENHANCEMENT, e é o que protege o conteúdo. Nada é
   escondido por CSS estático: é o JS que "arma" o reveal marcando cada
   seção com `data-revelar`. Sem JS, ou com `prefers-reduced-motion`, o
   relatório aparece inteiro e parado — nunca uma seção presa em
   `opacity: 0`. É a mesma regra que já custou retrabalho no projeto.

   ⚠️ SEM BLUR na entrada das seções, embora seja a receita padrão: elas
   são densas em texto e número, e blur na entrada de texto prejudica a
   leitura no primeiro quadro. Só opacity + translateY.
   ===================================================================== */

export function RelatorioInterativo({
  brand,
  children,
}: {
  /** Cor primária da marca do cliente — tinge a barra de progresso. */
  brand: string;
  children: React.ReactNode;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;

    const reduz = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    /* Barra de progresso de leitura: orientação (quão longe no
       relatório), não enfeite. `scaleX` não causa reflow; rAF evita
       rodar a conta a cada evento de scroll. */
    let pedido = 0;
    const aoRolar = () => {
      if (pedido) return;
      pedido = requestAnimationFrame(() => {
        pedido = 0;
        const d = document.documentElement;
        const max = d.scrollHeight - d.clientHeight;
        const p = max > 0 ? Math.min(1, d.scrollTop / max) : 0;
        if (barra.current) barra.current.style.transform = `scaleX(${p})`;
      });
    };
    window.addEventListener("scroll", aoRolar, { passive: true });
    aoRolar();

    /* Reveal das seções — só quando o movimento é permitido. O JS é
       quem esconde (data-revelar); por isso sem JS nada fica oculto. */
    let obs: IntersectionObserver | undefined;
    if (!reduz && "IntersectionObserver" in window) {
      const alvos = Array.from(
        el.querySelectorAll<HTMLElement>("main > header, main > section"),
      );
      alvos.forEach((alvo, i) => {
        alvo.dataset.revelar = "";
        alvo.style.setProperty("--atraso", `${Math.min(i, 6) * 70}ms`);
      });
      obs = new IntersectionObserver(
        (entradas) => {
          for (const e of entradas) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.visivel = "";
            obs!.unobserve(e.target);
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
      );
      alvos.forEach((alvo) => obs!.observe(alvo));
    }

    return () => {
      window.removeEventListener("scroll", aoRolar);
      if (pedido) cancelAnimationFrame(pedido);
      obs?.disconnect();
    };
  }, []);

  return (
    <div ref={raiz}>
      {/* Progresso de leitura na cor da marca. scaleX de 0→1. */}
      <div
        ref={barra}
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left"
        style={{ background: brand, transform: "scaleX(0)" }}
      />

      <style>{`
        [data-revelar] {
          opacity: 0;
          transform: translateY(16px);
          transition:
            opacity .5s cubic-bezier(0.16, 1, 0.3, 1),
            transform .5s cubic-bezier(0.16, 1, 0.3, 1);
          transition-delay: var(--atraso, 0ms);
        }
        [data-revelar][data-visivel] {
          opacity: 1;
          transform: none;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-revelar] {
            opacity: 1 !important;
            transform: none !important;
            transition: none !important;
          }
        }
      `}</style>

      {children}
    </div>
  );
}
