import { dataNoBrasil } from "@/lib/date-br";
import type {
  SocialAccount,
  SocialPostComment,
  SocialPostWithRelations,
} from "@/types/database";

/* =====================================================================
   Pauta social de demonstração
   ---------------------------------------------------------------------
   ANCORADA NO DIA DE HOJE, não em datas fixas. Um dataset com
   "2026-08-14" escrito à mão fica coerente por uma semana e depois vira
   um calendário inteiramente no passado — a tela abre vazia no mês
   corrente e quem avalia conclui que está quebrada.

   Cobre TODAS as situações derivadas de `situacaoDoPost`, inclusive as
   ruins: atrasado, publicado em parte e falhou. Um dataset só com posts
   bem-comportados esconde justamente os estados que a tela existe para
   mostrar.
   ===================================================================== */

/** Instante no fuso de São Paulo, a `offset` dias de hoje. */
function dia(offset: number, hora = 10, minuto = 0): string {
  const base = new Date();
  base.setDate(base.getDate() + offset);
  const data = dataNoBrasil(base);
  const hh = String(hora).padStart(2, "0");
  const mm = String(minuto).padStart(2, "0");
  return `${data}T${hh}:${mm}:00-03:00`;
}

/* Espelha `demoClients` — nome, id e cor. Divergir daqui faria o card do
   calendário dizer um nome e a barra lateral outro para o mesmo id. */
const CLIENTES = {
  verdi: { id: "c-verdi", name: "Verdi Cosméticos", brand_primary: "#2F6F4E", logo_url: null },
  atlas: { id: "c-atlas", name: "Atlas Odontologia", brand_primary: "#1E4E8C", logo_url: null },
  nord: { id: "c-nord", name: "Nord Performance", brand_primary: "#111827", logo_url: null },
  lumen: { id: "c-lumen", name: "Lumen Arquitetura", brand_primary: "#8A6E4B", logo_url: null },
} as const;

const BEA = { id: "u-bea", full_name: "Beatriz Lima", avatar_url: null };
const RAFA = { id: "u-rafael", full_name: "Rafael Nogueira", avatar_url: null };
const ADMIN = { id: "u-admin", full_name: "Guilherme Casagrande", avatar_url: null };

export const demoSocialAccounts: SocialAccount[] = [
  acc("c-verdi", "instagram", "verdicosmeticos"),
  acc("c-verdi", "facebook", "verdicosmeticos"),
  acc("c-verdi", "tiktok", "verdicosmeticos"),
  acc("c-atlas", "instagram", "atlasodonto"),
  acc("c-atlas", "facebook", "atlasodontologia"),
  acc("c-atlas", "google_business", "atlas-odontologia"),
  acc("c-nord", "instagram", "nordperformance"),
  acc("c-nord", "linkedin", "nord-performance"),
  acc("c-nord", "youtube", "nordperformance"),
  acc("c-lumen", "instagram", "lumenarq"),
  acc("c-lumen", "pinterest", "lumenarq"),
  // Inativa: existe no cadastro, fora do contrato do mês. A tela de
  // perfis mostra apagada; o compositor não oferece.
  { ...acc("c-lumen", "x", "lumenarq"), is_active: false },
];

function acc(
  client_id: string,
  network: SocialAccount["network"],
  handle: string,
): SocialAccount {
  return {
    client_id,
    network,
    handle,
    profile_url: null,
    is_active: true,
    notes: null,
    created_at: dia(-200),
    updated_at: dia(-200),
  };
}

let seq = 0;

function post(p: {
  cliente: keyof typeof CLIENTES;
  title: string;
  caption: string;
  format?: SocialPostWithRelations["format"];
  scheduled_at: string | null;
  status: SocialPostWithRelations["status"];
  autor?: typeof BEA;
  alvos: {
    network: SocialPostWithRelations["targets"][number]["network"];
    status?: "pendente" | "publicado" | "falhou";
    url?: string;
    erro?: string;
    caption_override?: string;
  }[];
  comentarios?: number;
}): SocialPostWithRelations {
  seq += 1;
  const id = `sp-${seq}`;
  const cliente = CLIENTES[p.cliente];
  const aprovado = p.status === "aprovado";

  return {
    id,
    client_id: cliente.id,
    title: p.title,
    caption: p.caption,
    format: p.format ?? "imagem",
    media_urls: [],
    scheduled_at: p.scheduled_at,
    status: p.status,
    approved_by: aprovado ? ADMIN.id : null,
    approved_at: aprovado ? dia(-3, 16) : null,
    created_by: (p.autor ?? BEA).id,
    created_at: dia(-10),
    updated_at: dia(-2),
    client: cliente,
    author: p.autor ?? BEA,
    approver: aprovado ? { id: ADMIN.id, full_name: ADMIN.full_name } : null,
    comment_count: p.comentarios ?? 0,
    targets: p.alvos.map((a, i) => ({
      id: `${id}-t${i}`,
      post_id: id,
      network: a.network,
      caption_override: a.caption_override ?? null,
      status: a.status ?? "pendente",
      published_at: a.status === "publicado" ? p.scheduled_at : null,
      published_url: a.url ?? null,
      error: a.erro ?? null,
      created_at: dia(-10),
      updated_at: dia(-2),
    })),
  };
}

