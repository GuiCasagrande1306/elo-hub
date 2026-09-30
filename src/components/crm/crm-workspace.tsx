"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmBoard } from "./crm-board";
import { DealDialog } from "./deal-dialog";
import { BarraDeCaptura } from "./barra-de-captura";
import { PortaoDialog, type Preenchimento } from "./portao-dialog";
import { PainelDoFunil } from "./painel-do-funil";
import { ConvertDialog } from "./convert-dialog";
import { estadoDaAcao } from "./deal-card";
import { moverNegocio } from "@/app/(app)/comercial/actions";
import { ehAberta, valorDoNegocio, valorPonderado } from "@/lib/crm/stages";
import { oQueFalta, type DealParaPortao } from "@/lib/crm/portoes";
import type { EventoDeEtapa } from "@/lib/crm/metricas";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealStage, DealWithRelations, Profile } from "@/types/database";

/**
 * A tela do funil.
 *
 * O CABEÇALHO É A PARTE QUE MAIS IMPORTA, e não o quadro. Quadro bonito
 * todo CRM tem; o que faz alguém abrir a tela toda manhã é ela responder,
 * sem clique nenhum: quanto tem em jogo, quanto disso é crível, e de que
 * eu preciso cuidar hoje. As três perguntas estão nos três primeiros
 * cartões, nessa ordem.
 */

