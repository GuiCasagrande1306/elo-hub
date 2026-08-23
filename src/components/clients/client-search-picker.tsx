"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* =====================================================================
   Escolher um cliente entre muitos
   ---------------------------------------------------------------------
   A CARTEIRA PASSA DE SESSENTA CONTAS. Um `<select>` de sessenta linhas
   obriga a rolar procurando um nome que a pessoa já sabe de cor —
   digitar três letras é mais rápido que qualquer lista ordenada.

   Vive aqui, e não dentro de uma tela, porque já era o terceiro lugar
   a precisar exatamente disto: o compositor de peça, o funil e o
   convite de acesso. O de Mídias sociais continua separado — aquele
   filtra por perfil de Instagram cadastrado, que é regra daquela tela.
   ===================================================================== */

export interface ClienteEscolhivel {
  id: string;
  name: string;
  brand_primary: string | null;
}

/**
 * Sem acento dos dois lados: quem digita "casarao" precisa achar
 * "Casarão", e ninguém troca o teclado no meio da busca.
 */
function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function ClientSearchPicker({
  clients,
  value,
  onChange,
  placeholder = "Escolher cliente",
  className,
}: {
  clients: ClienteEscolhivel[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const termo = busca.trim();
    if (!termo) return clients;

    const alvo = semAcento(termo);
    return clients.filter((c) => semAcento(c.name).includes(alvo));
  }, [clients, busca]);

  const escolhido = clients.find((c) => c.id === value) ?? null;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        className={cn(
          "flex h-9 min-w-56 items-center justify-between gap-2 rounded-lg border border-hairline",
          "bg-transparent px-3 text-sm outline-none transition-colors hover:border-muted-foreground/40",
          aberto && "border-signal",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {escolhido && (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: escolhido.brand_primary ?? "#94A3B8" }}
            />
          )}
          <span className={cn("truncate", !escolhido && "text-muted-foreground")}>
            {escolhido?.name ?? placeholder}
          </span>
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
              Nenhum cliente com esse nome.
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
      </PopoverContent>
    </Popover>
  );
}
