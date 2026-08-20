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

  /* `atualizar` VARRE O WHATSAPP DE NOVO e regrava a tabela.
     ---------------------------------------------------------------
     Sem ele, grupo criado depois da última sincronização não aparecia
     NUNCA: a rota devolve a tabela sempre que ela tem linhas, e a
     tabela era preenchida por um script rodado fora da Vercel. Medido
     em 19/08/2026 — 512 grupos salvos, todos de 06 de agosto, e três
     clientes sem destino cujo grupo existia e era invisível. */
  const carregar = useCallback(async (atualizar = false) => {
    setCarregando(true);
    setErro(null);

    try {
      const r = await fetch(
        `/api/whatsapp/groups${atualizar ? "?atualizar=1" : ""}`,
        { cache: "no-store" },
      );
      const d = await r.json();

      /* A lista salva volta junto quando a varredura falha, então
         preencher antes de olhar o `ok` evita esvaziar o seletor de
         quem só queria conferir se apareceu grupo novo. */
      if (Array.isArray(d.groups)) setGrupos(d.groups);

      if (d.ok) {
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
              <CommandEmpty>
                <p>Nenhum grupo com esse nome.</p>
                {/* A SAÍDA PARA GRUPO NOVO fica aqui, que é onde a
                    pessoa está quando descobre que ele não existe na
                    lista — procurando pelo nome e não achando. */}
                <button
                  type="button"
                  onClick={() => void carregar(true)}
                  className="mt-2 inline-flex items-center gap-1.5 text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <RefreshCw className="size-3" />
                  Buscar grupos novos no WhatsApp
                </button>
              </CommandEmpty>
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

            {grupos.length > 0 && !carregando && (
              <div className="border-t border-hairline px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => void carregar(true)}
                  className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RefreshCw className="size-3" />
                  Atualizar lista — grupo criado hoje só aparece aqui
                </button>
                {/* O AVISO DE QUE PODE NÃO DAR CERTO É HONESTO, não
                    pessimismo. A varredura foi medida em 8,8s numa hora
                    boa e 106,5s numa hora em que a Meta estava
                    limitando — e o teto da função é 60s. Quando estoura,
                    a lista salva continua na tela e o erro explica; sem
                    este texto, a pessoa clicaria de novo achando que
                    errou o clique. */}
                <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                  Leva alguns segundos. Se o WhatsApp estiver limitando,
                  pode falhar — tente de novo em alguns minutos.
                </p>
              </div>
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
