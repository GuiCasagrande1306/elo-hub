import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  LeadBoard,
  LeadPipeline,
  LeadStage,
  LeadTask,
  LeadWithRelations,
} from "@/types/database";

/* =====================================================================
   Leitura do CRM de leads
   ---------------------------------------------------------------------
   Módulo fechado, como `lib/content/queries.ts`: só as telas de `/leads`
   leem daqui. `lib/data.ts` continua sendo o acervo compartilhado.

   TODA consulta usa a chave ANON com o JWT de quem está logado, então
   quem decide o que volta é a RLS (`lead_*_rw`, migration 56), que por
   sua vez pergunta `app.client_is_visible`. Não existe filtro de
   segurança escrito em TypeScript neste arquivo — o `.eq("client_id",…)`
   abaixo é para não trazer a carteira inteira quando um admin abre a
   tela, não para conter ninguém.
   ===================================================================== */

/**
 * Quantos leads o quadro carrega de uma vez.
 *
 * Um quadro Kanban com mais de mil cartões já não é uma tela que alguém
 * lê — e as etapas fechadas ('Ganho', 'Perdido') acumulam para sempre.
 * O corte é por `created_at` decrescente, então o que fica de fora é o
 * histórico antigo, não o trabalho de hoje.
 */
const TETO_DE_LEADS = 600;

const SELECT_LEAD = `
  *,
  contact:lead_contacts(*),
  owner:profiles!lead_deals_owner_id_fkey(id, full_name, avatar_url),
  lead_notes(count),
  lead_tasks(id, title, due_at, done_at)
`;

/**
 * O funil padrão do cliente, criado se ainda não existir.
 *
 * `criar_funil_padrao` é idempotente e `security invoker` (migration
 * 60): quem não enxerga o cliente não consegue criar funil nele, porque
 * o INSERT lá dentro passa pela mesma policy de todo o resto.
 *
 * ⚠️ A função vive em `public` de propósito — o PostgREST não enxerga o
 * schema `app`. Chamar `app.criar_funil_padrao` daqui devolve 404
 * PGRST202 e a tela mostra um quadro vazio sem dizer por quê.
 */
async function garantirFunil(clientId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("criar_funil_padrao", {
    p_client: clientId,
  });

  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Tudo que o quadro precisa, numa chamada por tabela.
 *
 * Devolve `null` quando o cliente não tem funil E não foi possível criar
 * um — o que só acontece se a RLS recusar, ou seja, se quem pediu não
 * enxerga aquele cliente. A tela trata como "nada para mostrar aqui" em
 * vez de estourar.
 */
export async function getLeadBoard(clientId: string): Promise<LeadBoard | null> {
  if (isDemoMode) {
    const { boardDemo } = await import("@/lib/mock/leads");
    return boardDemo(clientId);
  }

  const pipelineId = await garantirFunil(clientId);
  if (!pipelineId) return null;

  const supabase = await createSupabaseServerClient();

  const [pipelineRes, stagesRes, leadsRes] = await Promise.all([
    supabase.from("lead_pipelines").select("*").eq("id", pipelineId).single(),

    supabase
      .from("lead_stages")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true }),

    supabase
      .from("lead_deals")
      .select(SELECT_LEAD)
      .eq("client_id", clientId)
      .eq("pipeline_id", pipelineId)
      .order("created_at", { ascending: false })
      .limit(TETO_DE_LEADS),
  ]);

  if (pipelineRes.error) throw pipelineRes.error;
  if (stagesRes.error) throw stagesRes.error;
  if (leadsRes.error) throw leadsRes.error;

  return {
    pipeline: pipelineRes.data as unknown as LeadPipeline,
    stages: (stagesRes.data ?? []) as unknown as LeadStage[],
    leads: (leadsRes.data ?? []).map(normalizarLead),
  };
}

/**
 * Achata os embeds do PostgREST no formato que a tela usa.
 *
 * ⚠️ AS TAREFAS SÃO FILTRADAS AQUI, e não na query. Dá para filtrar um
 * recurso embutido no PostgREST (`lead_tasks.done_at=is.null`), mas o
 * filtro em embed é silencioso quando a sintaxe não casa: em vez de
 * erro, volta a lista sem filtrar. Como o volume por lead é de algumas
 * linhas, filtrar em memória custa nada e não depende de uma sintaxe que
 * falha para o lado errado.
 */
function normalizarLead(row: unknown): LeadWithRelations {
  const {
    lead_notes,
    lead_tasks,
    contact,
    ...lead
  } = row as Record<string, unknown> & {
    lead_notes: { count: number }[] | null;
    lead_tasks: LeadTask[] | null;
    /* Embed de FK simples volta OBJETO, não array — `contact_id` aponta
       para uma linha só. Tratar como array aqui produziria `contact`
       sempre nulo, e o telefone sumiria do cartão sem erro nenhum. */
    contact: unknown;
  };

  const abertas = (lead_tasks ?? [])
    .filter((t) => !t.done_at)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at }));

  return {
    ...lead,
    contact: (contact ?? null) as LeadWithRelations["contact"],
    noteCount: lead_notes?.[0]?.count ?? 0,
    openTasks: abertas,
  } as LeadWithRelations;
}

/**
 * Histórico de um lead, sob demanda.
 *
 * Fora do `getLeadBoard` pelo mesmo motivo das atividades do CRM
 * comercial: são até algumas dezenas de linhas por lead, e o quadro
 * mostra centenas de cartões. Só quem abre a ficha paga por isso.
 */
export async function getLeadHistory(dealId: string): Promise<{
  notes: (import("@/types/database").LeadNote & {
    author: { id: string; full_name: string } | null;
  })[];
  tasks: LeadTask[];
}> {
  if (!dealId) return { notes: [], tasks: [] };

  if (isDemoMode) {
    const { historicoDemo } = await import("@/lib/mock/leads");
    return historicoDemo(dealId);
  }

  const supabase = await createSupabaseServerClient();

  const [notesRes, tasksRes] = await Promise.all([
    supabase
      .from("lead_notes")
      .select(`*, author:profiles!lead_notes_author_id_fkey(id, full_name)`)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(200),

    supabase
      .from("lead_tasks")
      .select("*")
      .eq("deal_id", dealId)
      .order("due_at", { ascending: true })
      .limit(100),
  ]);

  return {
    notes: (notesRes.data ?? []) as unknown as Awaited<
      ReturnType<typeof getLeadHistory>
    >["notes"],
    tasks: (tasksRes.data ?? []) as unknown as LeadTask[],
  };
}
