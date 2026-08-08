"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

import { BLOCK_BY_ID, KIND_STYLES, type DadosDoNo } from "./blocks";
import { cn } from "@/lib/utils";

/* =====================================================================
   Nós do canvas
   ---------------------------------------------------------------------
   UM COMPONENTE PARA AS TRÊS FAMÍLIAS, e a diferença mora nas alças, não
   no desenho: gatilho não tem entrada (nada vem antes dele), e um nó com
   botões tem uma saída POR BOTÃO em vez de uma saída embaixo.

   Essa última é a parte que importa e a que costuma ser feita errada em
   maquete: se os botões forem enfeite dentro do card, o fluxo não tem
   como se ramificar e a ferramenta vira um desenho. Cada botão carrega
   um `Handle` com id próprio, então "Quero comprar" e "Falar com
   atendente" podem ir para lugares diferentes — que é a razão de existir
   um construtor visual.
   ===================================================================== */

export type NoDoFluxo = Node<DadosDoNo, "elo">;

export function EloNode({ data, selected }: NodeProps<NoDoFluxo>) {
  const bloco = BLOCK_BY_ID.get(data.blockId);
  const kind = bloco?.kind ?? "action";
  const estilo = KIND_STYLES[kind];
  const Icon = bloco?.icon;

  const temBotoes = data.botoes.length > 0;
  const temCartoes = data.cartoes.length > 0;
  /* Cartão do carrossel também é uma saída — o Instagram deixa cada um
     ter o próprio botão, e o fluxo pode seguir por qualquer deles. */
  const saidas = temBotoes || temCartoes;

  return (
    <div
      className={cn(
        "w-[248px] overflow-hidden rounded-xl bg-card text-left shadow-lg ring-1 transition-shadow",
        selected ? cn("ring-2", estilo.ring) : "ring-hairline",
      )}
    >
      {/* Entrada: todo nó tem, menos o gatilho — nada vem antes dele. */}
      {kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Top}
          className="!size-2 !border-2 !border-background !bg-muted-foreground"
        />
      )}

      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            estilo.chip,
          )}
        >
          {Icon && <Icon className="size-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight">
            {data.titulo}
          </p>
          <p className={cn("text-[10px] leading-tight", estilo.text)}>
            {bloco?.label}
          </p>
        </div>
      </div>

      {data.texto && (
        <p className="line-clamp-3 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {data.texto}
        </p>
      )}

      {temBotoes && (
        <div className="flex flex-col gap-1 border-t border-hairline p-2">
          {data.botoes.map((botao) => (
            <div
              key={botao.id}
              className="relative rounded-md bg-surface-2 px-2 py-1.5 text-center text-[11px] font-medium"
            >
              {botao.label}
              {/* Uma saída POR BOTÃO — é o que permite os dois caminhos
                  irem para nós diferentes. */}
              <Handle
                type="source"
                id={botao.id}
                position={Position.Right}
                className="!right-[-11px] !size-2 !border-2 !border-background !bg-signal"
              />
            </div>
          ))}
        </div>
      )}

      {temCartoes && (
        <div className="flex flex-col gap-1 border-t border-hairline p-2">
          {data.cartoes.map((cartao) => (
            <div
              key={cartao.id}
              className="relative flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"
            >
              <span className="size-6 shrink-0 rounded bg-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">
                  {cartao.titulo || "Sem título"}
                </span>
                <span className="block truncate text-[10px] text-signal">
                  {cartao.botao || "Ver"}
                </span>
              </span>
              <Handle
                type="source"
                id={cartao.id}
                position={Position.Right}
                className="!right-[-11px] !size-2 !border-2 !border-background !bg-signal"
              />
            </div>
          ))}
        </div>
      )}

      {/* Sem saída nomeada, a saída é única e sai por baixo. */}
      {!saidas && (
        <Handle
          type="source"
          position={Position.Bottom}
          className={cn(
            "!size-2 !border-2 !border-background",
            kind === "trigger" ? "!bg-positive" : "!bg-signal",
          )}
        />
      )}
    </div>
  );
}

export const NODE_TYPES = { elo: EloNode };
