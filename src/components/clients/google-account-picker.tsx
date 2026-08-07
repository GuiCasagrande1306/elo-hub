"use client";

import { useCallback, useState } from "react";
import { Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* =====================================================================
   Conta do Google Ads
   ---------------------------------------------------------------------
   Irmão do `MetaAccountPicker`, e separado dele de propósito: os dois
   normalizam identificadores diferentes (`act_<n>` contra
   `123-456-7890`) e falam com rotas diferentes. Um componente só com
   `platform` como prop viraria uma sequência de ifs em cada função —
   mais frágil que duas versões curtas.

   A DIGITAÇÃO MANUAL CONTINUA, pelo mesmo motivo de sempre: a listagem
   depende do developer token, do login-customer-id e de a API responder.
   Três coisas que falham por conta própria, e nenhuma delas pode
   bloquear o vínculo de uma conta cujo id a pessoa já tem na mão.
   ===================================================================== */

interface Conta {
  id: string;
  name: string;
  currency: string | null;
  isTest: boolean;
  isManager: boolean;
}

/** Aceita "4618704113" ou "461-870-4113"; grava sempre com hífen. */
function normalizar(valor: string): string | null {
  const d = valor.replace(/\D/g, "");
  if (d.length !== 10) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function GoogleAccountPicker({
  clientId,
  value,
  onChange,
  disabled,
}: {
  clientId: string;
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscou, setBuscou] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const r = await fetch(
        `/api/google/ad-accounts?clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store" },
      );
      const d = await r.json();

      if (d.ok) {
        setContas(d.accounts ?? []);
        if ((d.accounts ?? []).length === 0) {
          setErro("Nenhuma conta alcançável por este login.");
        } else if (d.warning) {
          /* Lista veio, nomes não. Mostrar o motivo em vez de deixar a
             pessoa olhando uma coluna de números sem explicação. */
          setErro(d.warning);
        }
      } else {
        setErro(d.error ?? "Não foi possível listar as contas.");
      }
    } catch {
      setErro("Falha de rede ao buscar as contas.");
    } finally {
      setCarregando(false);
      setBuscou(true);
    }
  }, [clientId]);

  /* Busca ao ABRIR, não ao montar: são duas chamadas à API do Google, e
     quem abre a tela de integrações raramente vai trocar a conta. */
  function aoAbrir(novo: boolean) {
    setAberto(novo);
    if (novo && !buscou) void carregar();
  }

  const selecionada = contas.find((c) => c.id === value);
  const rotulo = selecionada ? selecionada.name : value || "Selecionar conta";

  const digitado = normalizar(busca);
  const podeUsarDigitado =
    digitado !== null && !contas.some((c) => c.id === digitado);

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {rotulo}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Buscar nome ou colar o ID…"
            value={busca}
            onValueChange={setBusca}
          />

          <CommandList>
            {carregando && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Consultando o Google…
              </div>
            )}

            {!carregando && erro && (
              <div className="px-3 py-3">
                <p className="text-xs text-warning">{erro}</p>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Você pode colar o ID da conta (123-456-7890) no campo
                  acima.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2.5"
                  onClick={() => void carregar()}
                >
                  <RefreshCw className="size-3.5" />
                  Tentar de novo
                </Button>
              </div>
            )}

            {!carregando && !erro && (
              <CommandEmpty>Nenhuma conta com esse nome.</CommandEmpty>
            )}

            {podeUsarDigitado && (
              <CommandGroup heading="Usar o que foi digitado">
                <CommandItem
                  value={digitado}
                  onSelect={() => {
                    onChange(digitado);
                    setAberto(false);
                  }}
                >
                  <Check className="size-3.5 opacity-0" />
                  <span className="font-mono text-xs">{digitado}</span>
                </CommandItem>
              </CommandGroup>
            )}

            {contas.length > 0 && (
              <CommandGroup heading="Contas">
                {contas.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.name} ${c.id}`}
                    onSelect={() => {
                      onChange(c.id);
                      setAberto(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        c.id === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>

                    {/* MCC e teste marcados: são alcançáveis e quase
                        nunca são o que se quer vincular. Vincular a MCC
                        por engano devolve dado agregado da carteira
                        inteira no relatório de um cliente só. */}
                    {c.isManager && (
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        MCC
                      </span>
                    )}
                    {c.isTest && (
                      <span className="shrink-0 rounded bg-warning-muted px-1 text-[10px] text-warning">
                        teste
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {c.id}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
