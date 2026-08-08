"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, CornerDownLeft, Loader2, Search } from "lucide-react";

import { buscarTarefas, type TarefaEncontrada } from "@/app/(app)/actions";
import { ClientAvatar } from "@/components/clients/client-avatar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navGroups } from "./nav-config";
import { ranquear } from "@/lib/search/match";
import { cn } from "@/lib/utils";
import type { Client, Profile } from "@/types/database";

/* =====================================================================
   Paleta de comandos (⌘K)
   ---------------------------------------------------------------------
   DUAS FONTES COM VELOCIDADES DIFERENTES, e a diferença é deliberada.

   Cliente é local e INSTANTÂNEO: a carteira já veio do servidor para a
   sidebar, filtrada pelo RLS. Filtrar em memória responde na tecla, sem
   rede — e responde igual com o wi-fi caindo, que é quando alguém está
   com o celular no carro procurando o número do cliente.

   Tarefa vem do banco, com espera de 300 ms: são milhares e não cabem no
   shell.

   `shouldFilter={false}` PORQUE METADE DOS RESULTADOS JÁ VEIO FILTRADA.
   O filtro embutido do cmdk reordenaria e descartaria as tarefas com o
   próprio algoritmo dele, por cima do `ilike` que o Postgres já fez —
   uma tarefa legitimamente encontrada sumiria da lista sem explicação.
   Com ele desligado, `ranquear` é o único critério, igual para os dois
   lados.
   ===================================================================== */

/** Nome do cliente é curto; a lista aberta cabe sem virar rolagem. */
const CLIENTES_VISIVEIS = 6;

const ESPERA_MS = 300;