export function CrmWorkspace({
  deals,
  team,
  agencias,
  eventos,
}: {
  deals: DealWithRelations[];
  team: Profile[];
  agencias: string[];
  eventos: EventoDeEtapa[];
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  const [filtroDono, setFiltroDono] = useState<string>("__todos__");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [convertendo, setConvertendo] = useState<DealWithRelations | null>(null);

  /* O portão segura o movimento até o que falta ser respondido.
     Perguntar DEPOIS, num formulário que a pessoa vai fechar, é o mesmo
     que não perguntar — e é assim que um CRM acumula negócio em
     "Proposta" sem valor nenhum. */
  const [portao, setPortao] = useState<{
    deal: DealWithRelations;
    destino: DealStage;
    position: number;
  } | null>(null);
  const [erroPortao, setErroPortao] = useState<string | null>(null);
  const [enviandoPortao, setEnviandoPortao] = useState(false);

  const visiveis = useMemo(
    () =>
      filtroDono === "__todos__"
        ? deals
        : deals.filter((d) => d.owner_id === filtroDono),
    [deals, filtroDono],
  );

  const m = useMemo(() => metricas(visiveis), [visiveis]);

  /**
   * Mover o cartão.
   *
   * ⚠️ O QUADRO JÁ MOVEU DE FORMA OTIMISTA quando esta função roda. Por
   * isso todo caminho que não completa o movimento chama `refresh` — sem
   * ele a tela fica mostrando um estado que o banco não tem, e o cartão
   * "volta sozinho" no próximo carregamento, que é pior do que nunca ter
   * saído do lugar.
   *
   * Quem já tem tudo passa direto: abrir diálogo para confirmar o que
   * não falta é o atrito que matou a versão anterior deste módulo.
   */
  function mover(dealId: string, stage: DealStage, position: number) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;

    if (oQueFalta(deal as unknown as DealParaPortao, stage).length > 0) {
      setErroPortao(null);
      setPortao({ deal, destino: stage, position });
      return;
    }

    iniciar(async () => {
      const r = await moverNegocio({ dealId, stage, position });
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
      }
    });
  }

  function confirmarPortao(preencher: Preenchimento) {
    const alvo = portao;
    if (!alvo) return;

    setEnviandoPortao(true);
    iniciar(async () => {
      const r = await moverNegocio({
        dealId: alvo.deal.id,
        stage: alvo.destino,
        position: alvo.position,
        preencher,
      });

      setEnviandoPortao(false);

      if (!r.ok) {
        /* O erro fica DENTRO do diálogo, não num toast: o que o servidor
           recusou é um campo que está na tela, e mandar a pessoa
           procurar a mensagem em outro canto perde a ligação. */
        setErroPortao(r.error);
        return;
      }

      setPortao(null);
      router.refresh();
    });
  }

  const dealAberto = deals.find((d) => d.id === abertoId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* ------------------------- Cabeçalho ------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metrica
          rotulo="Em negociação"
          valor={formatCurrency(m.aberto)}
          nota={`${m.abertos} ${m.abertos === 1 ? "negócio" : "negócios"}`}
        />
        <Metrica
          rotulo="Previsão ponderada"
          valor={formatCurrency(m.ponderado)}
          nota="pela etapa de cada um"
        />
        <Metrica
          rotulo="Recorrente em jogo"
          valor={`${formatCurrencyCompact(m.recorrente)}/mês`}
          nota="se tudo fechar"
        />
        {/* O ÚNICO CARTÃO ACIONÁVEL, e por isso ele é o que muda de cor.
            Os outros informam; este pede trabalho. */}
        <Metrica
          rotulo="Precisam de você"
          valor={String(m.precisam)}
          nota={`${m.atrasados} atrasados · ${m.semAcao} sem próximo passo`}
          tom={m.precisam > 0 ? "alerta" : "neutro"}
        />
        <Metrica
          rotulo="Taxa de conversão"
          valor={m.fechados === 0 ? "—" : `${Math.round(m.taxa * 100)}%`}
          nota={
            m.fechados === 0
              ? "nenhum negócio fechado ainda"
              : `${m.ganhos} de ${m.fechados} fechados`
          }
        />
      </div>

      {/* ------------------------- Ferramentas ----------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filtroDono} onValueChange={(v) => setFiltroDono(v ?? "__todos__")}>
          <SelectTrigger className="w-52">
            {/* ⚠️ `SelectValue` do Base UI recebe uma FUNÇÃO. Sem ela o
                gatilho imprime o valor cru — a tela mostrava
                "__todos__" no lugar do rótulo. Não é como no Radix. */}
            <SelectValue>
              {(v: string) =>
                v === "__todos__"
                  ? "Todos os responsáveis"
                  : (team.find((p) => p.id === v)?.full_name ??
                    "Todos os responsáveis")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todos os responsáveis</SelectItem>
            {team.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

      </div>

      {/* A CAPTURA FICA ANTES DO QUADRO, sempre visível. Ver o cabeçalho
          de `barra-de-captura.tsx`: a conversa está no WhatsApp, em
          outra janela, e cada passo entre "acabei de falar com alguém" e
          "está registrado" é um lead que não entra. */}
      <BarraDeCaptura />

      {/* ------------------- Quadro e números ------------------------ */}
      {deals.length === 0 ? (
        <div className="surface-card px-6 py-14 text-center">
          <p className="text-sm font-medium">Nenhum negócio no funil ainda.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Escreva o nome de uma empresa na barra acima e aperte Enter. É só
            isso — valor, responsável e previsão são pedidos depois, cada um na
            etapa em que faz diferença.
          </p>
        </div>
      ) : (
        <Tabs defaultValue="quadro">
          <TabsList>
            <TabsTrigger value="quadro">Quadro</TabsTrigger>
            <TabsTrigger value="numeros">Números</TabsTrigger>
          </TabsList>

          <TabsContent value="quadro" className="mt-4">
            <CrmBoard deals={visiveis} onOpen={setAbertoId} onMove={mover} />
          </TabsContent>

          {/* ⚠️ O PAINEL LÊ O FUNIL INTEIRO, não `visiveis`. Conversão e
              tempo de ciclo filtrados por responsável dariam uma amostra
              de três negócios e um número sem significado — e, pior, um
              número que muda quando alguém mexe num filtro de tela. */}
          <TabsContent value="numeros" className="mt-4">
            <PainelDoFunil deals={deals} eventos={eventos} />
          </TabsContent>
        </Tabs>
      )}

      {/* --------------------------- Modais -------------------------- */}
      <DealDialog
        deal={dealAberto}
        team={team}
        open={Boolean(dealAberto)}
        onOpenChange={(v) => !v && setAbertoId(null)}
        onConverter={(d) => {
          setAbertoId(null);
          setConvertendo(d);
        }}
        onMoverEtapa={(destino) => {
          if (!dealAberto || destino === dealAberto.stage) return;
          /* Fecha a ficha antes: o diálogo do portão abriria por cima,
             e dois modais empilhados escondem o campo que a pessoa
             precisa preencher. */
          setAbertoId(null);
          mover(dealAberto.id, destino, dealAberto.position);
        }}
      />

      <ConvertDialog
        deal={convertendo}
        agencias={agencias}
        open={Boolean(convertendo)}
        onOpenChange={(v) => !v && setConvertendo(null)}
      />

      <PortaoDialog
        deal={portao?.deal ?? null}
        destino={portao?.destino ?? null}
        team={team}
        enviando={enviandoPortao}
        erro={erroPortao}
        onCancelar={() => {
          setPortao(null);
          /* Devolve o cartão à coluna de origem: o quadro já o moveu
             visualmente, e desistir tem que desfazer isso. */
          router.refresh();
        }}
        onConfirmar={confirmarPortao}
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
/* ------------------------------------------------------------------ */

/**
 * As contas do cabeçalho, num lugar só.
 *
 * ⚠️ "Precisam de você" conta CADA NEGÓCIO uma vez, não cada problema.
 * Um negócio atrasado e sem próxima ação é impossível (sem ação não há
 * data para atrasar), mas somar as duas listas ainda assim seria frágil
 * — a união explícita não depende dessa coincidência continuar valendo.
 */
function metricas(deals: DealWithRelations[]) {
  const abertos = deals.filter((d) => ehAberta(d.stage));

  const atrasados = abertos.filter(
    (d) => estadoDaAcao(d).tipo === "atrasada",
  ).length;
  const semAcao = abertos.filter(
    (d) => estadoDaAcao(d).tipo === "nenhuma",
  ).length;

  const ganhos = deals.filter((d) => d.stage === "ganho").length;
  const perdidos = deals.filter((d) => d.stage === "perdido").length;
  const fechados = ganhos + perdidos;

  return {
    aberto: abertos.reduce((s, d) => s + valorDoNegocio(d), 0),
    ponderado: abertos.reduce((s, d) => s + valorPonderado(d), 0),
    recorrente: abertos.reduce((s, d) => s + d.monthly_fee_cents, 0),
    abertos: abertos.length,
    atrasados,
    semAcao,
    precisam: new Set([
      ...abertos.filter((d) => estadoDaAcao(d).tipo === "atrasada").map((d) => d.id),
      ...abertos.filter((d) => estadoDaAcao(d).tipo === "nenhuma").map((d) => d.id),
    ]).size,
    ganhos,
    fechados,
    taxa: fechados === 0 ? 0 : ganhos / fechados,
  };
}
