import type {
  LeadBoard,
  LeadNote,
  LeadStage,
  LeadTask,
  LeadWithRelations,
} from "@/types/database";

/* =====================================================================
   CRM de leads — dataset de demonstração
   ---------------------------------------------------------------------
   O critério é o mesmo do resto do mock (ver `mock/content.ts`): não
   existe para parecer cheio, existe para que abrir a tela PROVE que cada
   estado renderiza. Por isso a lista tem, de propósito:

     • lead sem contato       (o campo é opcional na migration 56)
     • lead sem valor         ("sem valor" ≠ "R$ 0,00" no cartão)
     • lead de mídia paga     (é o que a triagem existe para julgar)
     • descarte por SEGMENTAÇÃO e descarte por ATENDIMENTO, para o
       cartão "Culpa da segmentação" ter os dois lados
     • tarefa vencida e tarefa futura
     • nota de mais de uma pessoa

   Cliente fictício, nunca um da carteira real: o modo demo é o que roda
   sem credenciais e o que se mostra numa apresentação.
   ===================================================================== */

const AGORA = Date.now();

/** Instante ISO completo — as colunas de lead são `timestamptz`. */
function horasAtras(h: number): string {
  return new Date(AGORA - h * 3_600_000).toISOString();
}

function diasAtras(d: number): string {
  return horasAtras(d * 24);
}

function diasAFrente(d: number): string {
  return new Date(AGORA + d * 86_400_000).toISOString();
}

/* ------------------------------------------------------------------ */

const ETAPAS_DEMO: Omit<LeadStage, "pipeline_id">[] = [
  {
    id: "s-novo",
    name: "Novo contato",
    kind: "aberto",
    color: "#64748B",
    position: 0,
    created_at: diasAtras(60),
    updated_at: diasAtras(60),
  },
  {
    id: "s-conversa",
    name: "Em conversa",
    kind: "aberto",
    color: "#3B82F6",
    position: 1,
    created_at: diasAtras(60),
    updated_at: diasAtras(60),
  },
  {
    id: "s-proposta",
    name: "Proposta",
    kind: "aberto",
    color: "#A855F7",
    position: 2,
    created_at: diasAtras(60),
    updated_at: diasAtras(60),
  },
  {
    id: "s-ganho",
    name: "Ganho",
    kind: "ganho",
    color: "#1F7A4D",
    position: 3,
    created_at: diasAtras(60),
    updated_at: diasAtras(60),
  },
  {
    id: "s-perdido",
    name: "Perdido",
    kind: "perdido",
    color: "#B03A2E",
    position: 4,
    created_at: diasAtras(60),
    updated_at: diasAtras(60),
  },
];

interface Semente {
  id: string;
  title: string;
  stage_id: string;
  source: LeadWithRelations["source"];
  value_cents: number;
  contato: { name: string; phone: string | null; email: string | null } | null;
  owner: "u-admin" | "u-marina" | null;
  criadoHa: number;
  lost_reason?: string;
  external_id?: string;
  notas?: number;
  tarefas?: { title: string; vence: number; feita?: boolean }[];
}

