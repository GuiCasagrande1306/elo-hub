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
   Conta de anúncios do Meta
   ---------------------------------------------------------------------
   Escolher pelo NOME e gravar o `act_...` resolve o mesmo problema do
   picker de grupos do WhatsApp: o id não aparece em lugar nenhum onde a
   pessoa já esteja trabalhando, então digitá-lo significa abrir o
   Gerenciador de Anúncios noutra aba e copiar.

   A DIGITAÇÃO MANUAL CONTINUA. A listagem depende de um token válido e
   de a Graph API responder — duas coisas que falham por conta própria.
   Quando falha, o campo de busca aceita o `act_...` colado e vira uma
   opção selecionável, para o vínculo não ficar bloqueado por causa da
   listagem.
   ===================================================================== */

interface Conta {
  id: string;
  name: string;
  active: boolean;
  currency: string | null;
}

/** Formato exigido pela API de insights. */
const FORMATO_CONTA = /^act_\d{6,}$/;

export function MetaAccountPicker({
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
        `/api/meta/ad-accounts?clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store" },
      );
      /* `.json()` direto quebraria com "Unexpected token" se a Vercel
         devolvesse a página de erro em HTML — foi assim que o envio de
         relatório falhou de forma ilegível antes. */
      const texto = await r.text();
      let d: { ok?: boolean; accounts?: Conta[]; error?: string };
      try {
        d = JSON.parse(texto) as typeof d;
      } catch {
        setErro(`O servidor respondeu ${r.status} sem JSON.`);
        return;
      }

      if (d.ok) {
        setContas(d.accounts ?? []);
        if ((d.accounts ?? []).length === 0) {
          setErro("Nenhuma conta de anúncios neste acesso.");
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

  /* Busca ao ABRIR, não ao montar: a página do cliente carregaria uma
     chamada à Graph API mesmo para quem só veio ver o dashboard. E fica
     no handler, não num efeito — é reação a evento, não sincronização
     com sistema externo. */
  function aoAbrir(novo: boolean) {
    setAberto(novo);
    if (novo && !buscou) void carregar();
  }

  function escolher(id: string) {
    onChange(id);
    setAberto(false);
    setBusca("");
  }

  const selecionada = contas.find((c) => c.id === value);
  const rotulo = selecionada ? selecionada.name : value || "Selecionar conta";

  /* O que foi digitado vira opção quando tem cara de conta — é o que
     mantém o vínculo possível enquanto a listagem falha. */
  const digitado = busca.trim();
  const podeUsarDigitado =
    FORMATO_CONTA.test(digitado) && !contas.some((c) => c.id === digitado);

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
            placeholder="Buscar nome ou colar act_..."
            value={busca}
            onValueChange={setBusca}
          />

          <CommandList>
            {carregando && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Carregando contas…
              </div>
            )}

            {!carregando && erro && (
              <div className="px-3 py-3">
                <p className="text-xs text-warning">{erro}</p>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Você pode colar o ID da conta (act_123456789) no campo de
                  busca acima.
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

            {podeUsarDigitado && (
              <CommandGroup heading="Usar o que foi digitado">
                <CommandItem value={digitado} onSelect={() => escolher(digitado)}>
                  <span className="font-mono text-xs">{digitado}</span>
                </CommandItem>
              </CommandGroup>
            )}

            {!carregando && contas.length > 0 && (
              <CommandGroup heading="Contas disponíveis">
                {contas.map((c) => (
                  <CommandItem
                    /* Nome E id no `value`: o filtro do Command casa por
                       essa string, então colar um `act_...` também
                       encontra a conta na lista. */
                    key={c.id}
                    value={`${c.name} ${c.id}`}
                    onSelect={() => escolher(c.id)}
                  >
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        value === c.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{c.name}</span>
                      <span className="block truncate font-mono text-2xs text-muted-foreground">
                        {c.id}
                        {c.currency && c.currency !== "BRL"
                          ? ` · ${c.currency}`
                          : ""}
                      </span>
                    </span>
                    {!c.active && (
                      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        inativa
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!carregando && !erro && contas.length === 0 && !podeUsarDigitado && (
              <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
