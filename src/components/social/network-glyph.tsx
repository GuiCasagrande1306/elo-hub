import { AtSign } from "lucide-react";

import { cn } from "@/lib/utils";
import { rede } from "@/lib/social/networks";
import type { SocialNetwork } from "@/types/database";

/* =====================================================================
   Marcas das redes
   ---------------------------------------------------------------------
   DESENHADAS AQUI porque o lucide-react removeu os ícones de marca. As
   alternativas eram piores: instalar um segundo pacote de ícones só por
   nove glifos, ou cair em iniciais dentro de quadradinhos — que a essa
   altura já não se distinguem de dois metros e obrigam a ler.

   Traço, não preenchimento. As marcas oficiais são sólidas e coloridas;
   copiá-las traria um bloco de cor saturada para o meio de uma interface
   que é toda de contorno fino, e um Instagram degradê ao lado de um
   ícone lucide de 1,9px denuncia a colagem. Aqui elas herdam o mesmo
   peso de traço do resto e recebem a cor da marca via `currentColor` —
   reconhecíveis a 14px, sem quebrar o desenho da tela.

   Threads e Google Meu Negócio usam ícones do lucide (`AtSign`,
   `Store`): a marca do Threads É uma variação de arroba, e o Google Meu
   Negócio não tem símbolo que sobreviva a 14px. Redesenhá-los seria
   inventar diferença onde não há.
   ===================================================================== */

const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Marca({
  network,
  className,
}: {
  network: SocialNetwork;
  className?: string;
}) {
  const comum = {
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
  } as const;

  switch (network) {
    case "instagram":
      return (
        <svg {...comum} {...TRACO}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.1" cy="6.9" r="1.05" fill="currentColor" stroke="none" />
        </svg>
      );

    case "facebook":
      return (
        <svg {...comum} {...TRACO}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <path d="M14.8 8.2h-1.3c-1 0-1.8.8-1.8 1.8v6.6" />
          <path d="M10 12.4h3.9" />
        </svg>
      );

    case "tiktok":
      return (
        <svg {...comum} {...TRACO}>
          {/* Haste + a bolinha da nota, em arco de raio 3,6. */}
          <path d="M14.8 4.6v9.8a3.6 3.6 0 1 1-3.6-3.6" />
          <path d="M14.8 4.6c.4 2.1 2 3.6 4.2 3.9" />
        </svg>
      );

    case "youtube":
      return (
        <svg {...comum} {...TRACO}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path
            d="M10.6 9.4l5.4 2.6-5.4 3z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      );

    default:
      return <AtSign className={className} strokeWidth={1.9} aria-hidden />;
  }
}

/**
 * Glifo da rede, já na cor da marca.
 *
 * A cor vai em `style` e não em classe porque é dado do catálogo, não
 * token do tema — Tailwind não gera classe para um hex que só existe em
 * tempo de execução. Os tons do catálogo foram escolhidos para
 * sobreviver aos dois temas; ver `REDES` em `@/lib/social/networks`.
 */
export function NetworkGlyph({
  network,
  className,
  colorida = true,
}: {
  network: SocialNetwork;
  className?: string;
  /** `false` = herda a cor do texto ao redor (linhas apagadas, arquivadas). */
  colorida?: boolean;
}) {
  const r = rede(network);

  return (
    <span
      title={r.label}
      style={colorida ? { color: r.cor } : undefined}
      className={cn("inline-flex shrink-0", !colorida && "text-muted-foreground")}
    >
      <Marca network={network} className={cn("size-4", className)} />
      <span className="sr-only">{r.label}</span>
    </span>
  );
}

/**
 * Fila de glifos de um post.
 *
 * Mostra no máximo quatro e conta o resto. Um post em nove redes é raro,
 * mas quando acontece a fila de ícones empurra o título da célula para
 * fora — e o título é o que se lê primeiro.
 */
export function NetworkRow({
  networks,
  max = 4,
  className,
  colorida = true,
}: {
  networks: SocialNetwork[];
  max?: number;
  className?: string;
  colorida?: boolean;
}) {
  const visiveis = networks.slice(0, max);
  const resto = networks.length - visiveis.length;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {visiveis.map((n) => (
        <NetworkGlyph key={n} network={n} colorida={colorida} />
      ))}
      {resto > 0 && (
        <span className="text-2xs tabular-nums text-muted-foreground">
          +{resto}
        </span>
      )}
    </span>
  );
}
