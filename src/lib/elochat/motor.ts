import type { ArestaDoFluxo, NoDoFluxo } from "./validacao";

/* =====================================================================
   O motor: de um evento do Instagram até o que mandar
   ---------------------------------------------------------------------
   PURO DE PROPÓSITO. Não fala com banco, não chama a Meta, não sabe o
   que é `fetch`. Recebe o fluxo, o evento e onde o contato estava;
   devolve o que enviar e para onde ele foi. Todo o resto — buscar o
   token, gravar o estado, chamar `graph.instagram.com` — é do
   chamador.

   É assim porque este é o pedaço em que errar custa caro e testar é
   barato: cada regra abaixo vira asserção em
   `teste-motor-elochat.mts`, sem app da Meta, sem conta conectada e
   sem mandar mensagem para ninguém.

   ⚠️ UM PASSO POR EVENTO, e não a cascata inteira. O motor avança UM
   nó e para. Percorrer o fluxo até o fim de uma vez mandaria três ou
   quatro mensagens em sequência no mesmo segundo, que é precisamente o
   padrão que a Meta lê como automação — e que restringiu a conta do
   Geraldo duas vezes em setembro. Cada mensagem seguinte espera um
   novo evento (o toque no botão) ou o atraso configurado.
   ===================================================================== */

export type TipoDeEvento = "comentario" | "direct" | "resposta-story" | "clique-anuncio";

export interface EventoDoInstagram {
  tipo: TipoDeEvento;
  /** Quem interagiu — o IGSID, identificador do contato na conta. */
  contato: string;
  /** Texto do comentário ou da mensagem. Vazio nos eventos sem texto. */
  texto: string;
  /**
   * `payload` do botão tocado, quando o evento veio de um toque.
   * É o id do botão no nó, que também é o `sourceHandle` da aresta.
   */
  botao?: string | null;
}

export interface MensagemASair {
  noId: string;
  tipo: "texto" | "botoes" | "carrossel";
  texto: string;
  botoes: { id: string; label: string }[];
  cartoes: { id: string; titulo: string; subtitulo?: string; botao: string }[];
  /** Segundos a esperar antes de enviar, vindos de blocos de atraso. */
  esperarSegundos: number;
}

export type Decisao =
  | { acao: "nada"; motivo: string }
  | { acao: "enviar"; mensagem: MensagemASair; novoNoAtual: string };

/* ------------------------------------------------------------------ */
/* Casamento de palavra                                                */
/* ------------------------------------------------------------------ */

/**
 * Normaliza para comparar: sem acento, minúsculo, sem pontuação.
 *
 * ⚠️ NFD + remoção de diacríticos, e não uma tabela de trocas. "Não",
 * "nao" e "NÃO" precisam casar, e escrever a tabela à mão esquece o
 * "ç" na terceira vez.
 */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Negações que, imediatamente antes da palavra, cancelam o disparo.
 *
 * ⚠️ EXISTE PORQUE "NÃO QUERO" CONTÉM "QUERO". Sem esta lista, uma
 * recusa explícita recebe o cupom — o pior erro possível deste módulo,
 * porque é visível para o cliente final e parece desrespeito, não bug.
 *
 * Lista curta e conservadora de propósito: a regra só SUPRIME disparo,
 * nunca cria. O custo de errar é deixar de responder alguém que
 * escreveu "não" por perto; o custo de não ter a regra é responder
 * quem disse não. Os dois não têm o mesmo peso.
 */
const NEGACOES = new Set(["nao", "nem", "jamais", "nunca", "sem"]);

/**
 * O texto contém a palavra do gatilho?
 *
 * ⚠️ CASA PALAVRA INTEIRA, não pedaço. Com `includes` cru o gatilho
 * "quero" dispararia em "querosene".
 *
 * Palavra vazia nunca casa: um gatilho sem palavra configurada
 * responderia a todo mundo que comentasse qualquer coisa.
 */
