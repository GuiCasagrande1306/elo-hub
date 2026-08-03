import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Sem conexão" };

/**
 * Página servida pelo service worker quando a navegação falha.
 *
 * Deliberadamente NÃO mostra nenhum número em cache. Este é um painel
 * de investimento: um valor desatualizado exibido sem aviso leva a
 * decisão de verba errada. Dizer "sem conexão" é mais útil — e mais
 * honesto — do que mostrar dado velho com cara de atual.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-hairline">
        <WifiOff className="size-5 text-muted-foreground" />
      </span>

      <div>
        <h1 className="text-lg font-semibold tracking-[-0.015em]">
          Você está sem conexão
        </h1>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Os números de investimento e resultados mudam o tempo todo, então o
          Elo Hub não guarda cópia offline — um valor velho aqui viraria
          decisão errada de verba.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Assim que a conexão voltar, recarregue a página.
      </p>
    </main>
  );
}
