"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadsBoard } from "./leads-board";
import { LeadDialog } from "./lead-dialog";
import { ImportarLeadMetaModal } from "./importar-lead-meta-modal";
import { MotivoDoDescarte } from "./motivo-do-descarte";
import { NewLeadDialog } from "./new-lead-dialog";
import { Triagem } from "./triagem";
import { moverLead } from "@/app/(app)/leads/actions";
import { resumirFunil } from "@/lib/leads/vocabulario";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Client,
  LeadBoard,
  LeadStageKind,
  LeadWithRelations,
  Profile,
} from "@/types/database";

/* =====================================================================
   A tela do funil de leads
   ---------------------------------------------------------------------
   DUAS VISÕES DO MESMO FUNIL, e a ordem entre elas é a tese do módulo.

   "Triagem" vem primeiro e abre por padrão: é a pergunta que só o
   cliente sabe responder — esse lead prestou? O quadro vem depois, para
   quem quer administrar o processo. Abrir no Kanban faria a tela
   parecer mais um CRM genérico, e o trabalho que ela existe para
   coletar ficaria escondido atrás de uma aba.

   O CABEÇALHO CARREGA O ARGUMENTO. O último cartão — quanto do descarte
   acusa a segmentação — é o único número desta tela que fala com quem
   compra mídia. Os outros descrevem o funil; ele diz se a verba está
   comprando a pessoa certa.
   ===================================================================== */

