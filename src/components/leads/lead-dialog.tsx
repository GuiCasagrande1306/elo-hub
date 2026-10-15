"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TempoDesde } from "./tempo-desde";
import {
  anotarNoLead,
  atualizarLead,
  carregarHistorico,
  concluirTarefaDoLead,
  criarTarefaDoLead,
  excluirLead,
  salvarContato,
} from "@/app/(app)/leads/actions";
import {
  ORIGENS_LEAD,
  ORIGEM_LEAD_LABEL,
  formatarTelefone,
  rotuloDoMotivo,
} from "@/lib/leads/vocabulario";
import { dataNoBrasil } from "@/lib/date-br";
import { formatCurrency, formatDueDate, parseCurrencyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  LeadNote,
  LeadSource,
  LeadStage,
  LeadTask,
  LeadWithRelations,
  Profile,
} from "@/types/database";

/* =====================================================================
   Ficha do lead
   ---------------------------------------------------------------------
   Duas metades, como a ficha do CRM comercial: à esquerda o que o lead
   É (etapa, valor, origem, contato); à direita o que ACONTECEU (notas e
   tarefas). A divisão existe porque as duas perguntas são feitas em
   momentos diferentes — "quem é essa pessoa" antes de ligar, "o que já
   foi conversado" durante.

   GRAVAÇÃO POR CAMPO, com debounce nos textos livres. Um botão "Salvar"
   único obrigaria a decidir o que fazer quando alguém fecha o modal sem
   clicar — e a resposta honesta (descartar tudo) é a que mais irrita.
   ===================================================================== */

type Nota = LeadNote & { author: { id: string; full_name: string } | null };

