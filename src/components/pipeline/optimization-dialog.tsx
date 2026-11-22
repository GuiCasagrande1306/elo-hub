"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
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
  atualizarOtimizacao,
  registerOptimization,
} from "@/app/(app)/esteira/actions";
import { dataNoBrasil } from "@/lib/date-br";
import type {
  Client,
  OptimizationEntry,
  Profile,
  SaudeDaConta,
} from "@/types/database";

/* =====================================================================
   O que aconteceu na conta, dia a dia
   ---------------------------------------------------------------------
   MODAL NO CENTRO, e não gaveta à direita. A gaveta cabia num
   formulário de cinco campos; o que a tela mostra agora é uma TABELA de
   alterações, com nome de conjunto de anúncios que passa de setenta
   caracteres. Numa coluna de 480px isso vira uma pilha de texto
   truncado — que é exatamente a informação que se veio conferir.

   UM BLOCO POR DIA, só com o que a equipe ANOTOU. O log automático de
   alterações da Meta foi tirado em 22/11/2026, a pedido: o histórico é
   das observações da rodada, não de cada ajuste do Gerenciador. Os dias
   são os que têm observação, mais HOJE para poder escrever.
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
            As observações das rodadas de otimização, dia a dia.
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
  /* SÓ O QUE FOI ANOTADO (22/11/2026). O log automático de alterações
     da conta na Meta saiu daqui: a equipe quer o histórico com as
     observações da rodada, não a lista de cada ajuste do Gerenciador.
     Os dias são os que têm observação, e HOJE — que precisa existir em
     branco, senão não há onde escrever a observação da rodada. */
  const dias = useMemo(() => {
    const hoje = dataNoBrasil();
    return [...new Set([hoje, ...history.map((h) => h.dia)])].sort((a, b) => b.localeCompare(a));
  }, [history]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            {dias.map((dia) => (
              <BlocoDoDia
                key={dia}
                dia={dia}
                observacoes={history.filter((h) => h.dia === dia)}
                clientId={client.id}
                usuarioId={usuarioId}
                ehAdmin={ehAdmin}
                equipe={equipe}
              />
            ))}
          </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BlocoDoDia({
  dia,
  observacoes,
  clientId,
  usuarioId,
  ehAdmin,
  equipe,
}: {
  dia: string;
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
      </header>

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
          {entrada.account_health && (
            <>
              {" · "}
              <span
                aria-hidden
                className={`inline-block size-1.5 rounded-full align-middle ${SAUDE[entrada.account_health].cor}`}
              />{" "}
              conta {SAUDE[entrada.account_health].rotulo.toLowerCase()}
            </>
          )}
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
  const [saude, setSaude] = useState<SaudeDaConta | null>(
    entrada?.account_health ?? null,
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
            accountHealth: saude,
          })
        : await registerOptimization({
            clientId,
            notes,
            reportSent,
            goalProjection: projection,
            accountHealth: saude,
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

        {/* Clicar de novo na cor marcada desmarca: rodada sem leitura
            de saúde é legítima e não pode virar "verde" por padrão. */}
        <div role="group" aria-label="Saúde do resultado" className="pb-0.5">
          <p className="text-2xs">Saúde do resultado</p>
          <div className="mt-1 flex gap-1">
            {(Object.keys(SAUDE) as SaudeDaConta[]).map((chave) => (
              <button
                key={chave}
                type="button"
                aria-pressed={saude === chave}
                onClick={() => setSaude(saude === chave ? null : chave)}
                className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-2xs transition-colors ${
                  saude === chave
                    ? "border-foreground/40 bg-surface-2 text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-2"
                }`}
              >
                <span aria-hidden className={`size-2 rounded-full ${SAUDE[chave].cor}`} />
                {SAUDE[chave].rotulo}
              </button>
            ))}
          </div>
        </div>

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

const SAUDE: Record<SaudeDaConta, { rotulo: string; cor: string }> = {
  green: { rotulo: "Verde", cor: "bg-emerald-500" },
  yellow: { rotulo: "Amarelo", cor: "bg-amber-400" },
  red: { rotulo: "Vermelho", cor: "bg-red-500" },
};

const DIA_LONGO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
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

