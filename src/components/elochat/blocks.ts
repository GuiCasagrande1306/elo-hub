import {
  Clock,
  GalleryHorizontalEnd,
  MessageCircle,
  MessageSquareText,
  Megaphone,
  Camera,
  Shuffle,
  Split,
  SquareMousePointer,
} from "lucide-react";

/* =====================================================================
   Catálogo de blocos do EloChat — Instagram Direct
   ---------------------------------------------------------------------
   Separado do construtor porque é DADO, não interface: a paleta da
   esquerda, o rótulo do nó no canvas, a prévia do celular e o editor da
   direita leem daqui.

   OS BLOCOS SÃO OS DA API DE MENSAGENS DO INSTAGRAM, e não uma lista
   genérica de chatbot. Isso importa porque a plataforma recusa na hora
   da publicação o que não existe nela — um fluxo desenhado com peças
   que a Meta não implementa só falha depois de pronto.

   Dois limites reais estão codificados abaixo, e os dois costumam ser
   confundidos:

     BOTÕES do template: no MÁXIMO 3, colados na mensagem, ficam no
     histórico da conversa. É o "clique no botão abaixo".

     QUICK REPLIES: até 13, aparecem como pastilhas acima do teclado e
     SOMEM depois do toque. Não é o mesmo recurso.

   Este catálogo implementa o primeiro — que é o que o fluxo de cupom
   descrito precisa —, com o teto de 3 aplicado no editor.
   ===================================================================== */

export type BlockKind = "trigger" | "action" | "logic";

export interface BlockType {
  id: string;
  kind: BlockKind;
  label: string;
  /** Uma linha na paleta: o que o bloco faz, não como se chama. */
  hint: string;
  icon: typeof MessageCircle;
}

export const BLOCK_TYPES: BlockType[] = [
  /* --- Gatilhos: as quatro entradas do Instagram -------------------- */
  {
    id: "comment",
    kind: "trigger",
    /* Rótulo curto de propósito: a coluna da paleta tem 224px e
       "Comentou em post ou Reel" truncava no meio da palavra. */
    label: "Comentou em post/Reel",
    hint: "Palavra num comentário público",
    icon: MessageCircle,
  },
  {
    id: "story-reply",
    kind: "trigger",
    label: "Respondeu a um story",
    hint: "Resposta ou reação ao story",
    icon: Camera,
  },
  {
    id: "keyword",
    kind: "trigger",
    label: "Palavra-chave no direct",
    hint: "Mensagem direta com um termo",
    icon: MessageSquareText,
  },
  {
    id: "ad-click",
    kind: "trigger",
    label: "Clicou no anúncio",
    hint: "Campanha click-to-direct",
    icon: Megaphone,
  },

  /* --- Ações: o que o robô manda ------------------------------------ */
  {
    id: "message",
    kind: "action",
    label: "Mensagem de texto",
    hint: "Só texto, sem botão",
    icon: MessageSquareText,
  },
  {
    id: "buttons",
    kind: "action",
    label: "Mensagem com botões",
    hint: "Texto e até 3 botões",
    icon: SquareMousePointer,
  },
  {
    id: "carousel",
    kind: "action",
    label: "Carrossel",
    hint: "Cartões com imagem e link",
    icon: GalleryHorizontalEnd,
  },
  {
    id: "delay",
    kind: "action",
    label: "Atraso",
    hint: "Espera antes do próximo passo",
    icon: Clock,
  },

  /* --- Lógica -------------------------------------------------------
     Não são recursos do Instagram e continuam aqui de propósito: são
     o que torna isto um fluxo e não uma sequência. Ramificar por
     resposta e testar duas versões de copy são as duas coisas que
     qualquer automação de direct acaba precisando na segunda semana. */
  {
    id: "condition",
    kind: "logic",
    label: "Condição",
    hint: "Segue por um caminho ou outro",
    icon: Split,
  },
  {
    id: "split",
    kind: "logic",
    label: "Divisão A/B",
    hint: "Sorteia entre duas versões",
    icon: Shuffle,
  },
];

export const BLOCK_BY_ID = new Map(BLOCK_TYPES.map((b) => [b.id, b]));

export const KIND_LABELS: Record<BlockKind, string> = {
  trigger: "Gatilhos do Instagram",
  action: "Mensagens",
  logic: "Lógica",
};

/** Blocos que mandam algo para o contato — os que têm prévia. */
export const BLOCOS_COM_TEXTO = new Set(["message", "buttons", "carousel"]);

/** Só estes aceitam botão. Ver o comentário do topo sobre o teto de 3. */
export const BLOCOS_COM_BOTOES = new Set(["buttons"]);

export const MAX_BOTOES = 3;

/**
 * Cores por família, em tokens do tema — não em hex.
 *
 * Escrevê-las como `#22c55e` quebraria no tema claro, que esta tela
 * também precisa atender.
 */
export const KIND_STYLES: Record<
  BlockKind,
  { chip: string; ring: string; dot: string; text: string }
> = {
  trigger: {
    chip: "bg-positive-muted text-positive",
    ring: "ring-positive/45",
    dot: "bg-positive",
    text: "text-positive",
  },
  action: {
    chip: "bg-signal-muted text-signal",
    ring: "ring-signal/45",
    dot: "bg-signal",
    text: "text-signal",
  },
  logic: {
    chip: "bg-warning-muted text-warning",
    ring: "ring-warning/45",
    dot: "bg-warning",
    text: "text-warning",
  },
};

/* ------------------------------------------------------------------ */
/* O que cada nó carrega                                               */
/* ------------------------------------------------------------------ */

export interface BotaoDoNo {
  id: string;
  label: string;
}

export interface CartaoDoNo {
  id: string;
  titulo: string;
  subtitulo: string;
  /** Rótulo do botão do cartão. O Instagram exige um por cartão. */
  botao: string;
}

export interface DadosDoNo extends Record<string, unknown> {
  blockId: string;
  /** Título editável — o nome que a pessoa dá ao passo. */
  titulo: string;
  /** Corpo da mensagem, quando o bloco tem texto. */
  texto: string;
  /** Botões colados na mensagem. Cada um vira uma saída do nó. */
  botoes: BotaoDoNo[];
  /** Cartões do carrossel. Cada um vira uma saída do nó. */
  cartoes: CartaoDoNo[];
}

export const MAX_CARTOES = 10;

/** Estado inicial de um bloco recém-inserido. */
export function dadosPadrao(bloco: BlockType): DadosDoNo {
  return {
    blockId: bloco.id,
    titulo: bloco.label,
    texto: "",
    botoes:
      bloco.id === "buttons" ? [{ id: `b-${Date.now()}`, label: "Botão" }] : [],
    cartoes:
      bloco.id === "carousel"
        ? [
            {
              id: `c-${Date.now()}`,
              titulo: "Produto",
              subtitulo: "",
              botao: "Ver",
            },
          ]
        : [],
  };
}
