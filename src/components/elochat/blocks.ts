import {
  AtSign,
  Clock,
  Image,
  Link2,
  MessageSquare,
  MessageSquareText,
  Mic,
  Shuffle,
  Split,
} from "lucide-react";

/* =====================================================================
   Catálogo de blocos do EloChat
   ---------------------------------------------------------------------
   Separado do construtor porque é DADO, não interface: a paleta da
   esquerda, o rótulo do nó no canvas e o cabeçalho do editor da direita
   leem daqui. Enquanto cada um tinha a própria lista, renomear "Enviar
   mensagem" exigia lembrar de três arquivos.

   `kind` é o que decide a cor e a forma do nó — e a divisão em três
   famílias não é estética: gatilho só tem saída, ação tem entrada e
   saída, lógica tem entrada e VÁRIAS saídas. É a topologia do fluxo.
   ===================================================================== */

export type BlockKind = "trigger" | "action" | "logic";

export interface BlockType {
  id: string;
  kind: BlockKind;
  label: string;
  /** Uma linha na paleta: o que o bloco faz, não como se chama. */
  hint: string;
  icon: typeof MessageSquare;
}

export const BLOCK_TYPES: BlockType[] = [
  /* --- Gatilhos: começam o fluxo ------------------------------------ */
  {
    id: "keyword",
    kind: "trigger",
    label: "Palavra-chave",
    hint: "Alguém manda uma palavra no direct",
    icon: MessageSquare,
  },
  {
    id: "comment",
    kind: "trigger",
    label: "Comentário no post",
    hint: "Comentário novo numa publicação",
    icon: AtSign,
  },
  {
    id: "ref",
    kind: "trigger",
    label: "Link de referência",
    hint: "Clique num link rastreado",
    icon: Link2,
  },

  /* --- Ações: o que o robô faz -------------------------------------- */
  {
    id: "message",
    kind: "action",
    label: "Enviar mensagem",
    hint: "Texto, com botões opcionais",
    icon: MessageSquareText,
  },
  {
    id: "audio",
    kind: "action",
    label: "Áudio",
    hint: "Mensagem de voz gravada",
    icon: Mic,
  },
  {
    id: "media",
    kind: "action",
    label: "Imagem ou arquivo",
    hint: "Catálogo, cardápio, PDF",
    icon: Image,
  },
  {
    id: "delay",
    kind: "action",
    label: "Atraso",
    hint: "Espera antes do próximo passo",
    icon: Clock,
  },

  /* --- Lógica: onde o fluxo se divide -------------------------------- */
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
  trigger: "Gatilhos",
  action: "Ações",
  logic: "Lógica",
};

/**
 * Cores por família, em tokens do tema — não em hex.
 *
 * Verde para gatilho e azul para ação são as cores que o pedido descreve,
 * e por sorte são as que o sistema já usa para "aconteceu" e "informação".
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

export interface DadosDoNo extends Record<string, unknown> {
  blockId: string;
  /** Título editável — o nome que a pessoa dá ao passo. */
  titulo: string;
  /** Corpo da mensagem, quando o bloco tem texto. */
  texto: string;
  /** Botões de resposta rápida. Cada um vira uma saída do nó. */
  botoes: BotaoDoNo[];
}