export const demoSocialPosts: SocialPostWithRelations[] = [
  /* --- No ar ------------------------------------------------------- */
  post({
    cliente: "verdi",
    title: "Carrossel — 5 erros de skincare",
    caption:
      "Cinco erros que estão sabotando sua rotina de skincare (o terceiro quase todo mundo comete). Arrasta pro lado 👉",
    format: "carrossel",
    scheduled_at: dia(-6, 9),
    status: "aprovado",
    alvos: [
      { network: "instagram", status: "publicado", url: "https://instagram.com/p/exemplo1" },
      { network: "facebook", status: "publicado", url: "https://facebook.com/exemplo1" },
    ],
    comentarios: 2,
  }),
  post({
    cliente: "nord",
    title: "Reels — 3 erros que travam o primeiro lançamento",
    caption:
      "Os três erros que aparecem em quase todo primeiro lançamento — e o que fazer no lugar de cada um.",
    format: "video_vertical",
    scheduled_at: dia(-4, 18, 30),
    status: "aprovado",
    alvos: [{ network: "instagram", status: "publicado", url: "https://instagram.com/reel/exemplo" }],
  }),

  /* --- Publicado em parte: saiu numa rede, esqueceram da outra ------ */
  post({
    cliente: "atlas",
    title: "Antes e depois — lente de contato dental",
    caption:
      "Transformação em duas sessões. Resultado real de paciente, publicado com autorização. Agende sua avaliação.",
    scheduled_at: dia(-2, 11),
    status: "aprovado",
    autor: RAFA,
    alvos: [
      { network: "instagram", status: "publicado", url: "https://instagram.com/p/exemplo2" },
      { network: "facebook" },
      { network: "google_business" },
    ],
    comentarios: 1,
  }),

  /* --- Atrasado: aprovado, dia passou, ninguém publicou ------------- */
  post({
    cliente: "lumen",
    title: "Story — obra entregue em Jurerê",
    caption: "Antes e depois da reforma em Jurerê. Arrasta pra cima pra ver o projeto inteiro.",
    format: "stories",
    scheduled_at: dia(-1, 8),
    status: "aprovado",
    alvos: [{ network: "instagram" }],
  }),

  /* --- Falhou ------------------------------------------------------ */
  post({
    cliente: "nord",
    title: "Vídeo — aula aberta sobre funil",
    caption:
      "Aula aberta de 15 minutos: como montar um funil que não depende de anúncio caro.",
    format: "video_vertical",
    scheduled_at: dia(-3, 7),
    status: "aprovado",
    alvos: [
      { network: "instagram", status: "publicado", url: "https://instagram.com/reel/exemplo3" },
      {
        network: "youtube",
        status: "falhou",
        erro: "Vídeo recusado pela plataforma: trilha com direitos autorais.",
      },
    ],
  }),

  /* --- Agendado ---------------------------------------------------- */
  post({
    cliente: "verdi",
    title: "Feed — lançamento Sérum Noturno",
    caption:
      "Chegou o Sérum Noturno de Vitamina C. Fórmula vegana, testada dermatologicamente e sem álcool. Pré-venda com 20% até domingo.",
    scheduled_at: dia(2, 19),
    status: "aprovado",
    alvos: [{ network: "instagram" }, { network: "facebook" }, { network: "tiktok" }],
  }),
  post({
    cliente: "nord",
    title: "LinkedIn — o que mudou no CAC de infoproduto",
    caption:
      "O custo de aquisição em infoproduto subiu 8,4% no trimestre. Puxamos os três fatores que explicam o movimento — e o que dá para fazer com cada um.",
    format: "artigo",
    scheduled_at: dia(4, 9),
    status: "aprovado",
    autor: ADMIN,
    alvos: [{ network: "linkedin" }],
  }),
  post({
    cliente: "atlas",
    title: "Post — clareamento a laser",
    caption: "Clareamento a laser em sessão única. Vagas para setembro abertas.",
    scheduled_at: dia(7, 10),
    status: "aprovado",
    alvos: [{ network: "instagram" }, { network: "facebook" }],
  }),

  /* --- Dia cheio: quatro peças no mesmo dia -------------------------
     Existe para o dataset exercitar o que um calendário real tem e um
     mock com uma peça por dia nunca mostra: a célula que estoura o
     limite de três e ganha o "+1 no dia". Sem isso, o empilhamento e a
     expansão da célula só apareceriam em produção. */
  post({
    cliente: "verdi",
    title: "Stories — enquete de fragrância",
    caption: "Qual fragrância você quer no próximo lançamento? Responde aí.",
    format: "stories",
    scheduled_at: dia(2, 9),
    status: "aprovado",
    alvos: [{ network: "instagram" }],
  }),
  post({
    cliente: "atlas",
    title: "Post — horário estendido no sábado",
    caption: "A partir deste mês atendemos aos sábados até as 14h. Agende pelo WhatsApp.",
    scheduled_at: dia(2, 12),
    status: "aprovado",
    alvos: [{ network: "instagram" }, { network: "google_business" }],
  }),
  post({
    cliente: "nord",
    title: "Carrossel — depoimento do aluno Diego",
    caption: "De 0 a 12 mil em quatro meses. O que o Diego fez diferente no terceiro mês.",
    format: "carrossel",
    scheduled_at: dia(2, 15),
    status: "em_aprovacao",
    alvos: [{ network: "instagram" }, { network: "linkedin" }],
  }),

  /* --- Esperando o cliente ----------------------------------------- */
  post({
    cliente: "verdi",
    title: "Reels — bastidores da fábrica",
    caption:
      "De onde vem cada ingrediente do seu skincare. Um dia dentro da nossa fábrica em Blumenau.",
    format: "video_vertical",
    scheduled_at: dia(5, 18),
    status: "em_aprovacao",
    alvos: [{ network: "instagram" }, { network: "tiktok" }],
    comentarios: 1,
  }),
  post({
    cliente: "lumen",
    title: "Carrossel — 4 plantas de apartamento compacto",
    caption:
      "Quatro plantas de até 60m² que resolvem circulação sem derrubar parede. Salve para a próxima reforma.",
    format: "carrossel",
    scheduled_at: dia(9, 12),
    status: "em_aprovacao",
    alvos: [{ network: "instagram" }, { network: "pinterest" }],
  }),

  /* --- Ajustes pedidos --------------------------------------------- */
  post({
    cliente: "atlas",
    title: "Post — implante dentário",
    caption:
      "Implante em sessão única, com tecnologia digital. Avaliação gratuita nesta semana.",
    scheduled_at: dia(3, 15),
    status: "ajustes",
    autor: RAFA,
    alvos: [{ network: "instagram" }, { network: "facebook" }],
    comentarios: 3,
  }),

  /* --- Rascunho ---------------------------------------------------- */
  post({
    cliente: "nord",
    title: "Reels — bastidores da gravação do módulo 4",
    caption: "",
    format: "video_vertical",
    scheduled_at: dia(12, 11),
    status: "rascunho",
    alvos: [{ network: "instagram" }],
  }),

  /* --- Aprovado sem data: trabalho pronto parado -------------------- */
  post({
    cliente: "verdi",
    title: "Depoimento — cliente Fernanda",
    caption:
      "“Em três semanas minha pele mudou.” O depoimento da Fernanda depois de 21 dias com o Kit Rotina.",
    scheduled_at: null,
    status: "aprovado",
    alvos: [{ network: "instagram" }, { network: "facebook" }],
  }),
  post({
    cliente: "lumen",
    title: "Post — iluminação natural em sala pequena",
    caption: "Três decisões de projeto que dobram a luz natural sem obra estrutural.",
    scheduled_at: null,
    status: "aprovado",
    alvos: [{ network: "instagram" }],
  }),

  /* --- Arquivado: some das contas e do calendário ------------------- */
  post({
    cliente: "atlas",
    title: "Campanha Dia das Mães (cancelada)",
    caption: "Peça cancelada pelo cliente. Mantida para histórico.",
    scheduled_at: dia(-40, 10),
    status: "arquivado",
    alvos: [{ network: "instagram" }],
  }),
];