export function GlobalSearch({
  clients,
  role,
}: {
  clients: Client[];
  role: Profile["role"];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");

  /* O resultado carrega o TERMO QUE O ORIGINOU, não só as linhas. É o
     que permite derivar tudo o mais sem um segundo estado: a lista só
     vale se ainda corresponde ao que está digitado, e "procurando" é
     exatamente a diferença entre os dois. Guardar `tarefas` e
     `buscando` separados exigiria limpá-los a cada tecla — e limpar
     estado dentro de um efeito é o que gera renderização em cascata. */
  const [resultado, setResultado] = useState<{
    termo: string;
    itens: TarefaEncontrada[];
  }>({ termo: "", itens: [] });

  /* ---- Atalho de teclado ---------------------------------------- */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      /* `metaKey` no Mac, `ctrlKey` no resto. Não checo a plataforma:
         teclado externo e máquina virtual embaralham isso, e aceitar os
         dois não custa nada. */
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAberto((atual) => !atual);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ---- Busca de tarefas, com espera ------------------------------ */

  const busca = termo.trim();
  /* Uma letra traz meia tabela e nenhuma informação. Duas é o piso em
     que o `ilike` começa a selecionar. */
  const buscavel = busca.length >= 2;

  useEffect(() => {
    if (!buscavel) return;

    /* `cancelado` resolve a resposta fora de ordem: digitar "parma"
       dispara "par" e depois "parma", e se a primeira demorar mais ela
       chega DEPOIS e sobrescreveria a lista certa com a antiga. A
       limpeza roda a cada mudança de termo, então a requisição
       superada nunca escreve — e não fica pendurada como "procurando",
       que é o defeito de descartar só pelo contador. */
    let cancelado = false;

    const timer = setTimeout(async () => {
      const itens = await buscarTarefas(busca);
      if (!cancelado) setResultado({ termo: busca, itens });
    }, ESPERA_MS);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca, buscavel]);

  /* ---- Resultados ------------------------------------------------ */

  const tarefas = resultado.termo === busca ? resultado.itens : [];
  const buscando = buscavel && resultado.termo !== busca;

  const clientesEncontrados = useMemo(
    () => ranquear(clients, termo, (c) => c.name).slice(0, CLIENTES_VISIVEIS),
    [clients, termo],
  );

  const links = useMemo(() => {
    const todos = navGroups.flatMap((g) => g.items);
    const visiveis = todos.filter((i) => !i.adminOnly || role === "admin");
    return ranquear(visiveis, termo, (i) => i.label);
  }, [role, termo]);

  const ir = useCallback(
    (href: string) => {
      setAberto(false);
      setTermo("");
      router.push(href);
    },
    [router],
  );

  const vazio =
    clientesEncontrados.length === 0 &&
    tarefas.length === 0 &&
    links.length === 0;

  return (
    <>
      <Gatilho onClick={() => setAberto(true)} />

      <CommandDialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          /* Limpa ao fechar: reabrir com a busca anterior mostraria
             resultados de outra intenção, e o primeiro Enter navegaria
             para eles. */
          if (!v) setTermo("");
        }}
        title="Busca global"
        description="Procure clientes, tarefas e páginas do sistema."
        className="sm:max-w-[min(94vw,560px)]"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            /* Sem isto o foco fica no popup e as primeiras letras se
               perdem: aperta ⌘K, digita "atlas", nada acontece. Um
               atalho de teclado que exige um clique depois não é atalho. */
            autoFocus
            placeholder="Buscar cliente, tarefa ou página…"
            value={termo}
            onValueChange={setTermo}
          />

          <CommandList className="max-h-[min(60vh,420px)]">
            {vazio && !buscando && (
              <CommandEmpty>Nada encontrado para “{termo}”.</CommandEmpty>
            )}

            {clientesEncontrados.length > 0 && (
              <CommandGroup heading="Clientes">
                {clientesEncontrados.map((cliente) => (
                  <CommandItem
                    key={cliente.id}
                    /* A rota é por SLUG, não por id. */
                    value={`cliente:${cliente.id}`}
                    onSelect={() => ir(`/clientes/${cliente.slug}`)}
                  >
                    <ClientAvatar
                      name={cliente.name}
                      logoUrl={cliente.logo_url}
                      brandPrimary={cliente.brand_primary}
                    />
                    <span className="truncate">{cliente.name}</span>
                    {cliente.status !== "active" && (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {cliente.status === "paused" ? "pausado" : "encerrado"}
                      </span>
                    )}
                    <Enter />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(tarefas.length > 0 || buscando) && (
              <CommandGroup heading="Tarefas">
                {buscando && tarefas.length === 0 && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Procurando…
                  </div>
                )}

                {tarefas.map((tarefa) => (
                  <CommandItem
                    key={tarefa.id}
                    value={`tarefa:${tarefa.id}`}
                    /* `?tarefa=<id>` é o parâmetro que o quadro já lê
                       para abrir o cartão — não `?id=`. */
                    onSelect={() => ir(`/tarefas?tarefa=${tarefa.id}`)}
                  >
                    <CheckSquare className="text-muted-foreground" />
                    <span className="truncate">{tarefa.title}</span>
                    {tarefa.clientName && (
                      <span className="shrink-0 truncate text-2xs text-muted-foreground">
                        {tarefa.clientName}
                      </span>
                    )}
                    <Enter />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {links.length > 0 && (
              <CommandGroup heading="Navegação">
                {links.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`nav:${item.href}`}
                    onSelect={() => ir(item.href)}
                  >
                    <item.icon className="text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                    <Enter />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Só aparece na linha selecionada — dica sem virar ruído nas outras. */
function Enter() {
  return (
    <CornerDownLeft className="ml-auto size-3 shrink-0 opacity-0 group-data-selected/command-item:opacity-40" />
  );
}

/* ------------------------------------------------------------------ */

/**
 * O campo do header é um BOTÃO, não um input.
 *
 * Um `<input>` de verdade aqui pediria um segundo estado de busca — o do
 * header e o do diálogo — e as duas caixas apareceriam ao mesmo tempo na
 * transição, cada uma com um texto. O botão só abre a paleta.
 */
function Gatilho({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-9 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm text-muted-foreground transition-colors sm:max-w-xs",
        "bg-surface-2/60 ring-1 ring-hairline hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.9} />
      <span className="truncate">Buscar cliente, tarefa…</span>
      <kbd className="ml-auto hidden shrink-0 rounded border border-hairline bg-background px-1.5 font-mono text-[10px] leading-4 text-muted-foreground sm:inline-block">
        ⌘K
      </kbd>
    </button>
  );
}