const SEMENTES: Semente[] = [
  {
    id: "l-1",
    title: "Camila Prado",
    stage_id: "s-novo",
    source: "meta_ads",
    value_cents: 0,
    contato: { name: "Camila Prado", phone: "48991230011", email: null },
    owner: null,
    criadoHa: 3,
    external_id: "fb-lead-88213",
  },
  {
    id: "l-2",
    title: "Rodrigo Menezes",
    stage_id: "s-novo",
    source: "meta_ads",
    value_cents: 0,
    contato: {
      name: "Rodrigo Menezes",
      phone: "47988440022",
      email: "rodrigo.menezes@gmail.com",
    },
    owner: null,
    criadoHa: 9,
    external_id: "fb-lead-88240",
  },
  {
    /* Sem contato: prova que o cartão aguenta o campo nulo, que a
       migration permite justamente para a ingestão automática não
       recusar metade do que recebe. */
    id: "l-3",
    title: "Contato pelo direct",
    stage_id: "s-novo",
    source: "instagram",
    value_cents: 0,
    contato: null,
    owner: null,
    criadoHa: 26,
  },
  {
    id: "l-4",
    title: "Fernanda Lopes",
    stage_id: "s-conversa",
    source: "meta_ads",
    value_cents: 34900,
    contato: {
      name: "Fernanda Lopes",
      phone: "48996780044",
      email: "fe.lopes@outlook.com",
    },
    owner: "u-marina",
    criadoHa: 72,
    notas: 2,
    tarefas: [{ title: "Ligar para confirmar o endereço", vence: -1 }],
  },
  {
    id: "l-5",
    title: "Marcelo Tavares",
    stage_id: "s-conversa",
    source: "site",
    value_cents: 21000,
    contato: {
      name: "Marcelo Tavares",
      phone: "4733220055",
      email: "marcelo@tavaresestudio.com.br",
    },
    owner: "u-marina",
    criadoHa: 120,
    notas: 1,
    tarefas: [{ title: "Mandar a tabela de planos", vence: 2 }],
  },
  {
    id: "l-6",
    title: "Priscila Amorim",
    stage_id: "s-proposta",
    source: "meta_ads",
    value_cents: 58900,
    contato: {
      name: "Priscila Amorim",
      phone: "48984110066",
      email: "priscila.amorim@gmail.com",
    },
    owner: "u-admin",
    criadoHa: 190,
    notas: 3,
    tarefas: [{ title: "Retorno da proposta", vence: 1 }],
  },
  {
    id: "l-7",
    title: "Eduardo Bastos",
    stage_id: "s-ganho",
    source: "meta_ads",
    value_cents: 47800,
    contato: {
      name: "Eduardo Bastos",
      phone: "47999880077",
      email: null,
    },
    owner: "u-marina",
    criadoHa: 300,
    notas: 2,
    tarefas: [{ title: "Enviar contrato", vence: -6, feita: true }],
  },
  {
    id: "l-8",
    title: "Solange Ferri",
    stage_id: "s-ganho",
    source: "indicacao",
    value_cents: 39900,
    contato: { name: "Solange Ferri", phone: "48991770088", email: null },
    owner: "u-admin",
    criadoHa: 420,
  },
  {
    /* Descarte que ACUSA A SEGMENTAÇÃO. */
    id: "l-9",
    title: "Wesley Andrade",
    stage_id: "s-perdido",
    source: "meta_ads",
    value_cents: 0,
    contato: { name: "Wesley Andrade", phone: "11987650099", email: null },
    owner: null,
    criadoHa: 200,
    lost_reason: "fora_da_regiao",
    external_id: "fb-lead-87990",
  },
  {
    id: "l-10",
    title: "Sem nome informado",
    stage_id: "s-perdido",
    source: "meta_ads",
    value_cents: 0,
    contato: { name: "Sem nome informado", phone: "48900000000", email: null },
    owner: null,
    criadoHa: 210,
    lost_reason: "dado_falso",
    external_id: "fb-lead-87991",
  },
  {
    id: "l-11",
    title: "Tainá Ribeiro",
    stage_id: "s-perdido",
    source: "meta_ads",
    value_cents: 0,
    contato: { name: "Tainá Ribeiro", phone: "48993310110", email: null },
    owner: null,
    criadoHa: 260,
    lost_reason: "so_curiosidade",
  },
  {
    /* Descarte que NÃO acusa a segmentação — é o contraponto que faz o
       cartão de segmentação significar alguma coisa. */
    id: "l-12",
    title: "Otávio Brand",
    stage_id: "s-perdido",
    source: "google_ads",
    value_cents: 0,
    contato: { name: "Otávio Brand", phone: "47996520121", email: null },
    owner: "u-marina",
    criadoHa: 330,
    lost_reason: "sem_retorno",
    notas: 1,
  },
];

const PESSOAS: Record<string, { id: string; full_name: string }> = {
  "u-admin": { id: "u-admin", full_name: "Guilherme Casagrande" },
  "u-marina": { id: "u-marina", full_name: "Marina Duarte" },
};

/* ------------------------------------------------------------------ */

/**
 * Um quadro por cliente, criado na primeira visita e guardado.
 *
 * POR QUE UM MAPA, e não um array fixo: a tela do admin tem seletor de
 * cliente, e trocar de conta em modo demo não pode cair num quadro
 * vazio. Guardar o resultado é o que faz as mutações do demo
 * (arrastar, descartar, anotar) sobreviverem à navegação — recriar o
 * molde a cada chamada desfaria tudo a cada `revalidatePath`.
 */
const QUADROS = new Map<string, LeadBoard>();

export const notasDemo: (LeadNote & {
  author: { id: string; full_name: string } | null;
})[] = [];

