/* =====================================================================
   Tipos do CRM do cliente
   ---------------------------------------------------------------------
   Vivem AQUI e não em `types/database.ts` por uma razão de convivência:
   aquele arquivo está sendo editado por outra frente de trabalho neste
   mesmo repositório, e duas mãos no mesmo arquivo produzem conflito onde
   não havia sobreposição nenhuma. Quando as duas frentes assentarem,
   isto migra para lá numa mudança só.
   ===================================================================== */

/** O que uma etapa significa para o funil — decide cor e fechamento. */
export type LeadStageKind = "aberto" | "ganho" | "perdido";

export type LeadSource =
  | "manual"
  | "meta_ads"
  | "google_ads"
  | "whatsapp"
  | "instagram"
  | "site"
  | "indicacao"
  | "telefone"
  | "outro";

export interface LeadPipeline {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  position: number;
}

export interface LeadStage {
  id: string;
  pipeline_id: string;
  name: string;
  kind: LeadStageKind;
  color: string;
  position: number;
}

export interface LeadContact {
  id: string;
  client_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface LeadDeal {
  id: string;
  client_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  title: string;
  value_cents: number;
  source: LeadSource;
  owner_id: string | null;
  position: number;
  closed_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
  /* Vêm do join, para o card não precisar de uma segunda consulta. */
  contact?: Pick<LeadContact, "id" | "name" | "phone" | "email"> | null;
  owner?: { id: string; full_name: string; avatar_url: string | null } | null;
}

export interface LeadNote {
  id: string;
  deal_id: string;
  body: string;
  created_at: string;
  author?: { id: string; full_name: string; avatar_url: string | null } | null;
}

/** Rótulo de cada origem, na voz de quem lê o card. */
export const ROTULO_ORIGEM: Record<LeadSource, string> = {
  manual: "Cadastrado à mão",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site: "Site",
  indicacao: "Indicação",
  telefone: "Telefone",
  outro: "Outro",
};

/**
 * Passo largo entre posições.
 *
 * Mover um card entre dois vizinhos consecutivos precisa de um número
 * livre no meio. Com passo 1, toda inserção obrigaria a renumerar a
 * coluna inteira — e renumerar é uma escrita por card, num arrastar que
 * precisa parecer instantâneo.
 */
export const PASSO_DE_POSICAO = 1000;

/**
 * A posição de um card solto entre dois outros.
 *
 * `null` de um lado significa ponta da coluna. Quando os dois vizinhos
 * ficam colados (diferença 1), devolve `null` para quem chama saber que
 * é hora de renumerar aquela coluna — raro, e o único caso em que a
 * conta simples não serve.
 */
export function posicaoEntre(
  anterior: number | null,
  proxima: number | null,
): number | null {
  if (anterior === null && proxima === null) return PASSO_DE_POSICAO;
  if (anterior === null) return (proxima as number) - PASSO_DE_POSICAO;
  if (proxima === null) return anterior + PASSO_DE_POSICAO;

  if (proxima - anterior <= 1) return null;
  return Math.floor((anterior + proxima) / 2);
}
