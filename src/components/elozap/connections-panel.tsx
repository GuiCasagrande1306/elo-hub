"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, LayoutGrid } from "lucide-react";

import { ConnectionCard, type ConexaoDoCliente } from "./connection-card";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

/* =====================================================================
   Carteira de números — resumo, filtro e grade
   ---------------------------------------------------------------------
   O ESTADO DAS CONEXÕES MORA AQUI, não dentro de cada cartão.

   Enquanto cada cartão guardava o próprio estado, o filtro e o contador
   liam a foto do servidor e nunca mais mudavam: parear um número com
   "Aguardando conexão" selecionado deixava o cartão recém-conectado
   parado no balde errado, e o "0 de 54" continuava zero até alguém
   recarregar a página. Um filtro que não reage ao que acabou de
   acontecer na tela é pior que nenhum.

   O cartão continua dono do QR — aquilo é efêmero, é só dele, e não
   interessa a ninguém mais.
   ===================================================================== */

type Filtro = "todos" | "conectados" | "aguardando";

const FILTROS: {
  id: Filtro;
  rotulo: string;
  icone: typeof LayoutGrid;
}[] = [
  { id: "todos", rotulo: "Todas", icone: LayoutGrid },
  { id: "conectados", rotulo: "Conectadas", icone: CheckCircle2 },
  { id: "aguardando", rotulo: "Aguardando conexão", icone: CircleDashed },
];

export function ConnectionsPanel({
  clients,
  iniciais,
  bloqueio,
}: {
  clients: Pick<Client, "id" | "name" | "brand_primary">[];
  iniciais: ConexaoDoCliente[];
  /** Por que parear está indisponível, ou `null`. Ver `ConnectionCard`. */
  bloqueio: string | null;
}) {
  /**
   * O estado guardado é só o que MUDOU nesta sessão, não a carteira toda.
   *
   * Copiar `iniciais` para dentro de um `useState` congelava o mapa no
   * primeiro render: cliente novo chegando pelo servidor não entrava, e
   * o cartão lia `conexoes[id].state` de um `undefined` — TypeError na
   * renderização, tela em branco. Guardando só as alterações, o estado
   * do servidor continua fluindo para todo cartão que ninguém tocou, e
   * a linha abaixo garante que SEMPRE existe um valor para cada cliente.
   *
   * Sem `useEffect` de sincronia de propósito: o React Compiler rejeita
   * `setState` síncrono dentro de efeito, e derivar não precisa de um.
   */
  const [alteradas, setAlteradas] = useState<Record<string, ConexaoDoCliente>>(
    {},
  );
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const conexoes = useMemo(() => {
    const doServidor = new Map(iniciais.map((i) => [i.clientId, i]));

    return new Map<string, ConexaoDoCliente>(
      clients.map((c) => [
        c.id,
        alteradas[c.id] ??
          doServidor.get(c.id) ?? { clientId: c.id, state: "absent" as const },
      ]),
    );
  }, [clients, iniciais, alteradas]);

  /* Identidade estável: o cartão recebe esta função e ela não pode mudar
     a cada render, ou todo cartão da carteira re-renderiza quando um
     único número conecta. */
  const registrar = useCallback((conexao: ConexaoDoCliente) => {
    setAlteradas((atual) => ({ ...atual, [conexao.clientId]: conexao }));
  }, []);

  const conectados = useMemo(
    () => clients.filter((c) => conexoes.get(c.id)?.state === "open").length,
    [clients, conexoes],
  );

  const visiveis = useMemo(() => {
    if (filtro === "todos") return clients;

    return clients.filter((c) => {
      const aberto = conexoes.get(c.id)?.state === "open";
      return filtro === "conectados" ? aberto : !aberto;
    });
  }, [clients, conexoes, filtro]);

  /* Contagem por balde, para o filtro dizer o que vai encontrar ANTES do
     clique. Sem isso, "Conectadas" numa carteira sem nenhuma conexão é
     um botão que só leva a uma tela vazia. */
  const tamanhos: Record<Filtro, number> = {
    todos: clients.length,
    conectados: conectados,
    aguardando: clients.length - conectados,
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <strong className="font-medium text-foreground tabular-nums">
          {conectados} de {clients.length}
        </strong>{" "}
        {clients.length === 1 ? "conta com número" : "contas com número"}{" "}
        conectado.
      </p>

      {/* Botões com `aria-pressed`, e não `<Tabs>`: um `tablist` sem
          `tabpanel` correspondente é ARIA quebrada — o leitor de tela
          anuncia abas e procura painéis que não existem. Aqui é um
          filtro sobre UMA lista, que é o padrão já usado na esteira de
          mídias sociais. */}
      <div
        role="group"
        aria-label="Filtrar contas por estado da conexão"
        className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1"
      >
        {FILTROS.map(({ id, rotulo, icone: Icone }) => {
          const ativo = filtro === id;

          return (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              aria-pressed={ativo}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors",
                ativo
                  ? "bg-background text-foreground ring-1 ring-hairline"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* ÍCONE SOME NO CELULAR. Medido em 375px: os três chips
                  pedem 395px e sobram 343 — "Aguardando conexão" ficava
                  fora da tela, escondendo uma opção atrás de um arrasto
                  que ninguém adivinha. Sem os ícones caem para 335 e os
                  três aparecem. O rótulo sozinho já diz tudo; o ícone
                  era enfeite. */}
              <Icone className="hidden size-3.5 sm:block" />
              {rotulo}
              {/* SEM `opacity`. Medido no chip inativo: com `opacity-60` o
                  número caía para 2,97:1 no tema escuro contra os 5,53:1
                  do rótulo ao lado — menos da metade do contraste da
                  palavra que ele qualifica, e abaixo dos 4,5:1 que 12px
                  exige. Justamente o número, que é a informação nova do
                  chip. A hierarquia agora vem do peso da fonte, que não
                  custa legibilidade. */}
              <span className="font-normal tabular-nums">{tamanhos[id]}</span>
            </button>
          );
        })}
      </div>

      {visiveis.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          {filtro === "conectados"
            ? "Nenhuma conta com número conectado ainda."
            : "Todas as contas da carteira já têm número conectado."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((client) => (
            <ConnectionCard
              key={client.id}
              client={client}
              /* Nunca `undefined`: `conexoes` é derivado de `clients`,
                 então toda linha da grade tem uma entrada. */
              conexao={
                conexoes.get(client.id) ?? {
                  clientId: client.id,
                  state: "absent",
                }
              }
              onConexao={registrar}
              bloqueio={bloqueio}
            />
          ))}
        </div>
      )}
    </>
  );
}
