"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Client, SocialAccount } from "@/types/database";

/* =====================================================================
   Escolher o cliente da peça
   ---------------------------------------------------------------------
   DUAS REGRAS, e as duas vieram do uso real.

   1. BUSCA. A carteira tem 61 contas ativas. Um `<select>` de 61 linhas
      obriga a rolar procurando um nome que a pessoa já sabe de cor —
      digitar três letras é mais rápido que qualquer lista ordenada.

   2. SÓ QUEM TEM INSTAGRAM CADASTRADO. Peça sem perfil de destino é
      peça que ninguém sabe onde publicar: o compositor não consegue
      sugerir rede, nem avisar limite de legenda, nem registrar onde
      saiu. Melhor a conta não aparecer do que aparecer e produzir uma
      peça órfã.

      A conta escolhida ANTES do cadastro continua visível, mesmo sem
      perfil — some com ela faria uma peça já salva perder o cliente ao
      ser reaberta para edição.
   ===================================================================== */

export function ClientPicker({
  clients,
  accounts,
  value,
  onChange,
}: {
  clients: Client[];
  accounts: SocialAccount[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const comInstagram = useMemo(() => {
    const ids = new Set(
      accounts
        .filter((a) => a.network === "instagram" && a.is_active)
        .map((a) => a.client_id),
    );
    return clients.filter((c) => ids.has(c.id) || c.id === value);
  }, [clients, accounts, value]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return comInstagram;

    /* Sem acento dos dois lados: quem digita "casarao" precisa achar
       "Casarão", e ninguém troca o teclado no meio da busca. */
    const limpar = (t: string) =>
      t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    const alvo = limpar(termo);
    return comInstagram.filter((c) => limpar(c.name).includes(alvo));
  }, [comInstagram, busca]);

  const escolhido = clients.find((c) => c.id === value);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-hairline",
          "bg-transparent px-3 text-sm outline-none transition-colors hover:border-muted-foreground/40",
          aberto && "border-signal",
        )}
      >
        <span className={cn("truncate", !escolhido && "text-muted-foreground")}>
          {escolhido?.name ?? "Escolher"}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className="w-[min(22rem,90vw)] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {visiveis.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {comInstagram.length === 0 ? (
                <>
                  Nenhum cliente tem Instagram cadastrado.
                  <br />
                  <span className="text-2xs">
                    Cadastre em <strong>Perfis</strong>, na barra acima.
                  </span>
                </>
              ) : (
                "Nenhum cliente com esse nome."
              )}
            </p>
          ) : (
            visiveis.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id);
                  setBusca("");
                  setAberto(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  c.id === value ? "bg-accent" : "hover:bg-surface-2",
                )}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    c.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: c.brand_primary ?? "#94A3B8" }}
                />
                <span className="truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>

        {comInstagram.length > 0 && (
          <p className="border-t border-hairline px-3 py-1.5 text-[10px] text-muted-foreground">
            {comInstagram.length} com Instagram cadastrado. Falta algum?
            Cadastre em Perfis.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
