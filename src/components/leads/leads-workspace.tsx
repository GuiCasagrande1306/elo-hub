"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ClientSearchPicker,
  type ClienteEscolhivel,
} from "@/components/clients/client-search-picker";
import { garantirFunil } from "@/app/(app)/crm/actions";
import { formatCurrency } from "@/lib/format";
import type { LeadDeal, LeadPipeline, LeadStage } from "@/lib/crm/types";
import { LeadBoard } from "./lead-board";
import { LeadSheet } from "./lead-sheet";
import { NewLeadDialog } from "./new-lead-dialog";

/* =====================================================================
   A área de trabalho do funil
   ---------------------------------------------------------------------
   UMA ROTA, DOIS PÚBLICOS. `/crm` é a mesma página para a agência e para
   o cliente, e a diferença cabe em uma linha: quem é da agência escolhe
   de qual cliente é o funil; quem é do cliente não escolhe nada, porque
   só existe um.

   Duas rotas separadas seriam duas telas para manter em sincronia, e a
   segunda sempre fica para trás. O que separa os dois mundos é a RLS —
   não a URL.

   POR QUE `?cliente=` NA URL e não estado local: a pessoa da agência
   manda o link do funil do Verdi no grupo da equipe, e quem abre cai no
   funil certo. Estado em memória perde isso, e recarregar a página
   voltaria sempre ao primeiro cliente da lista.
   ===================================================================== */

interface Props {
  clients: ClienteEscolhivel[];
  clientId: string | null;
  ehCliente: boolean;
  /** Só admin dá acesso — o atalho não aparece para o resto. */
  ehAdmin: boolean;
  pipeline: LeadPipeline | null;
  stages: LeadStage[];
  deals: LeadDeal[];
  equipe: { id: string; full_name: string }[];
}

