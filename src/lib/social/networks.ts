import type { SocialFormat, SocialNetwork } from "@/types/database";

/* =====================================================================
   Catálogo de redes sociais
   ---------------------------------------------------------------------
   Rótulo, cor, limite de legenda e formatos aceitos, num lugar só.

   O limite é o motivo principal de este arquivo existir. Sem ele, o
   erro aparece na hora de colar no Instagram — quando a peça já foi
   aprovada pelo cliente, o dia já é o do post e alguém tem de reescrever
   a legenda às pressas. Com o contador na tela, aparece enquanto ainda é
   rascunho.

   NÃO tem token, endpoint nem client_id: este módulo é editorial e roda
   no navegador. Conexão de API do Instagram é outra coisa e mora em
   `@/lib/instagram/connection`.
   ===================================================================== */

export interface RedeSocial {
  id: SocialNetwork;
  label: string;
  /**
   * Cor da marca, escolhida para sobreviver aos DOIS temas.
   *
   * X e Threads são marcas pretas — usar o preto real some no tema
   * escuro. Ficam em tons neutros distintos, e quem separa as duas na
   * leitura é o desenho do glifo, não a cor.
   */
  cor: string;
  /**
   * Máximo de caracteres da legenda. Números da documentação de cada
   * plataforma; quando há mais de um limite (título e descrição no
   * YouTube), vale o da descrição, que é o campo desta tela.
   */
  limite: number;
  /** Formatos que a rede realmente aceita. Avisa, não bloqueia — ver `formatoEstranho`. */
  formatos: SocialFormat[];
  /**
   * Como ESTA rede chama o formato, quando o nome comercial difere do
   * ativo. O mesmo vídeo 9:16 é "Reels" no Instagram, "Shorts" no
   * YouTube e só "vídeo" no TikTok — e é exatamente essa diferença de
   * vocabulário que fazia parecer que eram três peças diferentes.
   */
  apelidos?: Partial<Record<SocialFormat, string>>;
  /** Prefixo do perfil, para montar o link a partir do @. */
  perfilBase: string | null;
}

export const REDES: RedeSocial[] = [
  {
    id: "instagram",
    label: "Instagram",
    cor: "#D9337C",
    limite: 2200,
    formatos: ["video_vertical", "imagem", "carrossel", "stories"],
    apelidos: { video_vertical: "Reels" },
    perfilBase: "https://instagram.com/",
  },
  {
    id: "facebook",
    label: "Facebook",
    cor: "#1877F2",
    // 63.206 é o limite real e não cabe em nenhum contador útil, mas o
    // número honesto vale mais que um redondo inventado.
    limite: 63206,
    formatos: [
      "video_vertical",
      "video_horizontal",
      "imagem",
      "carrossel",
      "stories",
    ],
    apelidos: { video_vertical: "Reels" },
    perfilBase: "https://facebook.com/",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    cor: "#0A66C2",
    limite: 3000,
    formatos: ["video_horizontal", "imagem", "carrossel", "artigo"],
    perfilBase: "https://linkedin.com/company/",
  },
  {
    id: "tiktok",
    label: "TikTok",
    cor: "#EE3A5D",
    limite: 2200,
    // O TikTok é 9:16 e ponto — não tem nome comercial próprio para o
    // formato porque não existe outro lá dentro.
    formatos: ["video_vertical"],
    perfilBase: "https://tiktok.com/@",
  },
  {
    id: "youtube",
    label: "YouTube",
    cor: "#F0322A",
    limite: 5000,
    formatos: ["video_vertical", "video_horizontal"],
    apelidos: { video_vertical: "Shorts" },
    perfilBase: "https://youtube.com/@",
  },
  {
    id: "x",
    label: "X",
    cor: "#64748B",
    limite: 280,
    formatos: ["video_vertical", "video_horizontal", "imagem"],
    perfilBase: "https://x.com/",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    cor: "#C8232C",
    limite: 500,
    formatos: ["video_vertical", "imagem", "carrossel"],
    apelidos: { video_vertical: "Idea Pin" },
    perfilBase: "https://pinterest.com/",
  },
  {
    id: "threads",
    label: "Threads",
    cor: "#A1A1AA",
    limite: 500,
    formatos: ["video_vertical", "imagem", "carrossel"],
    perfilBase: "https://threads.net/@",
  },
  {
    id: "google_business",
    label: "Google Meu Negócio",
    cor: "#34A853",
    limite: 1500,
    formatos: ["imagem", "video_horizontal"],
    perfilBase: null,
  },
];

export const REDE_POR_ID = new Map(REDES.map((r) => [r.id, r]));

export function rede(id: SocialNetwork): RedeSocial {
  /* Fallback em vez de `!`: uma rede removida do catálogo com posts
     antigos apontando para ela derrubaria o calendário inteiro. Aparece
     como o próprio id, feio e legível, e o resto da tela funciona. */
  return (
    REDE_POR_ID.get(id) ?? {
      id,
      label: id,
      cor: "#94A3B8",
      limite: 2200,
      formatos: [],
      perfilBase: null,
    }
  );
}

/** Ordena por relevância no catálogo, não por ordem de clique. */
export function ordenarRedes(ids: SocialNetwork[]): SocialNetwork[] {
  const posicao = new Map(REDES.map((r, i) => [r.id, i] as const));
  return [...ids].sort(
    (a, b) => (posicao.get(a) ?? 99) - (posicao.get(b) ?? 99),
  );
}

