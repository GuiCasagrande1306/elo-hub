"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  adicionarNota,
  alternarTarefa,
  atualizarLead,
  carregarNotas,
  carregarTarefas,
  criarTarefa,
  excluirLead,
  excluirTarefa,
  moverLead,
  type TarefaDoLead,
} from "@/app/(app)/crm/actions";
import { formatCurrency, formatDueDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROTULO_ORIGEM, type LeadDeal, type LeadStage } from "@/lib/crm/types";
import { formatarTelefone } from "./lead-card";

/* =====================================================================
   A ficha do lead
   ---------------------------------------------------------------------
   O QUE ESTA TELA PRECISA RESPONDER, na ordem em que a pergunta aparece
   para quem abre o card: com quem eu falo, quanto vale, em que pé está,
   o que foi dito até agora, e o que eu combinei de fazer.

   As três primeiras são campos; a quarta é o histórico de notas; a
   quinta são as tarefas — e é a quinta que separa CRM de planilha. Um
   funil sem lembrete esfria em silêncio: ninguém percebe o lead parado
   há doze dias em "Proposta" porque nada nunca vence.

   SALVA AO SAIR DO CAMPO, sem botão "Salvar". Um CRM é preenchido em
   pedaços, entre uma ligação e outra, e a tela que exige confirmar cada
   edição é a tela em que metade das edições se perde ao fechar. O aviso
   de erro aparece se o servidor recusar — o que não pode é parecer que
   gravou sem ter gravado.
   ===================================================================== */

interface Props {
  deal: LeadDeal | null;
  stages: LeadStage[];
  equipe: { id: string; full_name: string }[];
  /** Cliente não reatribui dono para gente da agência, e vice-versa. */
  onFechar: () => void;
}

