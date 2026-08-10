import type {
  SocialPostStatus,
  SocialPostWithRelations,
  SocialTargetStatus,
} from "@/types/database";

/* =====================================================================
   Situação do post — DERIVADA, nunca gravada
   ---------------------------------------------------------------------
   O banco guarda duas coisas separadas: o trâmite editorial (`status` do
   post) e a publicação real (`status` de cada destino). Nenhuma das duas
   sozinha responde "e aí, esse post está de pé?".

   Quem responde é esta função. E ela é a razão de o esquema não ter uma
   coluna 'publicado' no post: se tivesse, a coluna e os destinos
   discordariam no primeiro post que sai em duas redes e é publicado em
   uma. Aqui não há como discordar — só existe um número.

   O ESTADO QUE JUSTIFICA A TELA é `atrasado`: aprovado, com data que já
   passou, e ainda não publicado em algum lugar. É o post que o cliente
   aprovou na segunda para sair na quarta e ninguém publicou. Nenhuma das
   duas colunas do banco diz isso; a combinação das duas com o relógio,
   sim.
   ===================================================================== */

export type Situacao =
  | "rascunho"
  | "em_aprovacao"
  | "ajustes"
  | "pronto"
  | "agendado"
  | "atrasado"
  | "parcial"
  | "publicado"
  | "falhou"
  | "arquivado";

export interface DescricaoSituacao {
  label: string;
  /** Classe do badge. Tokens do tema — nunca hex. */
  className: string;
  /** Ponto sólido, para onde não cabe badge (célula do calendário). */
  dot: string;
  /** Pede ação de alguém hoje. Alimenta o contador do topo. */
  exigeAcao: boolean;
}

/* A PALETA TEM CINCO FAMÍLIAS DE MATIZ e a tela tem dez situações, então
   algumas dividem cor. A divisão é por SIGNIFICADO, não por sobra:

     vermelho — deu errado           (atrasado, falhou)
     laranja  — incompleto           (ajustes, parcial)
     roxo     — esperando o cliente  (em aprovação)
     azul     — aprovado             (pronto, agendado)
     verde    — está no ar           (publicado)
     cinza    — fora do fluxo        (rascunho, arquivado)

   `pronto` e `agendado` são os dois azuis porque são a mesma coisa —
   aprovado —, e o que os separa é ter dia marcado. Por isso um é
   preenchido e o outro só contorno, em vez de inventar um sexto matiz
   que diria que são estados sem parentesco.

   `--positive` (155) e `--chart-5` (160) são praticamente o mesmo verde,
   e `--warning` (65) e `--chart-4` (60) o mesmo laranja: tratar os dois
   pares como cores diferentes prometeria uma distinção que o olho não
   enxerga. */
export const SITUACOES: Record<Situacao, DescricaoSituacao> = {
  rascunho: {
    label: "Rascunho",
    className: "bg-surface-2 text-muted-foreground ring-hairline",
    dot: "bg-muted-foreground/45",
    exigeAcao: false,
  },
  em_aprovacao: {
    label: "Em aprovação",
    className:
      "bg-[color-mix(in_oklab,var(--chart-3)_14%,transparent)] text-chart-3 ring-chart-3/30",
    dot: "bg-chart-3",
    // Está parado esperando alguém responder — e some da consciência
    // exatamente por isso.
    exigeAcao: true,
  },
  ajustes: {
    label: "Ajustes pedidos",
    className: "bg-warning-muted text-warning ring-warning/25",
    dot: "bg-warning",
    exigeAcao: true,
  },
  pronto: {
    label: "Aprovado, sem data",
    // Só contorno: aprovado igual ao `agendado`, mas com o que falta à
    // vista.
    className: "bg-transparent text-signal ring-signal/45",
    dot: "bg-signal/45",
    // Aprovado e sem dia marcado vira estoque esquecido. É trabalho
    // pago que não foi ao ar.
    exigeAcao: true,
  },
  agendado: {
    label: "Agendado",
    className: "bg-signal-muted text-signal ring-signal/25",
    dot: "bg-signal",
    exigeAcao: false,
  },
  atrasado: {
    label: "Atrasado",
    className: "bg-negative-muted text-negative ring-negative/25",
    dot: "bg-negative",
    exigeAcao: true,
  },
  parcial: {
    label: "Publicado em parte",
    className: "bg-warning-muted text-warning ring-warning/25",
    dot: "bg-warning",
    exigeAcao: true,
  },
  publicado: {
    label: "Publicado",
    className: "bg-positive-muted text-positive ring-positive/25",
    dot: "bg-positive",
    exigeAcao: false,
  },
  falhou: {
    label: "Falhou",
    className: "bg-negative-muted text-negative ring-negative/25",
    dot: "bg-negative",
    exigeAcao: true,
  },
  arquivado: {
    label: "Arquivado",
    className: "bg-surface-2 text-muted-foreground/70 ring-hairline",
    dot: "bg-muted-foreground/30",
    exigeAcao: false,
  },
};

