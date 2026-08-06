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
import { isGroupJid } from "@/lib/whatsapp/jid";

/* =====================================================================
   Destino do relatório
   ---------------------------------------------------------------------
   Escolher o grupo pelo NOME e gravar o ID resolve o problema real: o
   JID (`120363...@g.us`) não aparece em lugar nenhum na interface do
   WhatsApp, então digitá-lo à mão significa ir caçá-lo por fora.

   ⚠️ A LISTA PODE NÃO VIR. `fetchAllGroups` da Evolution pede metadados
   grupo a grupo à Meta, que responde `rate-overlimit`; medimos 107s numa
   chamada bem-sucedida e vários estouros de 90s. Não cabe no limite de
   60s da função. Por isso a digitação manual continua disponível e não
   é um caminho secundário escondido — hoje é o caminho confiável.
   ===================================================================== */

interface Grupo {
  id: string;
  name: string;
}

export function WhatsAppDestinationPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscou, setBuscou] = useState(false);

  /* Sem parâmetro de "forçar": o servidor memoiza a lista por 10
     minutos e NÃO memoiza falha, então este mesmo `carregar` serve para
     a primeira abertura e para o "Tentar de novo" — depois de um erro
     não há entrada em cache para atrapalhar. */
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const r = await fetch("/api/whatsapp/groups", { cache: "no-store" });
      const d = await r.json();

      if (d.ok) {
        setGrupos(d.groups ?? []);
        if ((d.groups ?? []).length === 0) {
          setErro("Nenhum grupo encontrado neste WhatsApp.");
        }
      } else {
        setErro(d.error ?? "Não foi possível listar os grupos.");
      }
    } catch {
      setErro("Falha de rede ao buscar os grupos.");
    } finally {
      setCarregando(false);
      setBuscou(true);
    }
  }, []);

  /* Busca ao ABRIR, não ao montar: uma varredura da Meta a cada
     abertura do formulário seria cobrada mesmo de quem não vai tocar no
     destino. E fica no handler, não num efeito — é reação a um evento
     do usuário, não sincronização com sistema externo. */
  function aoAbrir(novo: boolean) {
    setAberto(novo);
    if (novo && !buscou) void carregar();
  }

  const selecionado = grupos.find((g) => g.id === value);

  const rotulo = selecionado
    ? selecionado.name
    : value
      ? isGroupJid(value)
        ? `Grupo ${value.split("@")[0].slice(-6)}`
        : value
      : "Selecionar destino";

  /* O que foi digitado vira uma opção quando parece um destino válido —
     é o que mantém o formulário utilizável enquanto a listagem falha. */
  const digitado = busca.trim();
  const podeUsarDigitado =
    digitado.length > 0 &&
    !grupos.some((g) => g.id === digitado) &&
    (isGroupJid(digitado) || /^\+?\d[\d\s()-]{7,}$/.test(digitado));

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
            placeholder="Buscar nome do grupo..."
            value={busca}
            onValueChange={setBusca}
          />

          <CommandList>
            {carregando && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Consultando o WhatsApp…
              </div>
            )}

            {!carregando && erro && (
              <div className="px-3 py-3">
                <p className="text-xs text-warning">{erro}</p>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Você pode colar o ID do grupo (terminado em @g.us) ou um
                  número no campo de busca acima.
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
              <CommandEmpty>Nenhum grupo com esse nome.</CommandEmpty>
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
                  <span className="truncate font-mono text-xs">{digitado}</span>
                </CommandItem>
              </CommandGroup>
            )}

            {grupos.length > 0 && (
              <CommandGroup heading="Grupos">
                {grupos.map((g) => (
                  <CommandItem
                    key={g.id}
                    value={`${g.name} ${g.id}`}
                    onSelect={() => {
                      onChange(g.id);
                      setAberto(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-3.5",
                        g.id === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{g.name}</span>
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