export function LeadSheet({ deal, stages, equipe, onFechar }: Props) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();

  const etapa = stages.find((s) => s.id === deal?.stage_id) ?? null;

  return (
    <Sheet open={deal !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {deal && (
          <>
            <SheetHeader className="border-b border-hairline pr-12">
              <SheetTitle className="text-balance leading-snug">
                {deal.title}
              </SheetTitle>
              <SheetDescription>
                {ROTULO_ORIGEM[deal.source]} ·{" "}
                {deal.value_cents > 0
                  ? formatCurrency(deal.value_cents)
                  : "sem valor estimado"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 p-4">
              <Contato deal={deal} />

              {/* --- etapa ------------------------------------------- */}
              <Campo rotulo="Etapa">
                <Select
                  value={deal.stage_id}
                  onValueChange={(v) => {
                    const destino = stages.find((s) => s.id === v);
                    if (!destino || destino.id === deal.stage_id) return;

                    iniciar(async () => {
                      const r = await moverLead({
                        dealId: deal.id,
                        stageId: destino.id,
                        position: deal.position,
                        fecha: destino.kind !== "aberto",
                      });
                      if (!r.ok) toast.error(r.error);
                      router.refresh();
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) =>
                        stages.find((s) => s.id === v)?.name ?? "Escolher"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 rounded-full"
                            style={{ background: s.color }}
                          />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              {/* --- valor ------------------------------------------- */}
              <Campo rotulo="Valor do negócio">
                <CampoQueSalva
                  key={`valor-${deal.id}-${deal.value_cents}`}
                  inicial={
                    deal.value_cents > 0
                      ? (deal.value_cents / 100).toFixed(2).replace(".", ",")
                      : ""
                  }
                  placeholder="1.250,00"
                  aoSalvar={(v) => atualizarLead({ dealId: deal.id, value: v })}
                />
              </Campo>

              {/* --- responsável ------------------------------------- */}
              {equipe.length > 0 && (
                <Campo rotulo="Responsável">
                  <Select
                    value={deal.owner_id ?? "_ninguem"}
                    onValueChange={(v) =>
                      iniciar(async () => {
                        const r = await atualizarLead({
                          dealId: deal.id,
                          ownerId: v === "_ninguem" ? null : v,
                        });
                        if (!r.ok) toast.error(r.error);
                        router.refresh();
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          equipe.find((p) => p.id === v)?.full_name ??
                          "Ninguém ainda"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_ninguem">Ninguém ainda</SelectItem>
                      {equipe.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}

              {/* --- motivo da perda --------------------------------- */}
              {/* Só em etapa de perda. Perguntar "por que perdeu?" num
                  lead em negociação é ruído; perguntar depois que ele
                  foi para Perdido é a única chance de a resposta
                  existir — em dois dias ninguém lembra. */}
              {etapa?.kind === "perdido" && (
                <Campo rotulo="Por que perdeu?">
                  <CampoQueSalva
                    key={`perda-${deal.id}-${deal.lost_reason ?? ""}`}
                    inicial={deal.lost_reason ?? ""}
                    placeholder="Preço, prazo, foi com o concorrente…"
                    aoSalvar={(v) =>
                      atualizarLead({ dealId: deal.id, lostReason: v })
                    }
                  />
                </Campo>
              )}

              {/* Chaves com PREFIXO: as duas são irmãs no mesmo pai, e
                  `key={deal.id}` nas duas é chave repetida — o React
                  avisa e reconcilia errado. O prefixo mantém o efeito
                  desejado (trocar de lead remonta as duas, zerando a
                  lista sem `setState` dentro de efeito) sem a colisão. */}
              <Tarefas key={`tarefas-${deal.id}`} dealId={deal.id} equipe={equipe} />
              <Notas key={`notas-${deal.id}`} dealId={deal.id} />

              {/* --- excluir ----------------------------------------- */}
              <div className="border-t border-hairline pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={salvando}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Excluir "${deal.title}"? As notas e tarefas dele vão junto.`,
                      )
                    ) {
                      return;
                    }
                    iniciar(async () => {
                      const r = await excluirLead(deal.id);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Lead excluído.");
                      onFechar();
                      router.refresh();
                    });
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Excluir lead
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

/**
 * Campo de texto que grava ao perder o foco.
 *
 * Só chama o servidor se o valor MUDOU. Sem essa checagem, entrar e sair
 * do campo com Tab dispararia uma escrita por passagem — e cada escrita
 * é um `revalidatePath` que redesenha o quadro inteiro.
 *
 * QUEM SINCRONIZA COM O SERVIDOR É O `key` DE QUEM CHAMA, não um efeito
 * aqui dentro. O quadro é recarregado por outras ações (arrastar,
 * refresh) e pode trazer um valor novo para o mesmo lead; com a chave
 * derivada do valor, o campo remonta já com o texto certo. Um
 * `useEffect` que copiasse a prop para o estado faria a mesma coisa com
 * um render extra — e é exatamente o padrão que o compilador do React
 * recusa.
 */
function CampoQueSalva({
  inicial,
  placeholder,
  aoSalvar,
}: {
  inicial: string;
  placeholder?: string;
  aoSalvar: (valor: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial);
  const [ocupado, iniciar] = useTransition();

  return (
    <div className="relative">
      <Input
        value={valor}
        placeholder={placeholder}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => {
          if (valor === inicial) return;
          iniciar(async () => {
            const r = await aoSalvar(valor);
            if (!r.ok) {
              toast.error(r.error ?? "Não foi possível salvar.");
              setValor(inicial);
              return;
            }
            router.refresh();
          });
        }}
      />
      {ocupado && (
        <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Os atalhos de contato.
 *
 * WHATSAPP ANTES DE LIGAR, porque é assim que a conversa acontece no
 * Brasil — e `wa.me` abre o aplicativo já no número certo, sem ninguém
 * copiar dígito a dígito. O `55` entra aqui: o link internacional exige
 * o país, e o banco guarda o número nacional.
 */
function Contato({ deal }: { deal: LeadDeal }) {
  const contato = deal.contact;
  if (!contato) {
    return (
      <p className="rounded-lg border border-dashed border-hairline px-3 py-2.5 text-2xs text-muted-foreground">
        Sem contato vinculado. O telefone entra ao cadastrar o lead.
      </p>
    );
  }

  const digitos = contato.phone?.replace(/\D/g, "") ?? "";
  const internacional = digitos.length <= 11 ? `55${digitos}` : digitos;

  return (
    <div className="surface-card flex flex-col gap-2 p-3">
      <p className="text-sm font-medium">{contato.name}</p>

      {contato.phone && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://wa.me/${internacional}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-2xs transition-colors hover:bg-accent"
          >
            <MessageCircle className="size-3" />
            WhatsApp
          </a>
          <a
            href={`tel:+${internacional}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-2xs tabular-nums transition-colors hover:bg-accent"
          >
            <Phone className="size-3" />
            {formatarTelefone(contato.phone)}
          </a>
        </div>
      )}

      {contato.email && (
        <a
          href={`mailto:${contato.email}`}
          className="inline-flex w-fit items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Mail className="size-3" />
          {contato.email}
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tarefas({
  dealId,
  equipe,
}: {
  dealId: string;
  equipe: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [lista, setLista] = useState<TarefaDoLead[] | null>(null);
  const [titulo, setTitulo] = useState("");
  const [quando, setQuando] = useState("");
  const [responsavel, setResponsavel] = useState("_ninguem");
  const [ocupado, iniciar] = useTransition();

  /* Sem `setLista(null)` no corpo do efeito: quem zera é a REMONTAGEM.
     A ficha passa `key={deal.id}`, então trocar de lead cria um
     componente novo, com o estado já em `null` — e o efeito só toca no
     estado dentro do `then`, quando a resposta chega. */
  useEffect(() => {
    let vivo = true;
    carregarTarefas(dealId).then((r) => {
      if (vivo) setLista(r.ok ? r.dados : []);
    });
    return () => {
      vivo = false;
    };
  }, [dealId]);

  function adicionar() {
    if (!titulo.trim()) return toast.error("Descreva a tarefa.");
    if (!quando) return toast.error("Escolha data e horário.");

    /* A CONVERSÃO PARA ISO ACONTECE AQUI, no navegador — ver a nota em
       `criarTarefa`. O servidor da Vercel é UTC, e deixar a conversão
       para lá adiantaria toda tarefa em três horas. */
    const iso = new Date(quando).toISOString();

    iniciar(async () => {
      const r = await criarTarefa({
        dealId,
        title: titulo.trim(),
        dueAt: iso,
        assigneeId: responsavel === "_ninguem" ? null : responsavel,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setTitulo("");
      setQuando("");
      const atual = await carregarTarefas(dealId);
      setLista(atual.ok ? atual.dados : []);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Próximos passos
      </h4>

      {lista === null ? (
        <p className="text-2xs text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          Nenhuma tarefa. Um lead sem próximo passo é um lead que esfria.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lista.map((t) => {
            const prazo = formatDueDate(t.due_at);
            const feita = t.done_at !== null;

            return (
              <li
                key={t.id}
                className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-surface-2"
              >
                <button
                  type="button"
                  disabled={ocupado}
                  aria-label={feita ? "Reabrir tarefa" : "Concluir tarefa"}
                  onClick={() =>
                    iniciar(async () => {
                      const r = await alternarTarefa(t.id, !feita);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      const atual = await carregarTarefas(dealId);
                      setLista(atual.ok ? atual.dados : []);
                    })
                  }
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                    feita
                      ? "border-signal bg-signal text-signal-foreground"
                      : "border-hairline hover:border-muted-foreground",
                  )}
                >
                  {feita && <Check className="size-3" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs leading-snug",
                      feita && "text-muted-foreground line-through",
                    )}
                  >
                    {t.title}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span
                      className={cn(
                        !feita && prazo.tone === "overdue" && "text-destructive",
                        !feita && prazo.tone === "today" && "text-warning",
                      )}
                    >
                      {feita ? "Concluída" : prazo.label}
                    </span>
                    {t.assignee?.full_name && <span>· {t.assignee.full_name}</span>}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={ocupado}
                  aria-label="Excluir tarefa"
                  onClick={() =>
                    iniciar(async () => {
                      const r = await excluirTarefa(t.id);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      const atual = await carregarTarefas(dealId);
                      setLista(atual.ok ? atual.dados : []);
                    })
                  }
                  className="shrink-0 p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 rounded-lg border border-hairline p-2">
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ligar para confirmar a proposta"
          className="h-8 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="datetime-local"
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
            className="h-8 w-auto flex-1 text-2xs"
          />
          {equipe.length > 0 && (
            <Select
              value={responsavel}
              onValueChange={(v) => setResponsavel(v ?? "_ninguem")}
            >
              <SelectTrigger className="h-8 w-auto min-w-28 text-2xs">
                <SelectValue>
                  {(v: string) =>
                    equipe.find((p) => p.id === v)?.full_name.split(" ")[0] ??
                    "Quem?"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_ninguem">Quem?</SelectItem>
                {equipe.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={adicionar} disabled={ocupado}>
            <CalendarPlus className="size-3.5" />
            Marcar
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Notas({ dealId }: { dealId: string }) {
  const [lista, setLista] = useState<
    { id: string; body: string; created_at: string; author: { full_name: string } | null }[]
    | null
  >(null);
  const [texto, setTexto] = useState("");
  const [ocupado, iniciar] = useTransition();

  // Zera por remontagem — ver a nota em `Tarefas`.
  useEffect(() => {
    let vivo = true;
    carregarNotas(dealId).then((r) => {
      if (vivo) setLista(r.ok ? r.dados : []);
    });
    return () => {
      vivo = false;
    };
  }, [dealId]);

  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Histórico
      </h4>

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="O que aconteceu nessa conversa?"
        rows={2}
        className="text-xs"
      />

      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        disabled={ocupado || !texto.trim()}
        onClick={() =>
          iniciar(async () => {
            const r = await adicionarNota({ dealId, body: texto });
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            setTexto("");
            const atual = await carregarNotas(dealId);
            setLista(atual.ok ? atual.dados : []);
          })
        }
      >
        Registrar
      </Button>

      {lista === null ? (
        <p className="text-2xs text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          Nada registrado ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 pt-1">
          {lista.map((n) => (
            <li key={n.id} className="border-l-2 border-hairline pl-2.5">
              <p className="whitespace-pre-wrap text-xs leading-snug">{n.body}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {n.author?.full_name ?? "Alguém"} ·{" "}
                {new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                }).format(new Date(n.created_at))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