export function LeadsWorkspace({
  board,
  client,
  clients,
  team,
  podeTrocarDeConta,
}: {
  board: LeadBoard;
  client: Client;
  /** Vazio para usuário de cliente — ele não escolhe conta. */
  clients: Client[];
  team: Profile[];
  podeTrocarDeConta: boolean;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  /* Descartar pede motivo, e o motivo é perguntado no momento em que o
     cartão cai na coluna — não depois, num formulário que a pessoa vai
     fechar. `pendente` segura o movimento até a resposta. */
  const [pendente, setPendente] = useState<{
    lead: LeadWithRelations;
    stageId: string;
    position: number;
  } | null>(null);

  const kindDaEtapa = useMemo(() => {
    const mapa = new Map(board.stages.map((e) => [e.id, e.kind]));
    return (stageId: string): LeadStageKind => mapa.get(stageId) ?? "aberto";
  }, [board.stages]);

  const resumo = useMemo(
    () => resumirFunil(board.leads, kindDaEtapa),
    [board.leads, kindDaEtapa],
  );

  /* A fila de triagem é a PRIMEIRA etapa aberta: o que chegou e ninguém
     tocou. Lead já em conversa não se tria, se trabalha — e ele vive no
     quadro. */
  const etapaDeEntrada = board.stages.find((e) => e.kind === "aberto") ?? null;

  const naFila = useMemo(() => {
    if (!etapaDeEntrada) return [];
    return board.leads
      .filter((l) => l.stage_id === etapaDeEntrada.id)
      // Quem esperou mais vem primeiro: numa fila, a ordem é a dívida.
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [board.leads, etapaDeEntrada]);

  const leadAberto = board.leads.find((l) => l.id === abertoId) ?? null;

  /* ---------------------------------------------------------------- */

  function mover(leadId: string, stageId: string, position: number) {
    const lead = board.leads.find((l) => l.id === leadId);
    if (!lead) return;

    if (kindDaEtapa(stageId) === "perdido") {
      setPendente({ lead, stageId, position });
      return;
    }

    iniciar(async () => {
      const r = await moverLead({ dealId: leadId, stageId, position });
      if (!r.ok) {
        toast.error(r.error);
        /* O quadro aplicou o movimento de forma otimista. Sem o refresh,
           a tela ficaria mostrando um estado que o banco recusou. */
        router.refresh();
      }
    });
  }

  /** Qualificar: avança para a próxima etapa aberta do funil. */
  function qualificar(leadId: string) {
    const lead = board.leads.find((l) => l.id === leadId);
    if (!lead) return;

    const abertas = board.stages.filter((e) => e.kind === "aberto");
    const atual = abertas.findIndex((e) => e.id === lead.stage_id);
    const destino = abertas[atual + 1];

    if (!destino) {
      /* Funil de uma etapa aberta só. Não há para onde avançar, e
         mandar para "Ganho" seria mentira: qualificado não é fechado. */
      toast.info(
        "Não há próxima etapa neste funil. Mova o lead pelo quadro quando ele avançar.",
      );
      return;
    }

    iniciar(async () => {
      const r = await moverLead({
        dealId: leadId,
        stageId: destino.id,
        position: Date.now(),
      });
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
        return;
      }
      toast.success(`Lead movido para ${destino.name}.`);
    });
  }

  function descartar(leadId: string, motivo: string) {
    const descarte = board.stages.find((e) => e.kind === "perdido");
    if (!descarte) {
      toast.error("Este funil não tem etapa de descarte configurada.");
      return;
    }

    iniciar(async () => {
      const r = await moverLead({
        dealId: leadId,
        stageId: descarte.id,
        position: Date.now(),
        lostReason: motivo,
      });
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
      }
    });
  }

  /* ---------------------------------------------------------------- */

  const percentualDeSegmentacao =
    resumo.descartados === 0
      ? null
      : Math.round((resumo.descartePorSegmentacao / resumo.descartados) * 100);

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------- Cabeçalho ------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* O ÚNICO CARTÃO ACIONÁVEL do bloco da esquerda, e por isso o
            que muda de cor. Os outros informam; este pede trabalho. */}
        <Metrica
          rotulo="Esperando triagem"
          valor={String(naFila.length)}
          nota={etapaDeEntrada ? `em ${etapaDeEntrada.name}` : "sem etapa inicial"}
          tom={naFila.length > 0 ? "alerta" : "neutro"}
        />
        <Metrica
          rotulo="Em atendimento"
          valor={String(Math.max(resumo.abertos - naFila.length, 0))}
          nota={
            resumo.emAberto > 0
              ? `${formatCurrency(resumo.emAberto)} em jogo`
              : "sem valor estimado"
          }
        />
        <Metrica
          rotulo="Ganhos"
          valor={String(resumo.ganhos)}
          nota={
            resumo.ganho > 0 ? formatCurrency(resumo.ganho) : "sem valor lançado"
          }
        />
        <Metrica
          rotulo="Aproveitamento"
          /* `null` vira travessão, e não "0%". Zero por cento é uma
             afirmação — e o primeiro dia de uso mostraria isso a um
             cliente que ainda não teve tempo de fechar nada. */
          valor={
            resumo.aproveitamento === null
              ? "—"
              : `${Math.round(resumo.aproveitamento * 100)}%`
          }
          nota={
            resumo.aproveitamento === null
              ? "nada fechado ainda"
              : `${resumo.ganhos} de ${resumo.ganhos + resumo.descartados} fechados`
          }
        />
        {/* O CARTÃO QUE FALA COM A MÍDIA. Todo o resto descreve o funil;
            este responde se a verba está comprando a pessoa certa. */}
        <Metrica
          /* "Culpa do anúncio" e não "Culpa da segmentação": o rótulo
             longo quebrava em duas linhas na coluna de 1/5 da largura e
             empurrava o número para baixo, desalinhando-o dos outros
             quatro. Uma fileira de métricas em que um valor senta mais
             baixo que os vizinhos é lida como defeito antes de ser lida
             como dado. */
          rotulo="Culpa do anúncio"
          valor={
            percentualDeSegmentacao === null ? "—" : `${percentualDeSegmentacao}%`
          }
          nota={
            resumo.descartados === 0
              ? "nenhum descarte ainda"
              : `${resumo.descartePorSegmentacao} de ${resumo.descartados} descartes`
          }
          tom={
            percentualDeSegmentacao !== null && percentualDeSegmentacao >= 50
              ? "alerta"
              : "neutro"
          }
        />
      </div>

      {/* --------------------------- Abas ---------------------------- */}
      <Tabs defaultValue="triagem" className="gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <TabsList>
            <TabsTrigger value="triagem">
              Triagem
              {naFila.length > 0 && (
                <span className="ml-1.5 rounded-full bg-signal/15 px-1.5 text-2xs font-semibold tabular-nums text-signal">
                  {naFila.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="quadro">Quadro</TabsTrigger>
          </TabsList>

          {podeTrocarDeConta && clients.length > 1 && (
            <Select
              value={client.slug}
              onValueChange={(v) => router.push(`/leads?cliente=${v}`)}
            >
              <SelectTrigger className="w-52">
                {/* ⚠️ `SelectValue` do Base UI recebe uma FUNÇÃO. Sem ela
                    o gatilho imprime o valor cru — apareceria o slug. */}
                <SelectValue>
                  {(v: string) =>
                    clients.find((c) => c.slug === v)?.name ?? client.name
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {podeTrocarDeConta && (
            <ImportarLeadMetaModal clientId={client.id} />
          )}

          <Button className={podeTrocarDeConta ? "" : "ml-auto"} onClick={() => setCriando(true)}>
            <Plus className="size-4" />
            Novo lead
          </Button>
        </div>

        <TabsContent value="triagem">
          <Triagem
            leads={naFila}
            stages={board.stages}
            onQualificar={qualificar}
            onDescartar={descartar}
            onAbrir={setAbertoId}
          />
        </TabsContent>

        <TabsContent value="quadro">
          {board.leads.length === 0 ? (
            <div className="surface-card px-6 py-14 text-center">
              <Inbox className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                Nenhum lead neste funil ainda.
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Cadastre quem entrou em contato, mesmo sem valor definido. É o
                registro de quem foi descartado — e por quê — que diz depois se
                o anúncio está trazendo a pessoa certa.
              </p>
              <Button className="mt-4" onClick={() => setCriando(true)}>
                <Plus className="size-4" />
                Criar o primeiro
              </Button>
            </div>
          ) : (
            <LeadsBoard
              stages={board.stages}
              leads={board.leads}
              onOpen={setAbertoId}
              onMove={mover}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* --------------------------- Modais -------------------------- */}
      <LeadDialog
        lead={leadAberto}
        stages={board.stages}
        team={team}
        podeAtribuir={podeTrocarDeConta}
        open={Boolean(leadAberto)}
        onOpenChange={(v) => !v && setAbertoId(null)}
      />

      <NewLeadDialog
        clientId={client.id}
        pipelineId={board.pipeline.id}
        stages={board.stages}
        team={team}
        podeAtribuir={podeTrocarDeConta}
        open={criando}
        onOpenChange={setCriando}
        onCriado={(id) => {
          setCriando(false);
          setAbertoId(id);
        }}
      />

      <MotivoDoDescarte
        lead={pendente?.lead ?? null}
        onCancelar={() => {
          setPendente(null);
          /* Devolve o cartão à coluna de origem: o quadro já o moveu
             visualmente, e desistir do motivo tem que desfazer isso. */
          router.refresh();
        }}
        onConfirmar={(motivo) => {
          const alvo = pendente;
          setPendente(null);
          if (!alvo) return;

          iniciar(async () => {
            const r = await moverLead({
              dealId: alvo.lead.id,
              stageId: alvo.stageId,
              position: alvo.position,
              lostReason: motivo,
            });
            if (!r.ok) {
              toast.error(r.error);
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Metrica({
  rotulo,
  valor,
  nota,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string;
  nota: string;
  tom?: "neutro" | "alerta";
}) {
  return (
    <div className="surface-card p-3.5">
      <p className="eyebrow">{rotulo}</p>
      <p
        className={cn(
          "mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]",
          tom === "alerta" && "text-warning",
        )}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-2xs text-muted-foreground">{nota}</p>
    </div>
  );
}