export const demoSocialComments: SocialPostComment[] = [
  {
    id: "sc-1",
    post_id: "sp-11",
    author_id: ADMIN.id,
    body: "Cliente pediu para tirar a palavra “gratuita” — o conselho regional não permite na peça.",
    created_at: dia(-2, 14, 20),
    author: ADMIN,
  },
  {
    id: "sc-2",
    post_id: "sp-11",
    author_id: RAFA.id,
    body: "Ajustado para “avaliação sem custo”. Subi a arte v2 no Drive.",
    created_at: dia(-2, 16, 5),
    author: RAFA,
  },
  {
    id: "sc-3",
    post_id: "sp-11",
    author_id: BEA.id,
    body: "Reenviado para aprovação hoje de manhã.",
    created_at: dia(-1, 9, 40),
    author: BEA,
  },
  {
    id: "sc-4",
    post_id: "sp-9",
    author_id: BEA.id,
    body: "Enviado no grupo do WhatsApp. Juliana respondeu que vê hoje à noite.",
    created_at: dia(-1, 18, 10),
    author: BEA,
  },
  {
    id: "sc-5",
    post_id: "sp-3",
    author_id: RAFA.id,
    body: "Autorização de imagem da paciente arquivada na pasta do cliente.",
    created_at: dia(-3, 11, 0),
    author: RAFA,
  },
];
