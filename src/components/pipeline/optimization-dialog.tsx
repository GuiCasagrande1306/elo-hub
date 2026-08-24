"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  atividadesDoCliente,
  atualizarOtimizacao,
  registerOptimization,
} from "@/app/(app)/esteira/actions";
import { dataNoBrasil } from "@/lib/date-br";
import type { DiaDeAtividade } from "@/lib/ads/meta-activities";
import type { Client, OptimizationEntry, Profile } from "@/types/database";

/* =====================================================================
   O que aconteceu na conta, dia a dia
   ---------------------------------------------------------------------
   MODAL NO CENTRO, e não gaveta à direita. A gaveta cabia num
   formulário de cinco campos; o que a tela mostra agora é uma TABELA de
   alterações, com nome de conjunto de anúncios que passa de setenta
   caracteres. Numa coluna de 480px isso vira uma pilha de texto
   truncado — que é exatamente a informação que se veio conferir.

   UM BLOCO POR DIA. Tudo o que foi mexido na conta naquele dia fica
   junto: o log da Meta (só leitura, é o que de fato aconteceu) e a
   observação da equipe (editável, é o porquê). Antes, o registro era só
   a observação — alguém escrevia "pausei dois criativos" e, um mês
   depois, ninguém sabia quais. Agora a lista de criativos pausados vem
   da API, e a memória humana só precisa carregar a intenção.

   O DIA VEM DA META E DO BANCO, unidos. Um dia pode ter alteração sem
   observação (mexeram e não anotaram), observação sem alteração
   (mexeram no Google, ou conversaram com o cliente), ou os dois. Os
   três casos aparecem — esconder o primeiro apagaria justamente o que a
   tela existe para cobrar.
   ===================================================================== */

interface Props {
  client: Client | null;
  history: OptimizationEntry[];
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  usuarioId: string;
  ehAdmin: boolean;
  equipe: Profile[];
}