export function casaPalavra(texto: string, palavra: string | undefined): boolean {
  const alvo = normalizar(palavra ?? "");
  if (!alvo) return false;

  const limpo = normalizar(texto);
  if (!limpo) return false;

  /* A palavra pode ter espaço ("quero o cupom"), então compara-se
     sequência de tokens, não um token só. */
  const tokens = limpo.split(" ");
  const alvos = alvo.split(" ");

  for (let i = 0; i + alvos.length <= tokens.length; i++) {
    if (!alvos.every((a, j) => tokens[i + j] === a)) continue;

    /* Negação COLADA antes cancela esta ocorrência — mas só ela: o
       texto segue sendo varrido, porque "não sei se quero, mas quero"
       tem uma ocorrência negada e uma válida. */
    if (i > 0 && NEGACOES.has(tokens[i - 1])) continue;

    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Achar o gatilho                                                     */
/* ------------------------------------------------------------------ */

const TIPO_DO_BLOCO: Record<string, TipoDeEvento> = {
  comment: "comentario",
  keyword: "direct",
  "story-reply": "resposta-story",
  "ad-click": "clique-anuncio",
};

const PRECISA_DE_PALAVRA = new Set(["comment", "keyword"]);

/**
 * O gatilho do fluxo que casa com este evento, ou `null`.
 *
 * O PRIMEIRO que casar, na ordem em que os nós estão. Mais de um
 * gatilho casando é desenho que o validador já avisa; aqui a escolha
 * precisa ser determinística, e "o primeiro" é a única regra que não
 * depende de ordenação de objeto.
 */
export function gatilhoQueCasa(
  nos: NoDoFluxo[],
  evento: EventoDoInstagram,
): NoDoFluxo | null {
  for (const no of nos) {
    const tipo = TIPO_DO_BLOCO[no.data.blockId];
    if (!tipo || tipo !== evento.tipo) continue;

    if (PRECISA_DE_PALAVRA.has(no.data.blockId)) {
      if (!casaPalavra(evento.texto, no.data.palavraChave)) continue;
    }

    return no;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* O passo                                                             */
/* ------------------------------------------------------------------ */

function saidaDe(
  arestas: ArestaDoFluxo[],
  noId: string,
  handle?: string | null,
): string | null {
  /* Com botão tocado, segue a aresta DAQUELE botão. O `sourceHandle` é
     o id do botão — é assim que o construtor liga cada botão a uma
     resposta diferente. */
  if (handle) {
    const especifica = arestas.find(
      (a) => a.source === noId && a.sourceHandle === handle,
    );
    if (especifica) return especifica.target;
    /* Sem aresta para aquele botão o fluxo acaba ali. NÃO cai na saída
       genérica: mandar a resposta de outro botão é pior que não
       responder, porque entrega a informação errada com confiança. */
    return null;
  }

  const solta = arestas.find(
    (a) => a.source === noId && !a.sourceHandle,
  );
  return solta?.target ?? null;
}

function mensagemDoNo(no: NoDoFluxo, esperar: number): MensagemASair | null {
  const d = no.data;

  if (d.blockId === "message") {
    return { noId: no.id, tipo: "texto", texto: d.texto ?? "", botoes: [], cartoes: [], esperarSegundos: esperar };
  }
  if (d.blockId === "buttons") {
    return { noId: no.id, tipo: "botoes", texto: d.texto ?? "", botoes: d.botoes ?? [], cartoes: [], esperarSegundos: esperar };
  }
  if (d.blockId === "carousel") {
    return { noId: no.id, tipo: "carrossel", texto: d.texto ?? "", botoes: [], cartoes: d.cartoes ?? [], esperarSegundos: esperar };
  }
  return null;
}

/**
 * O que fazer com este evento.
 *
 * `noAtual` é onde o contato parou no fluxo; `null` quando ele nunca
 * interagiu — aí o evento precisa casar um gatilho para começar.
 *
 * ⚠️ NUNCA LANÇA. Roda dentro de um webhook: uma exceção vira 500, e a
 * Meta reenvia o mesmo evento — o que transforma um fluxo com defeito
 * numa enxurrada de mensagens repetidas para a mesma pessoa.
 */
export function decidir(
  nos: NoDoFluxo[],
  arestas: ArestaDoFluxo[],
  evento: EventoDoInstagram,
  noAtual: string | null,
): Decisao {
  const porId = new Map(nos.map((n) => [n.id, n]));

  /* De onde sair: do nó em que o contato está, ou do gatilho que casa
     se ele está começando agora. */
  let origem: string;

  if (noAtual && porId.has(noAtual)) {
    origem = noAtual;
  } else {
    const gatilho = gatilhoQueCasa(nos, evento);
    if (!gatilho) return { acao: "nada", motivo: "Nenhum gatilho casa com este evento." };
    origem = gatilho.id;
  }

  /* Atravessa blocos de atraso somando o tempo, porque atraso não é
     mensagem: ele só adia a próxima. Com teto de saltos para um fluxo
     de atrasos encadeados não virar laço — o validador já barra ciclo
     na publicação, mas o motor não pode depender disso, já que lê um
     fluxo que pode ter sido gravado antes da regra existir. */
  let cursor: string | null = saidaDe(arestas, origem, evento.botao ?? null);
  let esperar = 0;

  for (let saltos = 0; saltos < 20; saltos++) {
    if (!cursor) return { acao: "nada", motivo: "O fluxo acabou aqui." };

    const no = porId.get(cursor);
    if (!no) return { acao: "nada", motivo: "A aresta aponta para um bloco que não existe." };

    if (no.data.blockId === "delay") {
      esperar += segundosDoAtraso(no);
      cursor = saidaDe(arestas, no.id, null);
      continue;
    }

    const mensagem = mensagemDoNo(no, esperar);
    if (!mensagem) {
      /* Condição e divisão A/B ainda não são executáveis. Parar com
         motivo é melhor que adivinhar um ramo: escolher errado manda a
         mensagem errada, e ninguém descobre. */
      return { acao: "nada", motivo: `O bloco "${no.data.blockId}" ainda não é executável pelo motor.` };
    }

    if (!mensagem.texto.trim()) {
      return { acao: "nada", motivo: "O bloco não tem texto para enviar." };
    }

    return { acao: "enviar", mensagem, novoNoAtual: no.id };
  }

  return { acao: "nada", motivo: "Fluxo profundo demais — possível laço." };
}

/**
 * Segundos de um bloco de atraso.
 *
 * O construtor ainda não tem campo de duração, então o padrão é o que
 * vale. Cinco minutos: curto o bastante para a conversa não esfriar,
 * longo o bastante para não parecer resposta automática instantânea —
 * que é justamente o que a Meta procura.
 */
function segundosDoAtraso(no: NoDoFluxo): number {
  const bruto = Number((no.data as { segundos?: unknown }).segundos);
  if (Number.isFinite(bruto) && bruto > 0) return Math.min(bruto, 86_400);
  return 300;
}