export function LeadDialog({
  lead,
  stages,
  team,
  podeAtribuir,
  open,
  onOpenChange,
}: {
  lead: LeadWithRelations | null;
  stages: LeadStage[];
  team: Profile[];
  /** Usuário de cliente não escolhe responsável da agência. */
  podeAtribuir: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [salvando, iniciarSalvamento] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [historico, setHistorico] = useState<{ notes: Nota[]; tasks: LeadTask[] }>({
    notes: [],
    tasks: [],
  });
  /* O "carregando" vem do `useTransition`, e não de um `useState` que a
     própria busca liga e desliga.

     ⚠️ A versão com `setCarregando(true)` antes do `await` roda no corpo
     síncrono do effect que a chama — e é setState em effect, mesmo
     escondido dentro de outra função: o lint atravessa a chamada e
     acusa. `isPending` resolve isso sem estado próprio, e de quebra
     cobre as recargas disparadas pelos filhos depois de anotar ou
     concluir um passo. */
  const [carregando, iniciarCarga] = useTransition();

  const leadId = lead?.id ?? null;

  const recarregar = useCallback(async () => {
    if (!leadId) return;
    const dados = await carregarHistorico(leadId);
    setHistorico(dados as { notes: Nota[]; tasks: LeadTask[] });
  }, [leadId]);

  /* ZERA ANTES DE BUSCAR, durante o render. Sem isso, abrir o segundo
     lead mostra o histórico do primeiro por um instante — e alguém
     acredita no que leu.

     ⚠️ Fica aqui, e não no effect abaixo, porque limpar dentro de um
     effect deixa o histórico errado aparecer em um quadro antes de ser
     apagado no seguinte — que é exatamente a renderização em cascata
     que `react-hooks/set-state-in-effect` proíbe. Ajustar estado durante
     o render quando uma prop muda é o padrão documentado pelo React, e
     o descarte acontece antes de qualquer pixel. */
  const [historicoDe, setHistoricoDe] = useState<string | null>(leadId);
  if (leadId !== historicoDe) {
    setHistoricoDe(leadId);
    setHistorico({ notes: [], tasks: [] });
  }

  /* A BUSCA continua no effect, e é o lugar certo: pedir dado ao
     servidor é sincronizar com um sistema externo, e os `setState` de
     `recarregar` acontecem em callback assíncrono, não no corpo. */
  useEffect(() => {
    if (!open || !leadId) return;
    iniciarCarga(recarregar);
  }, [open, leadId, recarregar]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!lead) return null;

  function patch(campos: Parameters<typeof atualizarLead>[0]) {
    iniciarSalvamento(async () => {
      const r = await atualizarLead(campos);
      if (!r.ok) toast.error(r.error);
    });
  }

  /** Texto livre: agenda a gravação e cancela a anterior. */
  function agendar(campos: Parameters<typeof atualizarLead>[0]) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => patch(campos), 700);
  }

  const etapa = stages.find((e) => e.id === lead.stage_id) ?? null;
  const motivo = rotuloDoMotivo(lead.lost_reason);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] overflow-y-auto p-0 sm:max-w-[min(94vw,920px)]">
        <div className="border-b border-hairline px-5 py-4">
          {/* Título acessível separado do campo editável: o leitor de
              tela anuncia o nome do diálogo sem depender de composição. */}
          <DialogTitle className="sr-only">{lead.title}</DialogTitle>

          <input
            key={lead.id}
            defaultValue={lead.title}
            onChange={(e) => agendar({ dealId: lead.id, title: e.target.value })}
            className="w-full bg-transparent text-lg font-semibold tracking-[-0.01em] outline-none"
            aria-label="Nome do lead"
          />

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {ORIGEM_LEAD_LABEL[lead.source]} · chegou há{" "}
              <TempoDesde iso={lead.created_at} />
            </span>

            {motivo && (
              <span className="font-medium text-negative">Descartado: {motivo}</span>
            )}

            {lead.external_id && (
              /* A chave da origem externa é o que liga esta linha ao
                 lead do Meta. Fica visível porque, quando a ingestão
                 automática existir, é por ela que se confere se o
                 formulário e o funil estão falando do mesmo cadastro. */
              <span
                className="font-mono text-[10px] text-muted-foreground/70"
                title="Identificador na origem"
              >
                {lead.external_id}
              </span>
            )}

            {salvando && (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                salvando
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[1fr_360px]">
          {/* ------------------ O que o lead é ------------------ */}
          <div className="flex flex-col gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Etapa">
                <div className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-sm">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: etapa?.color ?? "#94A3B8" }}
                  />
                  <span className="truncate">{etapa?.name ?? "—"}</span>
                </div>
                {/* NÃO É UM SELETOR, e é decisão, não falta de tempo.
                    Mover para "Perdido" exige motivo, e um <select> não
                    tem onde perguntar. Ter metade das mudanças de etapa
                    passando pelo diálogo de motivo e a outra metade não
                    produziria descarte sem causa — o dado que sustenta o
                    módulo. A etapa muda no quadro, onde o gesto é o
                    arraste, ou na triagem. */}
                <p className="mt-1 text-2xs text-muted-foreground">
                  arraste o cartão no quadro para mudar
                </p>
              </Campo>

              <Campo label="Origem">
                <Select
                  value={lead.source}
                  onValueChange={(v) =>
                    patch({ dealId: lead.id, source: v as LeadSource })
                  }
                >
                  <SelectTrigger className="w-full">
                    {/* ⚠️ `SelectValue` do Base UI recebe uma FUNÇÃO. Sem
                        ela o gatilho imprime o valor cru. Não é Radix. */}
                    <SelectValue>
                      {(v: string) => ORIGEM_LEAD_LABEL[v as LeadSource] ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ORIGENS_LEAD.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              <Campo label="Valor estimado">
                <Input
                  key={`valor-${lead.id}`}
                  defaultValue={
                    lead.value_cents > 0 ? formatCurrency(lead.value_cents) : ""
                  }
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  onChange={(e) => {
                    const cents = parseCurrencyToCents(e.target.value);
                    if (cents === null && e.target.value.trim() !== "") return;
                    agendar({ dealId: lead.id, valueCents: cents ?? 0 });
                  }}
                />
              </Campo>

              {podeAtribuir && (
                <Campo label="Responsável">
                  <Select
                    value={lead.owner_id ?? "__ninguem__"}
                    onValueChange={(v) =>
                      patch({
                        dealId: lead.id,
                        ownerId: v === "__ninguem__" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          v === "__ninguem__"
                            ? "Ninguém"
                            : (team.find((p) => p.id === v)?.full_name ?? "Ninguém")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ninguem__">Ninguém</SelectItem>
                      {team.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}
            </div>

            {/* `key` é o que reinicia os campos ao trocar de lead —
                ver o comentário dentro de `Contato`. */}
            <Contato key={lead.id} lead={lead} />

            <div className="mt-1 border-t border-hairline pt-4">
              <ExcluirLead
                key={lead.id}
                lead={lead}
                onExcluido={() => onOpenChange(false)}
              />
            </div>
          </div>

          {/* ------------------ O que aconteceu ------------------ */}
          <div className="flex flex-col gap-5 border-t border-hairline p-5 md:border-l md:border-t-0">
            <Tarefas
              lead={lead}
              tarefas={historico.tasks}
              carregando={carregando}
              onMudou={recarregar}
            />
            <Notas
              lead={lead}
              notas={historico.notes}
              carregando={carregando}
              onMudou={recarregar}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Contato do lead.
 *
 * SALVA COM BOTÃO, e não por campo como o resto da ficha. Os três campos
 * viajam juntos para a mesma action — o telefone é validado e pode
 * reaproveitar um contato existente —, então gravar a cada tecla
 * dispararia uma busca de deduplicação a cada dígito digitado no meio de
 * um número.
 */
function Contato({ lead }: { lead: LeadWithRelations }) {
  const [salvando, iniciar] = useTransition();
  const [nome, setNome] = useState(lead.contact?.name ?? "");
  const [telefone, setTelefone] = useState(
    formatarTelefone(lead.contact?.phone ?? null) ?? "",
  );
  const [email, setEmail] = useState(lead.contact?.email ?? "");

  /* ⚠️ QUEM REINICIA ESTES TRÊS CAMPOS É O `key={lead.id}` no ponto de
     uso, não um effect aqui dentro. Trocar de lead troca a identidade do
     componente, e ele remonta já com o contato certo — sem o quadro
     intermediário mostrando o telefone do lead anterior, e sem o
     `set-state-in-effect` que a versão com `useEffect` produzia. */

  const mudou =
    nome !== (lead.contact?.name ?? "") ||
    telefone !== (formatarTelefone(lead.contact?.phone ?? null) ?? "") ||
    email !== (lead.contact?.email ?? "");

  function salvar() {
    iniciar(async () => {
      const r = await salvarContato({
        dealId: lead.id,
        clientId: lead.client_id,
        contactId: lead.contact_id,
        name: nome.trim(),
        phone: telefone.trim() || null,
        email: email.trim() || null,
      });
      if (r.ok) toast.success("Contato salvo.");
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Contato</span>
        {mudou && (
          <Button size="xs" onClick={salvar} disabled={salvando || !nome.trim()}>
            {salvando ? <Loader2 className="size-3 animate-spin" /> : null}
            Salvar
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome"
          aria-label="Nome do contato"
        />
        <Input
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          placeholder="(47) 99999-9999"
          inputMode="tel"
          aria-label="Telefone"
        />
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
          inputMode="email"
          aria-label="E-mail"
          className="sm:col-span-2"
        />
      </div>

      {lead.contact?.phone && (
        <a
          href={`https://wa.me/${
            lead.contact.phone.length === 10 || lead.contact.phone.length === 11
              ? `55${lead.contact.phone}`
              : lead.contact.phone
          }`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <MessageCircle className="size-3.5" />
          Abrir no WhatsApp
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tarefas({
  lead,
  tarefas,
  carregando,
  onMudou,
}: {
  lead: LeadWithRelations;
  tarefas: LeadTask[];
  carregando: boolean;
  onMudou: () => Promise<void>;
}) {
  const [criando, iniciar] = useTransition();
  const [titulo, setTitulo] = useState("");
  const [quando, setQuando] = useState(dataNoBrasil());

  function criar() {
    const texto = titulo.trim();
    if (!texto) return;

    iniciar(async () => {
      const r = await criarTarefaDoLead({
        dealId: lead.id,
        title: texto,
        dueDate: quando,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTitulo("");
      await onMudou();
    });
  }

  function alternar(tarefa: LeadTask) {
    iniciar(async () => {
      const r = await concluirTarefaDoLead({
        taskId: tarefa.id,
        feita: !tarefa.done_at,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      await onMudou();
    });
  }

  const abertas = tarefas.filter((t) => !t.done_at);
  const feitas = tarefas.filter((t) => t.done_at);

  return (
    <section>
      <h3 className="eyebrow">Próximos passos</h3>

      <div className="mt-2.5 flex gap-2">
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              criar();
            }
          }}
          placeholder="Ligar de volta"
          aria-label="O que precisa ser feito"
          className="flex-1"
        />
        <Input
          type="date"
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
          aria-label="Quando"
          className="w-[140px] shrink-0"
        />
        <Button
          size="icon"
          onClick={criar}
          disabled={criando || !titulo.trim()}
          aria-label="Adicionar próximo passo"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {abertas.map((t) => {
          const prazo = formatDueDate(t.due_at);
          return (
            <li key={t.id} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => alternar(t)}
                aria-label={`Concluir: ${t.title}`}
                className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border outline-none transition-colors hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug">{t.title}</p>
                <p
                  className={cn(
                    "text-2xs",
                    prazo.tone === "overdue" && "font-medium text-negative",
                    prazo.tone === "today" && "font-medium text-warning",
                    (prazo.tone === "soon" || prazo.tone === "normal") &&
                      "text-muted-foreground",
                  )}
                >
                  {prazo.label}
                </p>
              </div>
            </li>
          );
        })}

        {feitas.map((t) => (
          <li key={t.id} className="flex items-start gap-2 opacity-55">
            <button
              type="button"
              onClick={() => alternar(t)}
              aria-label={`Reabrir: ${t.title}`}
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Check className="size-3" />
            </button>
            <p className="min-w-0 flex-1 text-xs leading-snug line-through">
              {t.title}
            </p>
          </li>
        ))}

        {!carregando && tarefas.length === 0 && (
          <li className="text-2xs text-muted-foreground/70">
            Nenhum passo marcado. Lead sem próximo passo é lead esquecido.
          </li>
        )}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Notas({
  lead,
  notas,
  carregando,
  onMudou,
}: {
  lead: LeadWithRelations;
  notas: Nota[];
  carregando: boolean;
  onMudou: () => Promise<void>;
}) {
  const [enviando, iniciar] = useTransition();
  const [texto, setTexto] = useState("");

  function enviar() {
    const corpo = texto.trim();
    if (!corpo) return;

    iniciar(async () => {
      const r = await anotarNoLead({ dealId: lead.id, body: corpo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTexto("");
      await onMudou();
    });
  }

  return (
    <section className="border-t border-hairline pt-5">
      <h3 className="eyebrow">Anotações</h3>

      <div className="mt-2.5 flex flex-col gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="O que aconteceu na conversa?"
          rows={3}
          aria-label="Nova anotação"
        />
        <Button
          size="sm"
          className="self-end"
          onClick={enviar}
          disabled={enviando || !texto.trim()}
        >
          {enviando ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Anotar
        </Button>
      </div>

      <ul className="mt-4 flex flex-col gap-3.5">
        {carregando && (
          <li className="text-2xs text-muted-foreground/70">carregando…</li>
        )}

        {!carregando && notas.length === 0 && (
          <li className="text-2xs text-muted-foreground/70">
            Nada anotado ainda.
          </li>
        )}

        {notas.map((n) => (
          <li key={n.id}>
            <p className="whitespace-pre-wrap text-xs leading-relaxed">{n.body}</p>
            <p className="mt-1 text-2xs text-muted-foreground/70">
              {n.author?.full_name ?? "Alguém"} · há{" "}
              <TempoDesde iso={n.created_at} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Apagar de vez — com confirmação em dois toques, sem diálogo.
 *
 * O aviso importa mais que o clique duplo: apagar NÃO é o caminho do
 * lead ruim. Esse vai para "Descartado" com motivo, senão a contagem
 * que justifica o módulo inteiro perde a evidência.
 */
function ExcluirLead({
  lead,
  onExcluido,
}: {
  lead: LeadWithRelations;
  onExcluido: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, iniciar] = useTransition();

  /* Volta ao estado fechado pelo `key={lead.id}` do ponto de uso — do
     contrário, abrir a ficha do lead seguinte encontraria a confirmação
     de exclusão já armada do anterior, o que é o pior lugar possível
     para um estado vazar entre telas. */

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="flex items-center gap-1.5 text-2xs text-muted-foreground/70 outline-none transition-colors hover:text-negative focus-visible:text-negative"
      >
        <Trash2 className="size-3" />
        Excluir este lead
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-muted-foreground">
        Apaga o lead, as anotações e os próximos passos. Se ele só não
        prestou, prefira descartar com motivo — apagar some com a evidência
        de que o anúncio trouxe a pessoa errada.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="xs"
          disabled={apagando}
          onClick={() =>
            iniciar(async () => {
              const r = await excluirLead(lead.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Lead excluído.");
              onExcluido();
            })
          }
        >
          {apagando ? <Loader2 className="size-3 animate-spin" /> : null}
          Excluir mesmo assim
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirmando(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