export function LeadsWorkspace({
  clients,
  clientId,
  ehCliente,
  ehAdmin,
  pipeline,
  stages,
  deals,
  equipe,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState<LeadDeal | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [criandoFunil, iniciar] = useTransition();

  const resumo = useMemo(() => {
    const tipoDaEtapa = new Map(stages.map((s) => [s.id, s.kind]));

    let abertos = 0;
    let emAberto = 0;
    let ganhos = 0;
    let faturado = 0;
    let perdidos = 0;

    for (const d of deals) {
      const tipo = tipoDaEtapa.get(d.stage_id) ?? "aberto";
      if (tipo === "ganho") {
        ganhos += 1;
        faturado += d.value_cents;
      } else if (tipo === "perdido") {
        perdidos += 1;
      } else {
        abertos += 1;
        emAberto += d.value_cents;
      }
    }

    /* A conversão só conta o que JÁ FECHOU. Somar os abertos no
       denominador faria a taxa despencar toda vez que entrasse lead
       novo — o número pioraria justamente na semana boa. */
    const fechados = ganhos + perdidos;

    return {
      abertos,
      emAberto,
      ganhos,
      faturado,
      conversao: fechados > 0 ? Math.round((ganhos / fechados) * 100) : null,
    };
  }, [deals, stages]);

  const escolhido = clients.find((c) => c.id === clientId) ?? null;

  /* ---------------------------------------------------------------- */
  /* Sem cliente escolhido — só acontece do lado da agência            */
  /* ---------------------------------------------------------------- */
  if (!clientId) {
    return (
      <div className="surface-card flex flex-col items-start gap-3 p-6">
        <Workflow className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Escolha o cliente</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Cada cliente tem o próprio funil, com as próprias etapas e os
            próprios leads. Escolha de quem você quer ver o quadro.
          </p>
        </div>
        <ClientSearchPicker
          clients={clients}
          value={null}
          onChange={(id) => router.push(`/crm?cliente=${id}`)}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Cliente escolhido, mas ainda sem funil                            */
  /* ---------------------------------------------------------------- */
  if (!pipeline) {
    return (
      <div className="flex flex-col gap-4">
        {!ehCliente && (
          <ClientSearchPicker
            clients={clients}
            value={clientId}
            onChange={(id) => router.push(`/crm?cliente=${id}`)}
          />
        )}

        <div className="surface-card flex flex-col items-start gap-3 p-6">
          <Workflow className="size-5 text-signal" />
          <div>
            <h2 className="text-sm font-semibold">
              {escolhido?.name ?? "Este cliente"} ainda não tem funil
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              O funil inicial vem com cinco etapas — Novo contato, Em conversa,
              Proposta, Ganho e Perdido. Dá para renomear depois; o que importa
              agora é ter onde colocar o primeiro lead.
            </p>
          </div>
          <Button
            disabled={criandoFunil}
            onClick={() =>
              iniciar(async () => {
                const r = await garantirFunil(clientId);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Funil criado.");
                router.refresh();
              })
            }
          >
            {criandoFunil ? "Criando…" : "Criar funil"}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* O quadro                                                          */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {ehCliente ? (
          <h2 className="text-sm font-medium">{pipeline.name}</h2>
        ) : (
          <ClientSearchPicker
            clients={clients}
            value={clientId}
            onChange={(id) => router.push(`/crm?cliente=${id}`)}
          />
        )}

        <div className="flex items-center gap-2">
          {/* O ATALHO MORA AQUI porque é aqui que a pergunta aparece:
              com o funil do cliente na tela, alguém lembra que ele
              poderia mexer nisso sozinho. Pedir para caçar
              Configurações → Acesso dos clientes é onde a ideia
              morre. */}
          {ehAdmin && !ehCliente && (
            <Button size="sm" variant="ghost" render={<Link href={`/configuracoes/acessos?cliente=${clientId}`} />}>
              <KeyRound className="size-3.5" />
              Dar acesso ao cliente
            </Button>
          )}

          <Button size="sm" onClick={() => setNovoEm(stages[0]?.id ?? null)}>
            <Plus className="size-3.5" />
            Novo lead
          </Button>
        </div>
      </div>

      {/* QUATRO NÚMEROS, e a ordem é a da pergunta do dono: quanto tem
          na mesa, quanto já entrou, e de cada dez que fecharam, quantas
          foram minhas. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Numero
          rotulo="Em negociação"
          valor={formatCurrency(resumo.emAberto)}
          apoio={`${resumo.abertos} ${resumo.abertos === 1 ? "lead" : "leads"}`}
        />
        <Numero
          rotulo="Ganho"
          valor={formatCurrency(resumo.faturado)}
          apoio={`${resumo.ganhos} ${resumo.ganhos === 1 ? "negócio" : "negócios"}`}
        />
        <Numero
          rotulo="Conversão"
          valor={resumo.conversao === null ? "—" : `${resumo.conversao}%`}
          apoio={
            resumo.conversao === null
              ? "nada fechado ainda"
              : "dos que fecharam"
          }
        />
        <Numero
          rotulo="Total no funil"
          valor={String(deals.length)}
          apoio={`${stages.length} etapas`}
        />
      </div>

      <LeadBoard
        stages={stages}
        deals={deals}
        onAbrir={setAberto}
        onNovo={setNovoEm}
      />

      <LeadSheet
        /* A ficha lê do quadro recarregado, não da cópia que estava no
           card quando ele foi clicado: sem isto, editar o valor e mover
           o lead deixaria a ficha mostrando o número velho. */
        deal={aberto ? (deals.find((d) => d.id === aberto.id) ?? null) : null}
        stages={stages}
        equipe={equipe}
        onFechar={() => setAberto(null)}
      />

      <NewLeadDialog
        aberto={novoEm !== null}
        onFechar={() => setNovoEm(null)}
        clientId={clientId}
        pipelineId={pipeline.id}
        stages={stages}
        stageInicial={novoEm}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Numero({
  rotulo,
  valor,
  apoio,
}: {
  rotulo: string;
  valor: string;
  apoio: string;
}) {
  return (
    <div className="surface-card flex flex-col gap-0.5 p-3">
      <span className="text-2xs text-muted-foreground">{rotulo}</span>
      <span className="text-lg font-semibold tabular-nums leading-none">
        {valor}
      </span>
      <span className="text-[10px] text-muted-foreground">{apoio}</span>
    </div>
  );
}
