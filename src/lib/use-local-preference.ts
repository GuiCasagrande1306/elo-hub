"use client";

import { useCallback, useSyncExternalStore } from "react";

/* =====================================================================
   Preferência de interface guardada no navegador
   ---------------------------------------------------------------------
   Configuração de tabela — quais colunas aparecem, por onde ordena — é
   preferência de QUEM OLHA, não dado do sistema. Guardar no Postgres
   custaria uma tabela, uma policy e um round-trip por clique para
   resolver algo que ninguém precisa ver de outro dispositivo.

   `useSyncExternalStore` e não `useState` + `useEffect`: o valor mora no
   `localStorage`, que é fonte externa. Assinar por ela evita o
   `setState` dentro de efeito que o React Compiler recusa, e o snapshot
   de servidor dá um valor estável para a renderização no servidor — sem
   ele, servidor e cliente renderizariam colunas diferentes e o React
   acusaria divergência de hidratação.

   ⚠️ `getSnapshot` PRECISA devolver a MESMA referência enquanto o valor
   não muda. Fazer `JSON.parse` a cada chamada devolve um objeto novo
   toda vez, o React entende como mudança e entra em laço infinito de
   renderização. Por isso o cache por texto bruto abaixo.
   ===================================================================== */

const EVENTO = "elo-hub:preferencia";

/** Cache do último parse, por chave. Ver o aviso acima. */
const cache = new Map<string, { bruto: string | null; valor: unknown }>();

function ler<T>(chave: string, padrao: T): T {
  const bruto =
    typeof window === "undefined" ? null : window.localStorage.getItem(chave);

  const anterior = cache.get(chave);
  if (anterior && anterior.bruto === bruto) return anterior.valor as T;

  let valor: T = padrao;
  if (bruto !== null) {
    try {
      valor = JSON.parse(bruto) as T;
    } catch {
      /* Preferência corrompida volta ao padrão em silêncio: é ajuste de
         tela, e travar a página por causa dela seria desproporcional. */
      valor = padrao;
    }
  }

  cache.set(chave, { bruto, valor });
  return valor;
}

function assinar(onChange: () => void): () => void {
  /* `storage` cobre outra aba; o evento próprio cobre esta aba, onde o
     `storage` não dispara para quem escreveu. */
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENTO, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENTO, onChange);
  };
}

export function useLocalPreference<T>(
  chave: string,
  padrao: T,
): [T, (valor: T) => void] {
  const valor = useSyncExternalStore(
    assinar,
    () => ler(chave, padrao),
    () => padrao,
  );

  const definir = useCallback(
    (novo: T) => {
      window.localStorage.setItem(chave, JSON.stringify(novo));
      window.dispatchEvent(new Event(EVENTO));
    },
    [chave],
  );

  return [valor, definir];
}