/* ------------------------------------------------------------------ */
/* Formatos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Formatos POR ATIVO — o que o arquivo é, não como cada rede o chama.
 *
 * A lista anterior tinha `reels`, `shorts` e `video` como itens
 * separados, e por isso não existia escolha nenhuma que servisse para
 * postar um vertical em Instagram, Facebook, TikTok e YouTube ao mesmo
 * tempo: Reels avisava sobre TikTok e YouTube, Vídeo avisava sobre
 * Instagram, Shorts avisava sobre três. Um fluxo que é o mais comum de
 * todos ficava impossível de registrar sem um aviso falso.
 *
 * `video_vertical` é UM arquivo que as quatro aceitam. O nome comercial
 * de cada uma virou apelido, exibido na tela — ver `apelidoDoFormato`.
 *
 * A ordem é a de uso: vertical primeiro porque é o que a agência mais
 * produz hoje.
 */
export const FORMATOS: {
  id: SocialFormat;
  label: string;
  /** Uma linha explicando o ativo, para a escolha não depender do rótulo. */
  detalhe: string;
}[] = [
  {
    id: "video_vertical",
    label: "Vídeo vertical",
    detalhe: "9:16 — vira Reels, Shorts ou vídeo do TikTok",
  },
  {
    id: "video_horizontal",
    label: "Vídeo horizontal",
    detalhe: "16:9 — YouTube, LinkedIn, Facebook",
  },
  { id: "imagem", label: "Imagem", detalhe: "Uma arte só, no feed" },
  { id: "carrossel", label: "Carrossel", detalhe: "Várias artes na mesma peça" },
  { id: "stories", label: "Stories", detalhe: "9:16 que expira em 24h" },
  { id: "artigo", label: "Artigo", detalhe: "Texto longo, publicado na própria rede" },
];

export const FORMATO_LABEL = new Map(FORMATOS.map((f) => [f.id, f.label]));

export const FORMATO_POR_ID = new Map(FORMATOS.map((f) => [f.id, f]));

/**
 * Como cada rede escolhida chama o formato.
 *
 * Devolve só as redes que dão um nome PRÓPRIO — listar "no TikTok é
 * vídeo vertical" não informa nada. É o que permite a tela dizer, em uma
 * linha, que o mesmo arquivo sai como Reels num lugar e Shorts no outro.
 */
export function apelidoDoFormato(
  formato: SocialFormat,
  redes: SocialNetwork[],
): { rede: RedeSocial; apelido: string }[] {
  return ordenarRedes(redes)
    .map((id) => {
      const r = rede(id);
      const apelido = r.apelidos?.[formato];
      return apelido ? { rede: r, apelido } : null;
    })
    .filter((x): x is { rede: RedeSocial; apelido: string } => x !== null);
}

/**
 * Redes em que o formato escolhido não existe.
 *
 * AVISA, NÃO BLOQUEIA. A tentação era impedir a combinação, e ela erra
 * nos dois sentidos: hoje o LinkedIn não tem Reels, mas nada garante que
 * a lista aqui esteja atualizada com o que a plataforma lançou mês
 * passado — e um bloqueio desatualizado impede trabalho legítimo sem dar
 * caminho de saída. Um aviso deixa a pessoa decidir.
 */
export function formatoEstranho(
  formato: SocialFormat,
  redes: SocialNetwork[],
): SocialNetwork[] {
  return redes.filter((r) => {
    const c = REDE_POR_ID.get(r);
    return c ? c.formatos.length > 0 && !c.formatos.includes(formato) : false;
  });
}

/* ------------------------------------------------------------------ */
/* Legenda                                                             */
/* ------------------------------------------------------------------ */

export interface LimiteDaLegenda {
  /** Rede com o MENOR limite entre as escolhidas — a que aperta. */
  rede: RedeSocial;
  usado: number;
  restante: number;
  estourou: boolean;
}

/**
 * Quanto de legenda ainda cabe, considerando a rede mais restritiva.
 *
 * O limite que importa é o MENOR, não o da primeira rede marcada: um
 * post para Instagram e X cabe em 2.200 no Instagram e estoura em 280 no
 * X, e é o X que decide o texto.
 */
export function limiteDaLegenda(
  legenda: string,
  redes: SocialNetwork[],
): LimiteDaLegenda | null {
  if (redes.length === 0) return null;

  const catalogo = redes.map(rede);
  const apertada = catalogo.reduce((menor, r) =>
    r.limite < menor.limite ? r : menor,
  );

  /* `[...string]` conta PONTOS DE CÓDIGO, não unidades UTF-16. Um emoji
     conta 2 em `.length` e 1 aqui — e as plataformas contam 1. Sem isso,
     uma legenda cheia de emoji aparece estourada sem estar. */
  const usado = [...legenda].length;

  return {
    rede: apertada,
    usado,
    restante: apertada.limite - usado,
    estourou: usado > apertada.limite,
  };
}

/** Monta o link do perfil a partir do @ cadastrado. */
export function urlDoPerfil(id: SocialNetwork, handle: string): string | null {
  const base = rede(id).perfilBase;
  const limpo = handle.trim().replace(/^@/, "");
  return base && limpo ? `${base}${limpo}` : null;
}
