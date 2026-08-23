import { Phone } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROTULO_ORIGEM, type LeadDeal } from "@/lib/crm/types";

/* =====================================================================
   O card do lead
   ---------------------------------------------------------------------
   TRÊS INFORMAÇÕES, e a ordem responde à pergunta de quem varre a
   coluna: quem é, quanto vale, por onde chegou.

   O telefone entra porque num funil de serviço a ação seguinte é
   ligar — e obrigar a abrir a ficha para ver o número transforma um
   clique em três.
   ===================================================================== */

export function LeadCard({
  deal,
  arrastando,
}: {
  deal: LeadDeal;
  arrastando?: boolean;
}) {
  return (
    <article
      className={cn(
        "surface-card flex flex-col gap-1.5 p-2.5 transition-shadow",
        arrastando
          ? "rotate-1 shadow-lg ring-1 ring-signal"
          : "hover:ring-1 hover:ring-hairline",
      )}
    >
      <p className="line-clamp-2 text-xs font-medium leading-snug">
        {deal.title}
      </p>

      {deal.contact?.name && deal.contact.name !== deal.title && (
        <p className="truncate text-2xs text-muted-foreground">
          {deal.contact.name}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Valor zero não vira "R$ 0,00": lead sem valor estimado é o
            caso comum na entrada, e um zero em toda coluna treina o
            olho a ignorar a linha do dinheiro. */}
        <span className="text-2xs font-semibold tabular-nums">
          {deal.value_cents > 0 ? formatCurrency(deal.value_cents) : ""}
        </span>

        <span className="shrink-0 text-[10px] text-muted-foreground">
          {ROTULO_ORIGEM[deal.source]}
        </span>
      </div>

      {deal.contact?.phone && (
        <p className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
          <Phone className="size-2.5 shrink-0" />
          {formatarTelefone(deal.contact.phone)}
        </p>
      )}
    </article>
  );
}

/**
 * "47999998888" → "(47) 99999-8888".
 *
 * O banco guarda só dígitos — ver o índice único de `lead_contacts`,
 * que é o que faz o mesmo telefone virar o mesmo contato. A máscara é
 * de leitura, e é montada aqui para não existir em duas versões.
 */
export function formatarTelefone(digitos: string): string {
  const d = digitos.replace(/\D/g, "");

  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

  /* Fora dos dois formatos brasileiros, devolve como veio. Inventar
     uma máscara para um número internacional produz algo que ninguém
     consegue discar. */
  return d;
}
