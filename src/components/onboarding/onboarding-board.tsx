"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Plus, Search, Trash2 } from "lucide-react";

import {
  adicionarItem,
  concluirOnboarding,
  marcarItem,
  removerItem,
} from "@/app/(app)/onboarding/actions";
import { ClientMark } from "@/components/clients/client-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { checklistDoCliente, progresso } from "@/lib/onboarding/checklist";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

const SEGMENTO: Record<Client["segment"], string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

/**
 * Grade de clientes em onboarding — mesma disposição da página Clientes.
 * Clicar no card abre o checklist; a 100% aparece o botão que manda o
 * cliente para Clientes.
 */
export function OnboardingBoard({ clients }: { clients: Client[] }) {
  // Outra pessoa marcando item ou concluindo: a grade acompanha.
  useRealtimeRefresh("clients");

  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t ? clients.filter((c) => c.name.toLowerCase().includes(t)) : clients;
  }, [busca, clients]);

  // Busca o cliente pelo id na lista NOVA a cada refresh, para o diálogo
  // mostrar o que o servidor acabou de gravar.
  const aberto = clients.find((c) => c.id === abertoId) ?? null;

  if (clients.length === 0) {
    return (
      <p className="rounded-xl bg-surface-2/50 p-6 text-center text-sm text-muted-foreground ring-1 ring-hairline">
        Nenhum cliente em onboarding agora. Use &ldquo;Novo cliente&rdquo; para
        cadastrar quem está entrando.
      </p>
    );
  }

  return (
    <>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente"
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visiveis.map((c, i) => (
          <CardDeOnboarding
            key={c.id}
            client={c}
            index={i}
            onAbrir={() => setAbertoId(c.id)}
          />
        ))}
      </div>

      <Dialog
        open={aberto !== null}
        onOpenChange={(open) => !open && setAbertoId(null)}
      >
        {aberto && (
          <Checklist client={aberto} onConcluido={() => setAbertoId(null)} />
        )}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */

function CardDeOnboarding({
  client,
  index,
  onAbrir,
}: {
  client: Client;
  index: number;
  onAbrir: () => void;
}) {
  const itens = checklistDoCliente(client);
  const feitos = itens.filter((i) => i.done).length;
  const pct = progresso(itens);

  return (
    <button
      type="button"
      onClick={onAbrir}
      style={{ "--rise-delay": `${index * 55}ms` } as React.CSSProperties}
      className={cn(
        "rise-in flex flex-col rounded-xl bg-card text-left ring-1 ring-hairline",
        "shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        "hover:ring-[color-mix(in_oklab,var(--foreground)_16%,transparent)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <header className="flex w-full items-start gap-3 p-4">
        <ClientMark client={client} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-tight">
              {client.name}
            </h3>
            <Badge className="shrink-0 border-transparent bg-warning-muted text-warning">
              Onboarding
            </Badge>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {SEGMENTO[client.segment]}
          </p>
        </div>
      </header>

      <div className="w-full border-t border-hairline p-4">
        <BarraDeProgresso pct={pct} />
        <p className="mt-2 text-2xs text-muted-foreground">
          {feitos} de {itens.length} itens concluídos
        </p>
      </div>

      <footer className="flex w-full items-center justify-between border-t border-hairline px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">Abrir checklist</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
      </footer>
    </button>
  );
}

function BarraDeProgresso({ pct }: { pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Progresso</span>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso do onboarding"
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            pct === 100 ? "bg-positive" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function Checklist({
  client,
  onConcluido,
}: {
  client: Client;
  onConcluido: () => void;
}) {
  const itens = checklistDoCliente(client);
  const pct = progresso(itens);
  const [novo, setNovo] = useState("");
  const [pendente, iniciar] = useTransition();

  function rodar(acao: () => Promise<{ ok: true } | { ok: false; error: string }>, depois?: () => void) {
    iniciar(async () => {
      const r = await acao();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      depois?.();
    });
  }

  return (
    <DialogContent className="flex max-h-[88vh] w-full flex-col gap-0 p-0 sm:max-w-lg">
      <DialogHeader className="border-b border-hairline p-4">
        <div className="flex items-center gap-3">
          <ClientMark client={client} />
          <div className="min-w-0">
            <DialogTitle className="truncate">{client.name}</DialogTitle>
            <DialogDescription>Checklist de onboarding</DialogDescription>
          </div>
        </div>
        <div className="mt-4">
          <BarraDeProgresso pct={pct} />
        </div>
      </DialogHeader>

      <ul className="flex-1 overflow-y-auto p-2">
        {itens.map((item) => (
          <li
            key={item.id}
            className="group/item flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
          >
            <Checkbox
              id={`ob-${item.id}`}
              checked={item.done}
              disabled={pendente}
              onCheckedChange={(c) =>
                rodar(() =>
                  marcarItem({ clientId: client.id, itemId: item.id, feito: c === true }),
                )
              }
              className="mt-0.5"
            />
            <label htmlFor={`ob-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span
                className={cn(
                  "block text-sm",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.label}
              </span>
              {item.done && item.done_at && (
                <span className="block text-[10px] text-muted-foreground">
                  {item.done_by ?? "Alguém"} · {DATA_CURTA.format(new Date(item.done_at))}
                </span>
              )}
            </label>
            <button
              type="button"
              disabled={pendente}
              onClick={() =>
                rodar(() => removerItem({ clientId: client.id, itemId: item.id }))
              }
              aria-label={`Remover "${item.label}"`}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-negative focus-visible:text-negative"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2 border-t border-hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (novo.trim().length < 2) return;
          rodar(
            () => adicionarItem({ clientId: client.id, label: novo }),
            () => setNovo(""),
          );
        }}
      >
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Adicionar item só para este cliente"
          aria-label="Novo item do checklist"
          className="h-8"
          maxLength={120}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pendente || novo.trim().length < 2}>
          <Plus className="size-3.5" />
          Adicionar
        </Button>
      </form>

      {pct === 100 && (
        <div className="border-t border-hairline p-3">
          <Button
            className="w-full"
            disabled={pendente}
            onClick={() =>
              rodar(
                () => concluirOnboarding({ clientId: client.id }),
                () => {
                  toast.success(`${client.name} foi para Clientes.`);
                  onConcluido();
                },
              )
            }
          >
            {pendente ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            Enviar para Clientes
          </Button>
        </div>
      )}
    </DialogContent>
  );
}
