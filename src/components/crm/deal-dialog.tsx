"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Building2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  UserPlus,
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
import {
  atualizarNegocio,
  carregarAtividades,
  registrarAtividade,
} from "@/app/(app)/comercial/actions";
import {
  ETAPAS,
  ETAPA_LABEL,
  MOTIVO_LABEL,
  ORIGEM_LABEL,
  ORIGENS,
  valorDoNegocio,
} from "@/lib/crm/stages";
import { formatCurrency, parseCurrencyToCents } from "@/lib/format";
import { normalizePhone } from "@/lib/whatsapp/jid";
import { cn } from "@/lib/utils";
import type {
  ActivityKind,
  CrmActivity,
  DealOrigem,
  DealStage,
  DealWithRelations,
  Profile,
} from "@/types/database";

/**
 * Ficha do negócio.
 *
 * Duas metades: à esquerda o que o negócio É (valor, dono, contato,
 * próximo passo); à direita o que ACONTECEU. A divisão é a mesma de
 * HubSpot e Pipedrive, e existe porque as duas perguntas são feitas em
 * momentos diferentes — "quanto vale e de quem é" antes da ligação,
 * "o que já foi conversado" durante.
 *
 * GRAVAÇÃO POR CAMPO, com debounce nos textos livres. Um botão "Salvar"
 * único obrigaria a decidir o que fazer quando a pessoa fecha o modal
 * sem clicar — e a resposta honesta (descartar) é a que mais irrita.
 */

const TIPOS: { id: Exclude<ActivityKind, "etapa">; label: string }[] = [
  { id: "nota", label: "Nota" },
  { id: "ligacao", label: "Ligação" },
  { id: "reuniao", label: "Reunião" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "E-mail" },
];

const TIPO_LABEL: Record<ActivityKind, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  reuniao: "Reunião",
  whatsapp: "WhatsApp",
  email: "E-mail",
  etapa: "Etapa",
};

type Atividade = CrmActivity & {
  author: Pick<Profile, "id" | "full_name"> | null;
};

