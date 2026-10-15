"use client";

import { useState } from "react";
import { Check, Mail, MessageCircle, Phone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TempoDesde, tomDaEspera } from "./tempo-desde";
import { MotivoDoDescarte } from "./motivo-do-descarte";
import {
  ORIGEM_LEAD_LABEL,
  formatarTelefone,
} from "@/lib/leads/vocabulario";
import { cn } from "@/lib/utils";
import type { LeadStage, LeadWithRelations } from "@/types/database";

/* =====================================================================
   Triagem
   ---------------------------------------------------------------------
   A tela pela qual este módulo existe.

   O quadro Kanban responde "como está o funil". A triagem responde a
   única pergunta que o cliente sabe responder e ninguém mais: ESSE LEAD
   PRESTOU? Arrastar cartão é gesto de quem administra um processo; quem
   atende o telefone quer duas teclas — serviu, não serviu.

   ⚠️ DESCARTAR EXIGE MOTIVO, e é aqui que está o valor. Sem o motivo,
   "descartamos 40 este mês" não vira decisão nenhuma. Com ele, a
   diferença entre "sumiu depois de responder" (falha de atendimento) e
   "mora fora da região" (falha de segmentação) é o que diz se o
   problema está no time do cliente ou na verba da campanha — e é o
   único caminho para devolver esse sinal à mídia depois.

   A fila mostra só o que está na PRIMEIRA etapa aberta do funil: é o
   que chegou e ninguém tocou. Lead já em conversa não se tria, se
   trabalha — e ele vive no quadro.
   ===================================================================== */

export function Triagem({
  leads,
  stages,
  onQualificar,
  onDescartar,
  onAbrir,
}: {
  /** Já filtrados pelo workspace: só a primeira etapa aberta. */
  leads: LeadWithRelations[];
  stages: LeadStage[];
  onQualificar: (leadId: string) => void;
  onDescartar: (leadId: string, motivo: string) => void;
  onAbrir: (leadId: string) => void;
}) {
  const [descartando, setDescartando] = useState<LeadWithRelations | null>(null);

  const temEtapaDeDescarte = stages.some((e) => e.kind === "perdido");

  if (leads.length === 0) {
    return (
      <div className="surface-card px-6 py-14 text-center">
        <p className="text-sm font-medium">Fila vazia.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Nenhum lead esperando triagem. Quando chegar gente nova pelos
          anúncios, ela aparece aqui antes de qualquer outra tela.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Uma coluna só, e larga. Grade de cartões faria a pessoa varrer
          em duas direções para achar o próximo; a fila tem uma ordem —
          quem esperou mais vem primeiro — e ela só é legível de cima
          para baixo. */}
      <div className="flex flex-col gap-2.5">
        {leads.map((lead) => (
          <LinhaDaTriagem
            key={lead.id}
            lead={lead}
            onQualificar={() => onQualificar(lead.id)}
            onDescartar={() => setDescartando(lead)}
            onAbrir={() => onAbrir(lead.id)}
            podeDescartar={temEtapaDeDescarte}
          />
        ))}
      </div>

      <MotivoDoDescarte
        lead={descartando}
        onCancelar={() => setDescartando(null)}
        onConfirmar={(motivo) => {
          const alvo = descartando;
          setDescartando(null);
          if (alvo) onDescartar(alvo.id, motivo);
        }}
      />
    </>
  );
}

function LinhaDaTriagem({
  lead,
  onQualificar,
  onDescartar,
  onAbrir,
  podeDescartar,
}: {
  lead: LeadWithRelations;
  onQualificar: () => void;
  onDescartar: () => void;
  onAbrir: () => void;
  podeDescartar: boolean;
}) {
  const telefone = formatarTelefone(lead.contact?.phone ?? null);
  const zap = linkDoWhatsApp(lead.contact?.phone ?? null);
  const tom = tomDaEspera(lead.created_at, true);

  return (
    <article className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onAbrir}
            className="truncate text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            {lead.title}
          </button>

          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {ORIGEM_LEAD_LABEL[lead.source]}
          </span>

          {/* A ESPERA EM DESTAQUE. Numa fila de triagem ela não é um
              detalhe do rodapé: é o que decide qual linha atender
              primeiro, e o que denuncia quando a fila parou. */}
          <span
            className={cn(
              "shrink-0 text-2xs",
              tom === "quente" && "text-muted-foreground",
              tom === "morno" && "font-medium text-warning",
              tom === "frio" && "font-medium text-negative",
            )}
          >
            esperando há <TempoDesde iso={lead.created_at} />
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {telefone ? (
            <span className="flex items-center gap-1 tabular-nums">
              <Phone className="size-3" />
              {telefone}
            </span>
          ) : (
            <span className="text-muted-foreground/60">sem telefone</span>
          )}

          {lead.contact?.email && (
            <span className="flex min-w-0 items-center gap-1">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{lead.contact.email}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {zap && (
          /* `nativeButton={false}` + `render`: este shadcn roda sobre
             Base UI, onde a composição é `render={<a/>}` — `asChild` é
             API do Radix e renderizaria um <a> dentro de um <button>. */
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={zap}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir conversa no WhatsApp com ${lead.title}`}
              />
            }
          >
            <MessageCircle className="size-3.5" />
            WhatsApp
          </Button>
        )}

        {/* OS DOIS BOTÕES TÊM PESOS DIFERENTES de propósito. Qualificar é
            a ação que se quer fácil e frequente; descartar é
            consequência — some do funil e pede um motivo. Dar aos dois o
            mesmo destaque convidaria a limpar a fila no reflexo. */}
        <Button size="sm" onClick={onQualificar}>
          <Check className="size-3.5" />
          Qualificado
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDescartar}
          disabled={!podeDescartar}
          title={
            podeDescartar
              ? undefined
              : "Este funil não tem etapa de descarte configurada."
          }
          className="text-muted-foreground hover:text-negative"
        >
          <X className="size-3.5" />
          Descartar
        </Button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Link de conversa a partir do telefone guardado.
 *
 * O banco guarda só dígitos, e sem país: 11 dígitos é celular com DDD,
 * 10 é fixo. O `wa.me` exige o código do país, então o 55 entra aqui —
 * e SÓ nesses dois tamanhos. Um número já internacional (13 dígitos,
 * por exemplo) passa intacto; prefixar 55 nele produziria um link que
 * abre uma conversa com ninguém.
 */
function linkDoWhatsApp(digitos: string | null): string | null {
  if (!digitos) return null;
  const numero =
    digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  return `https://wa.me/${numero}`;
}