export function OptimizationDialog({
  client,
  history,
  open,
  onOpenChange,
  usuarioId,
  ehAdmin,
  equipe,
}: Props) {
  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-full flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-hairline p-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: client.brand_primary ?? "#8a8a8a" }}
            />
            <DialogTitle className="truncate">{client.name}</DialogTitle>
          </div>
          <DialogDescription>
            Tudo que foi mexido na conta, dia a dia. A observação é sua.
          </DialogDescription>
        </DialogHeader>

        {/* MONTADO SÓ QUANDO ABERTO, e com `key` no cliente. É o que
            zera o estado ao trocar de conta sem um `setState` dentro de
            efeito — que o compilador do React recusa, e com razão:
            copiar prop para estado custa um render a mais e cria uma
            segunda fonte da verdade. */}
        {open && (
          <ConteudoDoDia
            key={client.id}
            client={client}
            history={history}
            usuarioId={usuarioId}
            ehAdmin={ehAdmin}
            equipe={equipe}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function ConteudoDoDia({
  client,
  history,
  usuarioId,
  ehAdmin,
  equipe,
}: {
  client: Client;
  history: OptimizationEntry[];
  usuarioId: string;
  ehAdmin: boolean;
  equipe: Profile[];
}) {
  const [dias, setDias] = useState<DiaDeAtividade[] | null>(null);
  const [avisoMeta, setAvisoMeta] = useState<string | null>(null);

  /* A CONSULTA À META ACONTECE AO ABRIR, não no carregamento da
     esteira. A lista tem dezenas de contas; buscar o log de todas para
     desenhar uma tela em que se abre uma seria uma chamada à Graph API
     por linha, e a esteira demoraria segundos para pintar. */
  useEffect(() => {
    let vivo = true;

    atividadesDoCliente(client.id)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) {
          setDias(r.dias);
        } else {
          setDias([]);
          setAvisoMeta(r.error);
        }
      })
      .catch(() => {
        if (!vivo) return;
        setDias([]);
        setAvisoMeta("Não foi possível falar com a Meta agora.");
      });

    return () => {
      vivo = false;
    };
  }, [client.id]);

  /* União dos dias: os que a Meta reporta, os que têm observação, e
     HOJE — que precisa existir mesmo em branco, senão não há onde
     escrever a observação de uma rodada sem alteração na Meta. */
  const blocos = useMemo(() => {
    const mapa = new Map<string, { dia: string; atividades: DiaDeAtividade["atividades"] }>();

    for (const d of dias ?? []) mapa.set(d.dia, d);

    for (const h of history) {
      if (!mapa.has(h.dia)) mapa.set(h.dia, { dia: h.dia, atividades: [] });
    }

    const hoje = dataNoBrasil();
    if (!mapa.has(hoje)) mapa.set(hoje, { dia: hoje, atividades: [] });

    return [...mapa.values()].sort((a, b) => b.dia.localeCompare(a.dia));
  }, [dias, history]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
          {avisoMeta && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-warning-muted px-3 py-2 text-2xs leading-relaxed text-warning">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                {avisoMeta} As observações abaixo continuam funcionando — o que
                falta é o histórico automático da plataforma.
              </span>
            </p>
          )}

          {dias === null ? (
            <p className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Buscando o histórico da conta na Meta…
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {blocos.map((bloco) => (
                <BlocoDoDia
                  key={bloco.dia}
                  dia={bloco.dia}
                  atividades={bloco.atividades}
                  observacoes={history.filter((h) => h.dia === bloco.dia)}
                  clientId={client.id}
                  usuarioId={usuarioId}
                  ehAdmin={ehAdmin}
                  equipe={equipe}
                />
              ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BlocoDoDia({
  dia,
  atividades,
  observacoes,
  clientId,
  usuarioId,
  ehAdmin,
  equipe,
}: {
  dia: string;
  atividades: DiaDeAtividade["atividades"];
  observacoes: OptimizationEntry[];
  clientId: string;
  usuarioId: string;
  ehAdmin: boolean;
  equipe: Profile[];
}) {
  const [escrevendo, setEscrevendo] = useState(false);
  const ehHoje = dia === dataNoBrasil();

  return (
    <section className="overflow-hidden rounded-xl border border-hairline">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline bg-surface-2/40 px-3 py-2">
        <h3 className="text-sm font-medium">
          {rotuloDoDia(dia)}
          {ehHoje && (
            <span className="ml-2 rounded-md bg-signal/15 px-1.5 text-[10px] font-semibold text-signal">
              hoje
            </span>
          )}
        </h3>
        <span className="text-2xs text-muted-foreground">
          {atividades.length === 0
            ? "nenhuma alteração registrada pela Meta"
            : `${atividades.length} ${atividades.length === 1 ? "alteração" : "alterações"}`}
        </span>
      </header>

      {atividades.length > 0 && <TabelaDeAtividades atividades={atividades} />}

      {/* --- observação ------------------------------------------------ */}
      <div className="border-t border-hairline p-3">
        {observacoes.length === 0 && !escrevendo && (
          <button
            type="button"
            onClick={() => setEscrevendo(true)}
            className="flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3" />
            Adicionar observação deste dia
          </button>
        )}

        {escrevendo && (
          <Editor
            clientId={clientId}
            dia={dia}
            onFechar={() => setEscrevendo(false)}
          />
        )}

        {observacoes.map((o) => (
          <Observacao
            key={o.id}
            entrada={o}
            podeEditar={o.collaborator_id === usuarioId || ehAdmin}
            nomeDoEditor={
              equipe.find((p) => p.id === o.edited_by)?.full_name ?? null
            }
          />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A tabela do log, com as mesmas colunas do Gerenciador de Anúncios.
 *
 * Vira lista de cartões abaixo de `sm`: cinco colunas num celular dão
 * uma coluna de oito caracteres cada, e o nome do conjunto — a
 * informação que identifica O QUE mudou — seria a primeira a sumir.
 */
function TabelaDeAtividades({
  atividades,
}: {
  atividades: DiaDeAtividade["atividades"];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-left max-sm:hidden">
        <thead>
          <tr className="border-b border-hairline">
            {["Atividade", "Detalhes", "Item alterado", "Por", "Hora"].map((c) => (
              <th key={c} className="px-3 py-1.5 eyebrow font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {atividades.map((a, i) => (
            <tr
              key={`${a.quando}-${a.objetoId}-${i}`}
              className="border-b border-hairline/60 last:border-0 align-top"
            >
              <td className="px-3 py-2 text-2xs">{a.atividade}</td>
              <td className="px-3 py-2 text-2xs text-muted-foreground">
                {a.detalhe ?? "—"}
              </td>
              <td className="max-w-[16rem] px-3 py-2 text-2xs">
                <span className="block truncate" title={a.objeto ?? undefined}>
                  {a.objeto ?? "—"}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-2xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {a.automatico && <Bot className="size-3 shrink-0" />}
                  {a.quem}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-2xs tabular-nums text-muted-foreground">
                {hora(a.quando)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-hairline/60 sm:hidden">
        {atividades.map((a, i) => (
          <li key={`${a.quando}-${a.objetoId}-${i}`} className="px-3 py-2">
            <p className="text-2xs font-medium">{a.atividade}</p>
            {a.detalhe && (
              <p className="text-2xs text-muted-foreground">{a.detalhe}</p>
            )}
            {a.objeto && (
              <p className="truncate text-2xs text-muted-foreground">{a.objeto}</p>
            )}
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              {a.automatico && <Bot className="size-2.5" />}
              {a.quem} · {hora(a.quando)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Observacao({
  entrada,
  podeEditar,
  nomeDoEditor,
}: {
  entrada: OptimizationEntry;
  podeEditar: boolean;
  nomeDoEditor: string | null;
}) {
  const [editando, setEditando] = useState(false);

  if (editando) {
    return (
      <Editor
        entrada={entrada}
        clientId={entrada.client_id}
        dia={entrada.dia}
        onFechar={() => setEditando(false)}
      />
    );
  }

  return (
    <div className="group/obs flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-xs leading-relaxed">
          {entrada.notes}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {entrada.collaborator?.full_name ?? "Alguém"}
          {entrada.goal_projection !== null &&
            ` · projeção ${String(entrada.goal_projection).replace(".", ",")}%`}
          {entrada.report_sent && " · relatório enviado"}
          {entrada.edited_at &&
            ` · editado${nomeDoEditor ? ` por ${nomeDoEditor}` : ""}`}
        </p>
      </div>

      {podeEditar && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          aria-label="Editar observação"
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/obs:opacity-100 hover:bg-surface-2 hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Escreve ou corrige a observação de um dia.
 *
 * O MESMO formulário para os dois casos. Criar e editar diferem em uma
 * linha — qual action chamar — e manter dois componentes faria o campo
 * de projeção existir só em um deles no dia em que alguém mexesse num.
 */
function Editor({
  entrada,
  clientId,
  dia,
  onFechar,
}: {
  entrada?: OptimizationEntry;
  clientId: string;
  dia: string;
  onFechar: () => void;
}) {
  const [notes, setNotes] = useState(entrada?.notes ?? "");
  const [reportSent, setReportSent] = useState(entrada?.report_sent ?? false);
  const [projection, setProjection] = useState(
    entrada?.goal_projection === null || entrada?.goal_projection === undefined
      ? ""
      : String(entrada.goal_projection).replace(".", ","),
  );
  const [salvando, iniciar] = useTransition();

  function salvar() {
    iniciar(async () => {
      const r = entrada
        ? await atualizarOtimizacao({
            entryId: entrada.id,
            notes,
            reportSent,
            goalProjection: projection,
          })
        : await registerOptimization({
            clientId,
            notes,
            reportSent,
            goalProjection: projection,
            dia,
          });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success(entrada ? "Observação atualizada." : "Observação registrada.");
      onFechar();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        autoFocus
        placeholder="Por que essas alterações? Ex.: CPA do conjunto 04 passou de R$ 120, cortei verba e realoquei no 02."
        className="resize-y text-xs"
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-32">
          <Label htmlFor={`proj-${dia}`} className="text-2xs">
            Projeção (%)
          </Label>
          <Input
            id={`proj-${dia}`}
            inputMode="decimal"
            value={projection}
            onChange={(e) => setProjection(e.target.value)}
            placeholder="87,5"
            className="mt-1 h-8 tabular-nums"
          />
        </div>

        <label className="flex items-center gap-2 pb-1.5 text-2xs">
          <Switch
            checked={reportSent}
            onCheckedChange={setReportSent}
            aria-label="Relatório enviado"
          />
          Relatório enviado
        </label>

        <div className="ml-auto flex items-center gap-2 pb-1">
          <Button size="sm" variant="ghost" onClick={onFechar} disabled={salvando}>
            <X className="size-3.5" />
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={salvar}
            disabled={salvando || notes.trim().length < 3}
          >
            {salvando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const DIA_LONGO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * `2026-08-24` → "segunda-feira, 24 de agosto".
 *
 * Ancorado ao MEIO-DIA. `new Date("2026-08-24")` é meia-noite UTC, que
 * em São Paulo ainda é dia 23 — o cabeçalho mostraria o dia anterior em
 * todos os blocos.
 */
function rotuloDoDia(dia: string): string {
  return DIA_LONGO.format(new Date(`${dia}T12:00:00-03:00`));
}

function hora(iso: string): string {
  return HORA.format(new Date(iso));
}
