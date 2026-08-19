/* =====================================================================
   Arte da peça: arquivo no painel ou link de fora
   ---------------------------------------------------------------------
   `social_posts.media_urls` guarda os dois, na mesma lista, e a
   diferença é o formato do texto:

     https://drive.google.com/…            link externo, como sempre foi
     <client_id>/<pasta>/<arquivo.jpg>     arquivo no bucket social-media

   POR QUE NA MESMA COLUNA. Separar em duas listas obrigaria toda leitura
   a juntá-las de volta na ordem certa — e a ordem importa: num carrossel
   ela é a ordem dos slides. Uma lista só, e quem exibe pergunta de que
   tipo é cada item.

   POR QUE NÃO GUARDAR A URL ASSINADA. Ela expira. Gravar no banco uma
   URL de uma hora significa que o post de semana que vem abre quebrado —
   e pior, quebra em silêncio, mostrando um quadrado vazio onde havia
   arte aprovada. O caminho é permanente; a assinatura é feita na hora de
   mostrar.
   ===================================================================== */

export const BUCKET_ARTE = "social-media";

/** Item da lista, já classificado para a tela saber o que fazer. */
export interface ArteDaPeca {
  /** O texto exatamente como está em `media_urls`. */
  valor: string;
  origem: "painel" | "link";
  /** Só o nome do arquivo, para exibir. */
  nome: string;
  tipo: "imagem" | "video" | "desconhecido";
}

/** Link externo começa com http; o resto é caminho no bucket. */
export function ehArteDoPainel(valor: string): boolean {
  return !/^https?:\/\//i.test(valor.trim());
}

const EXTENSAO_IMAGEM = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;
const EXTENSAO_VIDEO = /\.(mp4|mov|m4v|webm)(\?|$)/i;

export function classificarArte(valor: string): ArteDaPeca {
  const limpo = valor.trim();
  const doPainel = ehArteDoPainel(limpo);

  /* Nome do arquivo: último trecho do caminho, sem query. Link do Drive
     não tem nome de arquivo na URL — nesses casos sobra o domínio, que é
     mais útil do que um id opaco de 33 caracteres. */
  const semQuery = limpo.split("?")[0] ?? limpo;
  const ultimo = semQuery.split("/").filter(Boolean).pop() ?? limpo;

  const nome = doPainel
    ? decodeURIComponent(ultimo)
    : dominioLegivel(limpo) ?? ultimo;

  return {
    valor: limpo,
    origem: doPainel ? "painel" : "link",
    nome,
    tipo: EXTENSAO_IMAGEM.test(semQuery)
      ? "imagem"
      : EXTENSAO_VIDEO.test(semQuery)
        ? "video"
        : "desconhecido",
  };
}

function dominioLegivel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * O caminho onde a arte deste cliente mora.
 *
 * A PRIMEIRA PASTA É O UUID DO CLIENTE, e não é organização: é a
 * autorização. A policy do bucket compara esse primeiro trecho com a
 * visibilidade de `clients`, então o caminho É a regra de acesso — o
 * mesmo desenho de `report-pdfs` e `ad-thumbs`.
 *
 * A segunda pasta é aleatória por upload, não o id do post: no
 * compositor de uma peça NOVA o post ainda não existe quando o arquivo
 * sobe. Amarrar ao post exigiria salvar antes de anexar, que é
 * exatamente a ordem que ninguém segue.
 */
export function caminhoDaArte(
  clientId: string,
  pasta: string,
  nomeArquivo: string,
): string {
  return `${clientId}/${pasta}/${nomeDeArquivoSeguro(nomeArquivo)}`;
}

/**
 * Nome de arquivo que o Storage aceita sem reclamar e o humano reconhece.
 *
 * O Storage do Supabase recusa alguns caracteres em `name`, e acento em
 * URL assinada vira `%C3%A7` no meio do caminho. Mas trocar tudo por um
 * uuid faz o painel listar "a3f2…mp4" para quem anexou "reels-dia-dos-
 * pais.mp4" — some a única pista de qual arquivo é qual.
 */
export function nomeDeArquivoSeguro(nome: string): string {
  const semAcento = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  return (
    semAcento
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-120) || "arquivo"
  );
}
