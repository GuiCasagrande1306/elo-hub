"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NetworkGlyph } from "./network-glyph";
import { removerConta, salvarConta } from "@/app/(app)/midias-sociais/actions";
import { REDES, rede, urlDoPerfil } from "@/lib/social/networks";
import { cn } from "@/lib/utils";
import type { Client, SocialAccount, SocialNetwork } from "@/types/database";

/* =====================================================================
   Perfis sociais da carteira
   ---------------------------------------------------------------------
   CADASTRO EDITORIAL, não conexão de API. Guarda o @ de cada cliente em
   cada rede para que o compositor saiba o que oferecer e para que quem
   vai publicar saiba em qual perfil entrar. Não há token aqui, e este
   módulo não publica nada.

   MOSTRA TAMBÉM QUEM NÃO TEM NADA, e essa é a metade útil. A tela de
   agenda dos relatórios ensinou isso nesta mesma base: enquanto a
   configuração morava só dentro do formulário de cada cliente, um por
   vez, o resultado medido eram 47 contas e zero configuradas — sem que
   nada na tela dissesse por quê. Uma lista que só mostra o que está
   preenchido esconde exatamente o trabalho que falta.
   ===================================================================== */

export function AccountsPanel({
  clients,
  accounts,
  podeEditar,
}: {
  clients: Client[];
  accounts: SocialAccount[];
  /** Cadastro de perfil é ato administrativo — a policy exige admin. */
  podeEditar: boolean;
}) {
  const porCliente = useMemo(() => {
    const mapa = new Map<string, SocialAccount[]>();
    for (const conta of accounts) {
      const lista = mapa.get(conta.client_id);
      if (lista) lista.push(conta);
      else mapa.set(conta.client_id, [conta]);
    }
    return mapa;
  }, [accounts]);

  /* A carteira inteira que `getClients` devolve — encerrados já ficaram
     de fora lá. Filtrar por `status === "active"` aqui esconderia quem
     está em onboarding, que é justamente quando o @ é cadastrado. */
  const semNenhum = clients.filter((c) => !porCliente.has(c.id));

  return (
    <section className="flex flex-col gap-3">
      {semNenhum.length > 0 && (
        <p className="rounded-xl bg-warning-muted px-4 py-3 text-xs text-warning">
          <strong className="font-semibold tabular-nums">
            {semNenhum.length} de {clients.length}
          </strong>{" "}
          {semNenhum.length === 1 ? "conta não tem" : "contas não têm"} nenhum
          perfil cadastrado. O compositor ainda deixa planejar peças para elas —
          só não sabe sugerir as redes certas.
        </p>
      )}

      <div className="surface-card divide-y divide-hairline overflow-hidden">
        {clients.map((cliente) => {
          const contas = porCliente.get(cliente.id) ?? [];

          return (
            <div
              key={cliente.id}
              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 items-center gap-2 sm:w-52">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: cliente.brand_primary ?? "#94A3B8" }}
                />
                <span className="truncate text-sm font-medium">{cliente.name}</span>
              </span>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {contas.length === 0 && (
                  <span className="text-2xs text-muted-foreground">
                    Nenhum perfil
                  </span>
                )}

                {contas.map((conta) => (
                  <ChipDeConta
                    key={conta.network}
                    conta={conta}
                    podeEditar={podeEditar}
                  />
                ))}

                {podeEditar && (
                  <NovaConta
                    clientId={cliente.id}
                    jaCadastradas={contas.map((c) => c.network)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ChipDeConta({
  conta,
  podeEditar,
}: {
  conta: SocialAccount;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [handle, setHandle] = useState(conta.handle);
  const [salvando, iniciar] = useTransition();

  const link = conta.profile_url ?? urlDoPerfil(conta.network, conta.handle);

  function salvar() {
    iniciar(async () => {
      const r = await salvarConta({
        clientId: conta.client_id,
        network: conta.network,
        handle,
        isActive: conta.is_active,
        notes: conta.notes,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  }

  function remover() {
    iniciar(async () => {
      const r = await removerConta({
        clientId: conta.client_id,
        network: conta.network,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${rede(conta.network).label} removido.`);
      router.refresh();
    });
  }

  if (editando) {
    return (
      <span className="flex items-center gap-1 rounded-lg border border-signal bg-background px-1.5 py-1">
        <NetworkGlyph network={conta.network} />
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          className="h-6 w-32 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") {
              setHandle(conta.handle);
              setEditando(false);
            }
          }}
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded p-0.5 text-positive hover:bg-accent"
          aria-label="Salvar"
        >
          {salvando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={remover}
          disabled={salvando}
          className="rounded p-0.5 text-negative hover:bg-accent"
          aria-label="Remover perfil"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setHandle(conta.handle);
            setEditando(false);
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          aria-label="Cancelar"
        >
          <X className="size-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-xs",
        !conta.is_active && "opacity-50",
      )}
      title={conta.is_active ? undefined : "Perfil inativo"}
    >
      <NetworkGlyph network={conta.network} colorida={conta.is_active} />

      {podeEditar ? (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="max-w-36 truncate text-muted-foreground transition-colors hover:text-foreground"
        >
          @{conta.handle}
        </button>
      ) : (
        <span className="max-w-36 truncate text-muted-foreground">
          @{conta.handle}
        </span>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label={`Abrir perfil no ${rede(conta.network).label}`}
        >
          <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  );
}

function NovaConta({
  clientId,
  jaCadastradas,
}: {
  clientId: string;
  jaCadastradas: SocialNetwork[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [network, setNetwork] = useState<SocialNetwork | null>(null);
  const [handle, setHandle] = useState("");
  const [salvando, iniciar] = useTransition();

  /* Redes já cadastradas somem da lista: a PK é (cliente, rede), então
     escolher uma repetida só produziria um upsert silencioso por cima do
     @ que já estava lá. */
  const disponiveis = REDES.filter((r) => !jaCadastradas.includes(r.id));

  function salvar() {
    if (!network || !handle.trim()) return;

    iniciar(async () => {
      const r = await salvarConta({ clientId, network, handle });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setNetwork(null);
      setHandle("");
      setAberto(false);
      router.refresh();
    });
  }

  if (disponiveis.length === 0) return null;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg border border-dashed border-hairline px-2 py-1 text-2xs text-muted-foreground transition-colors hover:border-signal hover:text-foreground"
          >
            <Plus className="size-3" />
            Perfil
          </button>
        }
      />

      <PopoverContent align="start" className="w-64 p-2">
        <p className="eyebrow mb-1.5 px-1">Adicionar perfil</p>

        <div className="mb-2 flex flex-wrap gap-1">
          {disponiveis.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setNetwork(r.id)}
              aria-pressed={network === r.id}
              title={r.label}
              className={cn(
                "rounded-md border p-1.5 transition-colors",
                network === r.id
                  ? "border-signal bg-accent"
                  : "border-hairline hover:bg-accent",
              )}
            >
              <NetworkGlyph network={r.id} colorida={network === r.id} />
            </button>
          ))}
        </div>

        {network && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">@</span>
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder={rede(network).label.toLowerCase()}
              className="h-8 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
              }}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={salvar}
              disabled={salvando || !handle.trim()}
            >
              {salvando ? <Loader2 className="size-3.5 animate-spin" /> : "Ok"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
