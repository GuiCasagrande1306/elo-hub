"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MOTIVOS_DESCARTE } from "@/lib/leads/vocabulario";
import type { LeadWithRelations } from "@/types/database";

/* =====================================================================
   Por que este lead não presta
   ---------------------------------------------------------------------
   Um diálogo só, usado pela triagem E pelo quadro — arrastar um cartão
   para "Perdido" tem que pedir a mesma coisa que o botão Descartar, ou o
   caminho mais preguiçoso vira o que produz dado pior.

   ⚠️ OS MOTIVOS ESTÃO AGRUPADOS, e o agrupamento é a ideia inteira.

   À esquerda, o que acusa a CAMPANHA: a pessoa nunca deveria ter
   chegado. À direita, o que acusa o ATENDIMENTO ou o acaso: a pessoa era
   certa e não fechou. Uma lista única de nove botões faria as duas
   coisas parecerem a mesma, e o total do fim do mês misturaria problema
   de mídia com problema de vendas — que é exatamente o número que
   ninguém consegue usar.

   Separados, a leitura fica direta: se a coluna da esquerda cresce, o
   ajuste é na segmentação; se é a da direita, o ajuste é no follow-up.
   ===================================================================== */

export function MotivoDoDescarte({
  lead,
  onCancelar,
  onConfirmar,
}: {
  /** `null` fecha o diálogo. O lead entra só para o título nomear quem é. */
  lead: LeadWithRelations | null;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const daCampanha = MOTIVOS_DESCARTE.filter((m) => m.culpaDaSegmentacao);
  const doProcesso = MOTIVOS_DESCARTE.filter((m) => !m.culpaDaSegmentacao);

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="max-h-[92vh] w-[94vw] overflow-y-auto sm:max-w-[min(94vw,620px)]">
        <DialogTitle>Por que descartar?</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          {lead ? (
            <>
              <span className="font-medium text-foreground">{lead.title}</span> sai
              do funil.{" "}
            </>
          ) : null}
          O motivo é a única coisa que o descarte produz de graça — é ele que
          diz se o problema está no anúncio ou no atendimento.
        </p>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Grupo
            titulo="O anúncio trouxe errado"
            nota="Conta contra a segmentação da campanha."
            motivos={daCampanha}
            onEscolher={onConfirmar}
          />
          <Grupo
            titulo="Era perfil, mas não fechou"
            nota="Não conta contra a campanha."
            motivos={doProcesso}
            onEscolher={onConfirmar}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Grupo({
  titulo,
  nota,
  motivos,
  onEscolher,
}: {
  titulo: string;
  nota: string;
  motivos: typeof MOTIVOS_DESCARTE;
  onEscolher: (motivo: string) => void;
}) {
  return (
    <div>
      <p className="eyebrow">{titulo}</p>
      <p className="mt-0.5 text-2xs text-muted-foreground">{nota}</p>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {motivos.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onEscolher(m.id)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="block text-sm font-medium">{m.label}</span>
            {m.dica && (
              <span className="mt-0.5 block text-2xs text-muted-foreground">
                {m.dica}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