/**
 * A situação real de um post.
 *
 * `agora` é injetável para os testes e para o servidor: a página é
 * renderizada em UTC na Vercel, e comparar `scheduled_at` com um
 * `new Date()` de lá está três horas à frente de quem opera. Quem chama
 * do servidor passa o instante certo; no navegador o padrão basta,
 * porque o relógio do navegador já é o de quem olha.
 */
export function situacaoDoPost(
  post: Pick<SocialPostWithRelations, "status" | "scheduled_at" | "targets">,
  agora: Date = new Date(),
): Situacao {
  if (post.status === "arquivado") return "arquivado";

  const alvos = post.targets ?? [];
  const publicados = alvos.filter((t) => t.status === "publicado").length;
  const falhas = alvos.filter((t) => t.status === "falhou").length;

  /* PUBLICAÇÃO VENCE O TRÂMITE. Um post que já está no ar não volta a
     ser "rascunho" porque alguém esqueceu de mudar o status editorial —
     o que está no ar está no ar, e a tela precisa dizer isso. */
  if (alvos.length > 0 && publicados === alvos.length) return "publicado";
  if (falhas > 0) return "falhou";
  if (publicados > 0) return "parcial";

  if (post.status === "rascunho") return "rascunho";
  if (post.status === "em_aprovacao") return "em_aprovacao";
  if (post.status === "ajustes") return "ajustes";

  // Daqui para baixo: aprovado e nada publicado ainda.
  if (!post.scheduled_at) return "pronto";

  return new Date(post.scheduled_at).getTime() < agora.getTime()
    ? "atrasado"
    : "agendado";
}

/* ------------------------------------------------------------------ */
/* Vocabulário do trâmite editorial                                     */
/* ------------------------------------------------------------------ */

export const STATUS_EDITORIAL: {
  id: SocialPostStatus;
  label: string;
  /** O que essa mudança significa para quem clica. */
  descricao: string;
}[] = [
  {
    id: "rascunho",
    label: "Rascunho",
    descricao: "Em produção. Ninguém foi acionado ainda.",
  },
  {
    id: "em_aprovacao",
    label: "Em aprovação",
    descricao: "Enviado ao cliente, esperando resposta.",
  },
  {
    id: "ajustes",
    label: "Ajustes pedidos",
    descricao: "O cliente pediu mudança. O comentário diz qual.",
  },
  {
    id: "aprovado",
    label: "Aprovado",
    descricao: "Liberado para publicar. Registra quem aprovou.",
  },
  {
    id: "arquivado",
    label: "Arquivado",
    descricao: "Fora do calendário, sem apagar o histórico.",
  },
];

export const STATUS_EDITORIAL_LABEL = new Map(
  STATUS_EDITORIAL.map((s) => [s.id, s.label]),
);

export const TARGET_STATUS_LABEL: Record<SocialTargetStatus, string> = {
  pendente: "Pendente",
  publicado: "Publicado",
  falhou: "Falhou",
};

/* ------------------------------------------------------------------ */
/* Resumo da carteira                                                  */
/* ------------------------------------------------------------------ */

export interface ResumoSocial {
  total: number;
  /** Quantos pedem ação de alguém hoje — a soma das situações `exigeAcao`. */
  exigemAcao: number;
  atrasados: number;
  emAprovacao: number;
  agendados: number;
  publicados: number;
  /** Pauta sem data marcada, em qualquer estágio. */
  semData: number;
}

export function resumirPosts(
  posts: SocialPostWithRelations[],
  agora: Date = new Date(),
): ResumoSocial {
  const resumo: ResumoSocial = {
    total: 0,
    exigemAcao: 0,
    atrasados: 0,
    emAprovacao: 0,
    agendados: 0,
    publicados: 0,
    semData: 0,
  };

  for (const p of posts) {
    /* Arquivado não entra em conta nenhuma, nem no total. Ele existe
       para o histórico; contá-lo faria o painel do mês crescer com peças
       que foram justamente tiradas do mês. */
    const s = situacaoDoPost(p, agora);
    if (s === "arquivado") continue;

    resumo.total += 1;
    if (SITUACOES[s].exigeAcao) resumo.exigemAcao += 1;
    if (s === "atrasado") resumo.atrasados += 1;
    if (s === "em_aprovacao") resumo.emAprovacao += 1;
    if (s === "agendado") resumo.agendados += 1;
    if (s === "publicado") resumo.publicados += 1;
    if (!p.scheduled_at) resumo.semData += 1;
  }

  return resumo;
}