export const tarefasDemo: LeadTask[] = [];

function montar(clientId: string): LeadBoard {
  const pipelineId = `p-${clientId}`;

  const stages: LeadStage[] = ETAPAS_DEMO.map((e) => ({
    ...e,
    id: `${e.id}-${clientId}`,
    pipeline_id: pipelineId,
  }));

  const leads: LeadWithRelations[] = SEMENTES.map((s, indice) => {
    const criado = horasAtras(s.criadoHa);
    const dealId = `${s.id}-${clientId}`;

    for (let n = 0; n < (s.notas ?? 0); n += 1) {
      const autor = n % 2 === 0 ? PESSOAS["u-marina"] : PESSOAS["u-admin"];
      notasDemo.push({
        id: `n-${dealId}-${n}`,
        deal_id: dealId,
        author_id: autor.id,
        body:
          n === 0
            ? "Atendeu de primeira. Já conhecia a marca e pediu para receber os valores por WhatsApp."
            : "Retornei hoje: pediu para falar com o marido antes de decidir.",
        created_at: horasAtras(s.criadoHa - (n + 1) * 6),
        author: autor,
      });
    }

    const abertas: LeadWithRelations["openTasks"] = [];
    for (const [i, t] of (s.tarefas ?? []).entries()) {
      const tarefa: LeadTask = {
        id: `t-${dealId}-${i}`,
        deal_id: dealId,
        title: t.title,
        due_at: t.vence < 0 ? diasAtras(-t.vence) : diasAFrente(t.vence),
        assignee_id: s.owner,
        done_at: t.feita ? diasAtras(1) : null,
        created_by: s.owner,
        created_at: criado,
      };
      tarefasDemo.push(tarefa);
      if (!tarefa.done_at) {
        abertas.push({ id: tarefa.id, title: tarefa.title, due_at: tarefa.due_at });
      }
    }

    const dono = s.owner ? PESSOAS[s.owner] : null;
    const etapa = stages.find((e) => e.id === `${s.stage_id}-${clientId}`)!;

    return {
      id: dealId,
      client_id: clientId,
      pipeline_id: pipelineId,
      stage_id: etapa.id,
      contact_id: s.contato ? `ct-${dealId}` : null,
      title: s.title,
      value_cents: s.value_cents,
      source: s.source,
      owner_id: s.owner,
      /* Passo largo e decrescente: o quadro ordena por posição e o
         arraste calcula o ponto médio entre vizinhos. */
      position: (SEMENTES.length - indice) * 1000,
      closed_at: etapa.kind === "aberto" ? null : horasAtras(s.criadoHa - 12),
      lost_reason: s.lost_reason ?? null,
      external_id: s.external_id ?? null,
      created_by: "u-admin",
      created_at: criado,
      updated_at: criado,
      contact: s.contato
        ? {
            id: `ct-${dealId}`,
            client_id: clientId,
            name: s.contato.name,
            phone: s.contato.phone,
            email: s.contato.email,
            notes: null,
            created_at: criado,
            updated_at: criado,
          }
        : null,
      owner: dono ? { ...dono, avatar_url: null } : null,
      noteCount: s.notas ?? 0,
      openTasks: abertas,
    };
  });

  return {
    pipeline: {
      id: pipelineId,
      client_id: clientId,
      name: "Funil de vendas",
      is_default: true,
      position: 0,
      created_at: diasAtras(60),
      updated_at: diasAtras(60),
    },
    stages,
    leads,
  };
}

export function boardDemo(clientId: string): LeadBoard {
  let board = QUADROS.get(clientId);
  if (!board) {
    board = montar(clientId);
    QUADROS.set(clientId, board);
  }
  return board;
}

/** O quadro já montado, para as actions mexerem sem recriá-lo. */
export function quadrosDemo(): Map<string, LeadBoard> {
  return QUADROS;
}

/** Acha um lead em qualquer quadro já aberto. */
export function acharLeadDemo(dealId: string): LeadWithRelations | null {
  for (const board of QUADROS.values()) {
    const achado = board.leads.find((l) => l.id === dealId);
    if (achado) return achado;
  }
  return null;
}

export function historicoDemo(dealId: string) {
  return {
    notes: notasDemo
      .filter((n) => n.deal_id === dealId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    tasks: tarefasDemo
      .filter((t) => t.deal_id === dealId)
      .sort((a, b) => a.due_at.localeCompare(b.due_at)),
  };
}
