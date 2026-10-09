"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/* =====================================================================
   Gaveta — seção que se abre
   ---------------------------------------------------------------------
   POR QUE EXISTE. A página de relatórios terminou com três seções
   longas no fim — agenda de envio, fila e histórico —, e cada uma
   ganhou o mesmo cabeçalho recolhível em momentos diferentes. Três
   cópias do mesmo comportamento divergem no primeiro ajuste que só uma
   receber: a primeira já tinha padding diferente das outras duas antes
   deste arquivo existir.

   O CABEÇALHO FECHADO É A LINHA DE RESUMO. Com a gaveta fechada, tudo
   que a pessoa sabe daquela seção é o que está nesta barra — por isso
   `selo` e `contador` existem. Esconder a contagem junto com o conteúdo
   transformaria "60 pendentes" em nada, e foi esse aviso que justificou
   a agenda ficar aberta no topo durante dois meses.

   DOIS TAMANHOS. `secao` é a gaveta de fim de página — cartão
   próprio, título grande. `compacta` é a gaveta DENTRO de outra coisa,
   hoje o diálogo do cliente: ali o conteúdo em volta é `text-xs`, e um
   título `text-lg` com cartão próprio leria como se o diálogo tivesse
   dois níveis de página.

   ⚠️ NADA DE CONTROLE INTERATIVO NO CABEÇALHO. Ele é um `<button>`
   inteiro: um seletor aninhado ali seria HTML inválido e abriria a
   gaveta a cada clique. Filtro e afins vão DENTRO, onde só aparecem
   com ela aberta — que é quando servem para alguma coisa.

   ⚠️ O CONTEÚDO NÃO É MONTADO ENQUANTO FECHADA. É `{aberta && ...}` e
   não `hidden`: a agenda renderiza um seletor de grupo do WhatsApp por
   linha, e são 61 linhas. Mantê-las no DOM só para escondê-las com CSS
   põe o custo de volta na página que esta gaveta existe para aliviar.
   ===================================================================== */

export function Gaveta({
  titulo,
  descricao,
  selo,
  contador,
  abertaDeInicio = false,
  compacta = false,
  children,
}: {
  titulo: string;
  /** Uma linha sob o título. Fica na barra, visível com a gaveta fechada. */
  descricao?: ReactNode;
  /** Selo de atenção, à direita do título. Ex.: "60 pendentes". */
  selo?: ReactNode;
  /** Contagem discreta na ponta direita. Ex.: "1 de 61". */
  contador?: ReactNode;
  /**
   * Nasce aberta.
   *
   * O padrão é FECHADA. Quem abre de início tem de ter motivo escrito
   * no ponto de uso — a fila de envio abre porque é trabalho de hoje,
   * e trabalho escondido é trabalho que não acontece.
   */
  abertaDeInicio?: boolean;
  /** Dentro de um diálogo ou card: tipografia e espaçamento menores. */
  compacta?: boolean;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(abertaDeInicio);

  return (
    <section className={compacta ? "mt-3 border-t border-hairline pt-3" : "mt-8"}>
      {/* A BARRA É O PUXADOR. Fechada, ela precisa parecer algo que se
          abre — um título solto lê como seção vazia, e ninguém clica. */}
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className={cn(
          "flex w-full items-center gap-2 text-left transition-colors",
          compacta
            ? "-mx-1 rounded-md px-1 py-0.5 hover:bg-surface-2/60"
            : "surface-card p-4 hover:bg-surface-2/60",
        )}
      >
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              "flex items-center gap-2 font-semibold",
              compacta ? "text-xs" : "text-lg tracking-[-0.015em]",
            )}
          >
            {titulo}
            {selo}
          </h2>
          {descricao && (
            <p
              className={cn(
                "mt-0.5 text-muted-foreground",
                compacta ? "text-2xs" : "text-sm",
              )}
            >
              {descricao}
            </p>
          )}
        </div>

        {contador}

        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            compacta ? "size-3.5" : "size-4",
            aberta && "rotate-180",
          )}
        />
      </button>

      {aberta && children}
    </section>
  );
}
