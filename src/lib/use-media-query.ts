"use client";

import { useCallback, useSyncExternalStore } from "react";

/* =====================================================================
   Media query em JavaScript — para quando esconder com CSS não basta
   ---------------------------------------------------------------------
   `lg:hidden` esconde o que aparece na tela e NÃO desmonta o componente.
   Para a maioria das coisas isso é ótimo: é mais barato que remontar e
   não perde estado. Para um `Dialog` ou `Sheet` é um defeito silencioso
   — o Root continua ativo, com trava de foco e detecção de clique fora,
   e um modal invisível passa a engolir cliques do resto da página.

   Foi exatamente o que aconteceu no EloChat: com um nó selecionado,
   existia no desktop uma gaveta invisível aberta, e o primeiro clique
   em qualquer lugar contava como "clique fora" e limpava a seleção.

   `useSyncExternalStore` e não `useState` + `useEffect`: o estado mora
   no `matchMedia`, que é fonte externa. Assinar por ela evita o
   `setState` dentro de efeito que o React Compiler recusa, e o snapshot
   de servidor dá um valor estável para a renderização no servidor.
   ===================================================================== */

/**
 * `true` quando a consulta casa. No servidor devolve `false`.
 *
 * O falso do servidor é deliberado: a versão de telas pequenas é a que
 * degrada melhor se o JavaScript demorar. Quem chama deve tratar isso
 * como "ainda não sei", não como "é celular".
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** O `lg` do Tailwind. Mantido junto para não divergir do CSS. */
export const CONSULTA_DESKTOP = "(min-width: 1024px)";