export function DealDialog({
  deal,
  team,
  open,
  onOpenChange,
  onConverter,
}: {
  deal: DealWithRelations | null;
  team: Profile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverter: (deal: DealWithRelations) => void;
}) {
  const [salvando, iniciarSalvamento] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Grava o que estiver pendente ao desmontar — fechar o modal no meio
  // do debounce não pode descartar a edição.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!deal) return null;

  function patch(campos: Parameters<typeof atualizarNegocio>[0]) {
    iniciarSalvamento(async () => {
      const r = await atualizarNegocio(campos);
      if (!r.ok) toast.error(r.error);
    });
  }

  /** Texto livre: agenda a gravação e cancela a anterior. */
  function agendar(campos: Parameters<typeof atualizarNegocio>[0]) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => patch(campos), 700);
  }

  const valor = valorDoNegocio(deal);
  const zap = deal.contact_phone ? normalizePhone(deal.contact_phone) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] overflow-y-auto p-0 sm:max-w-[min(94vw,920px)]">
        <div className="border-b border-hairline px-5 py-4">
          {/* Título acessível separado do campo editável — mesmo padrão
              do modal de tarefa. `asChild` é API do Radix e NÃO existe
              aqui: este shadcn roda sobre Base UI, onde a composição é
              `render={<X/>}`. Para um título editável, porém, o caminho
              limpo é o `sr-only` com o input ao lado: o leitor de tela
              anuncia o nome do diálogo sem depender de composição. */}
          <DialogTitle className="sr-only">{deal.title}</DialogTitle>

          <input
            defaultValue={deal.title}
            onChange={(e) => agendar({ dealId: deal.id, title: e.target.value })}
            className="w-full bg-transparent text-lg font-semibold tracking-[-0.01em] outline-none"
            aria-label="Nome do negócio"
          />

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {deal.company && (
              <span className="flex items-center gap-1">
                <Building2 className="size-3.5" />
                {deal.company}
              </span>
            )}
            {valor > 0 && (
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(valor)}
                <span className="ml-1 font-normal text-muted-foreground">
                  (12 meses + entrada)
                </span>
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

        <div className="grid gap-0 md:grid-cols-[1fr_340px]">
          {/* ---------------- O que o negócio é ---------------- */}
          <div className="flex flex-col gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Etapa">
                <Select
                  value={deal.stage}
                  onValueChange={(v) => {
                    /* Perder pede motivo, e o motivo é escolhido no
                       quadro (arrastando) ou aqui. Como este seletor não
                       tem onde perguntar, mandar para 'perdido' daqui
                       fica bloqueado — o banco recusaria de qualquer
                       forma pelo check, e um erro cru seria pior. */
                    if (v === "perdido") {
                      toast.info(
                        "Para marcar como perdido, arraste o cartão até a coluna Perdido — lá dá para registrar o motivo.",
                      );
                      return;
                    }
                    patch({ dealId: deal.id, stage: v } as never);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) => ETAPA_LABEL[v as DealStage] ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ETAPAS.filter((e) => e.id !== "perdido").map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              <Campo label="Origem">
                <Select
                  value={deal.origem}
                  onValueChange={(v) => patch({ dealId: deal.id, origem: v } as never)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) => ORIGEM_LABEL[v as DealOrigem] ?? ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ORIGENS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              <Campo label="Mensalidade">
                <Input
                  defaultValue={
                    deal.monthly_fee_cents ? formatCurrency(deal.monthly_fee_cents) : ""
                  }
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  className="tabular-nums"
                  onBlur={(e) =>
                    patch({
                      dealId: deal.id,
                      monthlyFeeCents: parseCurrencyToCents(e.target.value) ?? 0,
                    })
                  }
                />
              </Campo>

              <Campo label="Entrada / setup">
                <Input
                  defaultValue={
                    deal.setup_fee_cents ? formatCurrency(deal.setup_fee_cents) : ""
                  }
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  className="tabular-nums"
                  onBlur={(e) =>
                    patch({
                      dealId: deal.id,
                      setupFeeCents: parseCurrencyToCents(e.target.value) ?? 0,
                    })
                  }
                />
              </Campo>

              <Campo label="Responsável">
                <Select
                  value={deal.owner_id ?? "__ninguem__"}
                  onValueChange={(v) =>
                    patch({
                      dealId: deal.id,
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

              <Campo label="Previsão de fechamento">
                <Input
                  type="date"
                  defaultValue={deal.expected_close_date?.slice(0, 10) ?? ""}
                  className="tabular-nums"
                  onChange={(e) =>
                    patch({
                      dealId: deal.id,
                      expectedCloseDate: e.target.value || null,
                    })
                  }
                />
              </Campo>
            </div>

            {/* PRÓXIMA AÇÃO em bloco próprio, com moldura. É o campo que
                o módulo existe para ter — enfileirá-lo com os outros o
                faria desaparecer no meio do formulário. */}
            <div className="rounded-lg border border-hairline p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Próximo passo
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  defaultValue={deal.next_action ?? ""}
                  placeholder="Ex.: ligar para confirmar a proposta"
                  className="flex-1"
                  onBlur={(e) =>
                    patch({
                      dealId: deal.id,
                      nextAction: e.target.value.trim() || null,
                      nextActionAt: e.target.value.trim()
                        ? (deal.next_action_at?.slice(0, 10) ?? hojeISO())
                        : null,
                    })
                  }
                />
                <Input
                  type="date"
                  defaultValue={deal.next_action_at?.slice(0, 10) ?? ""}
                  className="tabular-nums sm:w-40"
                  onChange={(e) =>
                    patch({
                      dealId: deal.id,
                      nextAction: deal.next_action,
                      nextActionAt: e.target.value || null,
                    })
                  }
                />
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Os dois juntos ou nenhum — lembrete sem prazo é o mesmo que
                nada.
              </p>
            </div>

            {/* ---------------- Contato ---------------- */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Contato">
                <Input
                  defaultValue={deal.contact_name ?? ""}
                  onBlur={(e) =>
                    patch({ dealId: deal.id, contactName: e.target.value.trim() || null })
                  }
                />
              </Campo>
              <Campo label="Telefone">
                <Input
                  defaultValue={deal.contact_phone ?? ""}
                  onBlur={(e) =>
                    patch({
                      dealId: deal.id,
                      contactPhone: e.target.value.trim() || null,
                    })
                  }
                />
              </Campo>
              <Campo label="E-mail">
                <Input
                  defaultValue={deal.contact_email ?? ""}
                  onBlur={(e) =>
                    patch({
                      dealId: deal.id,
                      contactEmail: e.target.value.trim() || null,
                    })
                  }
                />
              </Campo>
            </div>

            {(zap || deal.contact_email) && (
              <div className="flex flex-wrap gap-2">
                {zap && (
                  <Button variant="outline" size="sm" render={<a
                    href={`https://wa.me/${zap}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />} nativeButton={false}>
                    <MessageCircle className="size-4" />
                    WhatsApp
                  </Button>
                )}
                {deal.contact_phone && (
                  <Button variant="outline" size="sm" render={<a href={`tel:${deal.contact_phone}`} />} nativeButton={false}>
                    <Phone className="size-4" />
                    Ligar
                  </Button>
                )}
                {deal.contact_email && (
                  <Button variant="outline" size="sm" render={<a href={`mailto:${deal.contact_email}`} />} nativeButton={false}>
                    <Mail className="size-4" />
                    E-mail
                  </Button>
                )}
              </div>
            )}

            <Campo label="Observações">
              <Textarea
                rows={3}
                defaultValue={deal.notes ?? ""}
                placeholder="Contexto que não cabe na linha do tempo."
                onChange={(e) =>
                  agendar({ dealId: deal.id, notes: e.target.value || null })
                }
              />
            </Campo>

            {deal.stage === "perdido" && deal.lost_reason && (
              <p className="rounded-lg bg-negative-muted px-3 py-2 text-xs text-negative">
                Perdido — {MOTIVO_LABEL[deal.lost_reason]}
              </p>
            )}

            {deal.stage === "ganho" && (
              <div className="rounded-lg border border-hairline p-3">
                {deal.client_id ? (
                  <p className="text-xs text-muted-foreground">
                    Este negócio já virou cliente.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Negócio ganho. Criar o cliente leva nome, contato e
                      mensalidade para a carteira — falta só escolher nicho e
                      agência.
                    </p>
                    <Button
                      size="sm"
                      className="mt-2.5"
                      onClick={() => onConverter(deal)}
                    >
                      <UserPlus className="size-4" />
                      Criar cliente
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ---------------- O que aconteceu ---------------- */}
          {/* ⚠️ O HISTÓRICO É COMPONENTE PRÓPRIO, COM `key`, e isso não é
              organização: é a única forma de carregá-lo sem `setState`
              síncrono dentro de `useEffect`, que o lint do React
              Compiler recusa (`react-hooks/set-state-in-effect`).

              Com `key={deal.id}`, trocar de negócio DESMONTA e remonta —
              o estado nasce em "carregando" pelo valor inicial do
              `useState`, e o efeito só precisa buscar e gravar dentro do
              `.then`, que é assíncrono e portanto permitido. */}
          <Historico key={deal.id} dealId={deal.id} />
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
    <label className="flex flex-col gap-1.5">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Hoje em São Paulo — o padrão quando alguém escreve a ação sem data. */
function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function quando(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/* ------------------------------------------------------------------ */

function Historico({ dealId }: { dealId: string }) {
  /* Nasce carregando. O componente só existe enquanto um negócio está
     aberto, e é remontado a cada troca — então o estado inicial é
     sempre o certo, sem nenhum efeito precisar corrigi-lo depois. */
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<Exclude<ActivityKind, "etapa">>("nota");
  const [salvando, iniciar] = useTransition();

  useEffect(() => {
    let cancelado = false;

    carregarAtividades(dealId)
      .then((linhas) => {
        if (!cancelado) {
          setAtividades(linhas as Atividade[]);
          setCarregando(false);
        }
      })
      .catch(() => {
        if (!cancelado) {
          setCarregando(false);
          toast.error("Não deu para carregar o histórico.");
        }
      });

    return () => {
      cancelado = true;
    };
  }, [dealId]);

  function adicionar() {
    const corpo = texto.trim();
    if (!corpo) return;

    iniciar(async () => {
      const r = await registrarAtividade({ dealId, kind: tipo, body: corpo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTexto("");
      /* Relê do servidor em vez de acrescentar à lista local: o trigger
         de etapa também escreve aqui, e uma lista montada só com o que
         esta tela sabe ficaria com buracos. */
      setAtividades((await carregarAtividades(dealId)) as Atividade[]);
    });
  }

  return (
    <aside className="border-t border-hairline p-5 md:border-l md:border-t-0">
      <h3 className="text-sm font-semibold">Histórico</h3>

      <div className="mt-3 flex flex-col gap-2">
        <Select
          value={tipo}
          onValueChange={(v) =>
            setTipo((v ?? "nota") as Exclude<ActivityKind, "etapa">)
          }
        >
          <SelectTrigger className="w-32 shrink-0">
            <SelectValue>
              {(v: string) => TIPO_LABEL[v as ActivityKind] ?? "Nota"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Textarea
          rows={2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="O que aconteceu nesta conversa?"
        />

        <Button
          size="sm"
          disabled={!texto.trim() || salvando}
          onClick={adicionar}
          className="self-start"
        >
          Registrar
        </Button>
      </div>

      <ul className="mt-5 flex flex-col gap-3.5">
        {carregando && (
          <li className="text-2xs text-muted-foreground">carregando…</li>
        )}

        {!carregando && atividades.length === 0 && (
          <li className="text-2xs text-muted-foreground">
            Nada registrado ainda.
          </li>
        )}

        {atividades.map((a) => (
          <li key={a.id} className="flex gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                a.kind === "etapa" ? "bg-signal" : "bg-muted-foreground/40",
              )}
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-xs leading-snug",
                  a.kind === "etapa" && "text-muted-foreground",
                )}
              >
                {a.body}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground/70">
                {TIPO_LABEL[a.kind]}
                {a.author ? ` · ${a.author.full_name.split(" ")[0]}` : ""} ·{" "}
                {quando(a.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
