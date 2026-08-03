/* eslint-disable @next/next/no-img-element */
import { ExternalLink } from "lucide-react";

import type { AdCreative } from "@/types/database";
import { PLATFORM_LABELS } from "@/lib/metrics/kpi";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Galeria de anúncios ativos.
 *
 * Este componente é o espelho em tela da seção `ad_gallery` do PDF: os
 * dois consomem a mesma linha de `ad_creatives`, então o que o cliente
 * vê no relatório é exatamente o que o gestor vê no painel.
 *
 * Usa <img> em vez de next/image de propósito — as miniaturas vêm de
 * hosts externos (scontent.*.fbcdn.net da Meta, googleusercontent) com
 * URLs assinadas e efêmeras. Cadastrar esses domínios em
 * `images.remotePatterns` seria frágil e o cache do otimizador guardaria
 * URLs já expiradas. O sync copia as imagens para o bucket `ad-thumbs`;
 * `storage_path` tem precedência quando a cópia existe.
 */

interface AdGalleryProps {
  creatives: AdCreative[];
  className?: string;
}

export function AdGallery({ creatives, className }: AdGalleryProps) {
  if (creatives.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum criativo ativo sincronizado neste período.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {creatives.map((ad) => (
        <AdCard key={ad.id} ad={ad} />
      ))}
    </div>
  );
}

function AdCard({ ad }: { ad: AdCreative }) {
  const cpa = ad.conversions > 0 ? ad.spend_cents / ad.conversions : 0;
  const ctr = ad.impressions > 0 ? ad.clicks / ad.impressions : 0;

  return (
    <article className="surface-card group flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {ad.thumbnail_url ? (
          <img
            src={ad.thumbnail_url}
            alt={ad.ad_name ?? "Criativo"}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            sem miniatura
          </div>
        )}

        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur">
          {PLATFORM_LABELS[ad.platform]}
        </span>

        {ad.destination_url && (
          <a
            href={ad.destination_url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-2.5 top-2.5 rounded-full bg-black/65 p-1.5 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Abrir destino do anúncio"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="truncate text-2xs text-muted-foreground" title={ad.campaign_name ?? ""}>
          {ad.campaign_name}
        </p>
        <h4 className="mt-1 text-sm font-medium leading-snug">{ad.headline}</h4>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {ad.primary_text}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
          <Metric label="Investido" value={formatCurrency(ad.spend_cents)} />
          <Metric label="Resultados" value={formatNumber(ad.conversions)} />
          <Metric
            label="CPA"
            value={cpa > 0 ? formatCurrency(cpa) : "—"}
            highlight
          />
        </dl>

        <p className="mt-2.5 text-[11px] text-muted-foreground tabular-nums">
          CTR {(ctr * 100).toFixed(2).replace(".", ",")}% ·{" "}
          {formatNumber(ad.clicks)} cliques
        </p>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-xs font-medium tabular-nums",
          highlight && "text-signal",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
