"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CrmBoard } from "./crm-board";
import { DealDialog } from "./deal-dialog";
import { NewDealDialog } from "./new-deal-dialog";
import { ConvertDialog } from "./convert-dialog";
import { estadoDaAcao } from "./deal-card";
import { moverNegocio } from "@/app/(app)/comercial/actions";
import {
  MOTIVOS_PERDA,
  ehAberta,
  valorDoNegocio,
  valorPonderado,
} from "@/lib/crm/stages";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  DealStage,
  DealWithRelations,
  LostReason,
  Profile,
} from "@/types/database";

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
}: {
  deals: DealWithRelations[];
  team: Profile[];
  agencias: string[];
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  const [filtroDono, setFiltroDono] = useState<string>("__todos__");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [convertendo, setConvertendo] = useState<DealWithRelations | null>(null);

  /* Perder pede motivo, e o motivo é perguntado no momento em que o
     cartão cai na coluna — não depois, num formulário que a pessoa vai
     fechar. `pendente` segura o movimento até a resposta. */
  const [pendente, setPendente] = useState<{
    dealId: string;
    position: number;
  } | null>(null);

  const visiveis = useMemo(
    () =>
      filtroDono === "__todos__"
        ? deals
        : deals.filter((d) => d.owner_id === filtroDono),
    [deals, filtroDono],
  );

  const m = useMemo(() => metricas(visiveis), [visiveis]);

  function mover(dealId: string, stage: DealStage, position: number) {
    if (stage === "perdido") {
      setPendente({ dealId, position });
      return;
    }

    iniciar(async () => {
      const r = await moverNegocio({ dealId, stage, position });
      if (!r.ok) {
        toast.error(r.error);
        /* O quadro aplicou o movimento de forma otimista. Sem o refresh,
           a tela ficaria mostrando um estado que o banco recusou. */
        router.refresh();
      }
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

        <Button className="ml-auto" onClick={() => setCriando(true)}>
          <Plus className="size-4" />
          Novo negócio
        </Button>
      </div>

      {/* --------------------------- Quadro -------------------------- */}
      {deals.length === 0 ? (
        <div className="surface-card px-6 py-14 text-center">
          <p className="text-sm font-medium">Nenhum negócio no funil ainda.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Cadastre quem está em conversa hoje — mesmo sem valor definido. Um
            funil com os leads reais responde perguntas que uma planilha não
            responde; um funil vazio não responde nenhuma.
          </p>
          <Button className="mt-4" onClick={() => setCriando(true)}>
            <Plus className="size-4" />
            Criar o primeiro
          </Button>
        </div>
      ) : (
        <CrmBoard deals={visiveis} onOpen={setAbertoId} onMove={mover} />
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
      />

      <NewDealDialog
        team={team}
        open={criando}
        onOpenChange={setCriando}
        onCriado={(id) => {
          setCriando(false);
          setAbertoId(id);
        }}
      />

      <ConvertDialog
        deal={convertendo}
        agencias={agencias}
        open={Boolean(convertendo)}
        onOpenChange={(v) => !v && setConvertendo(null)}
      />

      <MotivoDaPerda
        aberto={Boolean(pendente)}
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
            const r = await moverNegocio({
              dealId: alvo.dealId,
              stage: "perdido",
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

function MotivoDaPerda({
  aberto,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: LostReason) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="w-[94vw] sm:max-w-[min(94vw,420px)]">
        <DialogTitle>Por que perdeu?</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          É a única informação que o funil produz de graça: onde a venda
          morre. Sem ela, &ldquo;perdemos 8 este mês&rdquo; não vira decisão
          nenhuma.
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          {MOTIVOS_PERDA.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              className="justify-start"
              onClick={() => onConfirmar(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
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
