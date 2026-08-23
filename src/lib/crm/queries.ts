import "server-only";

import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import type {
  LeadContact,
  LeadDeal,
  LeadPipeline,
  LeadStage,
} from "./types";

/* =====================================================================
   Leitura do quadro
   ---------------------------------------------------------------------
   TUDO SOB RLS, sem exceção e sem service_role. É o ponto do sistema em
   que dado de um cliente não pode encostar no de outro, e a contenção
   foi provada com dois usuários reais em 22/08/2026: cliente A lê 1 de
   61 contas, zero linhas de terceiros, e recebe 403 ao tentar gravar na
   empresa alheia.

   Usar `service_role` aqui para "simplificar" jogaria fora essa prova e
   deixaria a separação por conta de um `where` escrito à mão — que é
   exatamente o tipo de coisa que se esquece numa consulta nova.
   ===================================================================== */

export interface QuadroDoCrm {
  clientId: string;
  pipeline: LeadPipeline | null;
  stages: LeadStage[];
  deals: LeadDeal[];
  contacts: LeadContact[];
}

/**
 * O cliente cuja base a pessoa logada está olhando.
 *
 * Usuário de cliente não escolhe: é sempre a própria empresa, e ignorar
 * o parâmetro aqui é o que impede que trocar o `?cliente=` na barra de
 * endereço vire uma tentativa de espiar outra conta. A RLS barraria de
 * qualquer forma — esta é a segunda tranca, não a primeira.
 */
export async function clienteDoQuadro(
  pedido?: string | null,
): Promise<{ clientId: string | null; ehCliente: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { clientId: null, ehCliente: false };

  const ehCliente = user.role === "client";
  if (ehCliente) {
    return { clientId: user.client_id ?? null, ehCliente: true };
  }

  return { clientId: pedido ?? null, ehCliente: false };
}

/**
 * O quadro inteiro numa ida só.
 *
 * Quatro consultas em paralelo em vez de uma com joins aninhados: o
 * PostgREST devolveria etapas repetidas dentro de cada negócio, e a
 * montagem no cliente ficaria com a mesma etapa em cinco cópias
 * divergindo assim que alguém a renomeasse.
 */
export async function carregarQuadro(
  clientId: string,
): Promise<QuadroDoCrm> {
  const supabase = await createSupabaseServerClient();

  const { data: pipelines, error: erroPipe } = await supabase
    .from("lead_pipelines")
    .select("id, client_id, name, is_default, position")
    .eq("client_id", clientId)
    .order("position");

  if (erroPipe) throw new Error(`CRM: funis — ${erroPipe.message}`);

  const pipeline = (pipelines?.[0] ?? null) as LeadPipeline | null;

  if (!pipeline) {
    return { clientId, pipeline: null, stages: [], deals: [], contacts: [] };
  }

  const [
    { data: stages, error: erroStages },
    { data: deals, error: erroDeals },
    { data: contacts, error: erroContacts },
  ] = await Promise.all([
    supabase
      .from("lead_stages")
      .select("id, pipeline_id, name, kind, color, position")
      .eq("pipeline_id", pipeline.id)
      .order("position"),
    supabase
      .from("lead_deals")
      .select(
        /* `profiles!lead_deals_owner_id_fkey` e não `profiles`: a tabela
           aponta para perfis DUAS vezes — `owner_id` e `created_by` —
           e o PostgREST recusa o embed ambíguo com "more than one
           relationship was found". Nomear a chave estrangeira é a
           única forma de dizer qual das duas se quer.

           Medido em 23/08/2026: o erro derrubava a página inteira no
           primeiro quadro com funil criado, para qualquer papel. */
        "id, client_id, pipeline_id, stage_id, contact_id, title, value_cents, source, owner_id, position, closed_at, lost_reason, created_at, updated_at, contact:lead_contacts(id, name, phone, email), owner:profiles!lead_deals_owner_id_fkey(id, full_name, avatar_url)",
      )
      .eq("pipeline_id", pipeline.id)
      .order("position"),
    supabase
      .from("lead_contacts")
      .select("id, client_id, name, phone, email, notes")
      .eq("client_id", clientId)
      .order("name"),
  ]);

  /* Erro NÃO vira lista vazia — um quadro em branco por falha de
     consulta é indistinguível de um funil sem leads, e o segundo é
     estado normal. */
  const falha = erroStages ?? erroDeals ?? erroContacts;
  if (falha) throw new Error(`CRM: leitura recusada — ${falha.message}`);

  return {
    clientId,
    pipeline,
    stages: (stages ?? []) as LeadStage[],
    deals: (deals ?? []) as unknown as LeadDeal[],
    contacts: (contacts ?? []) as LeadContact[],
  };
}
