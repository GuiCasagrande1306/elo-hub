import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Espera da árvore ao vivo.
 *
 * O esqueleto imita a FORMA da tabela — cinco linhas, quatro colunas,
 * primeira mais larga — para a página não pular de altura quando os
 * dados chegam. Um spinner solto no meio do vazio faria o conteúdo
 * "cair" na tela ao carregar.
 *
 * O texto nomeia as plataformas de propósito: são 2 a 4 segundos
 * esperando uma API externa, e "carregando" faria parecer lentidão do
 * sistema em vez de ida à Meta e ao Google.
 */
export function AdsManagerSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        Buscando dados em tempo real na Meta e no Google…
      </p>

      <div className="surface-card overflow-hidden">
        <div className="grid grid-cols-[1fr_90px_80px_80px] gap-3 border-b border-hairline px-3 py-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3" />
          ))}
        </div>

        <div className="divide-y divide-hairline">
          {Array.from({ length: 5 }).map((_, linha) => (
            <div
              key={linha}
              className="grid grid-cols-[1fr_90px_80px_80px] items-center gap-3 px-3 py-3"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="size-3.5 shrink-0 rounded" />
                {/* Larguras diferentes por linha: barras idênticas
                    parecem um padrão de carregamento travado. */}
                <Skeleton
                  className="h-3.5"
                  style={{ width: `${55 + ((linha * 13) % 35)}%` }}
                />
              </div>
              {Array.from({ length: 3 }).map((_, coluna) => (
                <Skeleton key={coluna} className="h-3.5 justify-self-end w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
