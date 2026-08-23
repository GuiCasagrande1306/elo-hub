import Link from "next/link";
import { AlertTriangle, Globe, Clapperboard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import {
  lerBlocos,
  resumirBrief,
  STATUS_BRIEF_LABEL,
  type StatusBrief,
} from "@/lib/content/blocks";
import type { ContentBriefWithRelations } from "@/types/database";

/**
 * Cartão da listagem.
 *
 * O número que decide o dia é `pendencias` — quantos `[colchetes]`
 * ainda esperam confirmação do cliente. Enquanto ele não for zero, a
 * equipe não pode gravar sem inventar dado, e é a única informação da
 * listagem que muda o que se faz a seguir. Por isso ele é o único item
 * do cartão que ganha cor.
 */
export function BriefCard({ brief }: { brief: ContentBriefWithRelations }) {
  const blocos = lerBlocos(brief.blocos);
  const { roteiros, pendencias } = resumirBrief(blocos);
  const status = brief.status as StatusBrief;

  return (
    <Link
      href={`/conteudo/${brief.id}`}
      className="surface-card flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold leading-snug">
          {brief.titulo}
        </h3>
        <Badge variant={status === "aprovado" ? "default" : "outline"}>
          {STATUS_BRIEF_LABEL[status] ?? status}
        </Badge>
      </div>

      {brief.resumo ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {brief.resumo}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clapperboard className="size-3.5" />
          {roteiros} {roteiros === 1 ? "roteiro" : "roteiros"}
        </span>

        {pendencias > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <AlertTriangle className="size-3.5" />
            {pendencias} a confirmar
          </span>
        ) : null}

        {brief.share_token ? (
          <span className="inline-flex items-center gap-1.5">
            <Globe className="size-3.5" />
            Link ativo
          </span>
        ) : null}

        <span className="ml-auto">{formatDate(brief.updated_at)}</span>
      </div>
    </Link>
  );
}
