import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContentBriefWithRelations } from "@/types/database";

/* =====================================================================
   Leitura dos briefs de conteúdo
   ---------------------------------------------------------------------
   Fica aqui, e não em `lib/data.ts`, pelo mesmo motivo de
   `lib/reports/source.ts`: é a consulta de um módulo fechado, que só as
   telas dele usam. `data.ts` é o acervo compartilhado — dashboard,
   clientes e relatórios leem de lá.

   Duas portas, e a diferença entre elas é de segurança, não de gosto:

     `getContentBrief*`   chave ANON + JWT do usuário. A RLS decide.
     `getBriefPorToken`   service role. Não há usuário. Ver abaixo.
   ===================================================================== */

const SELECT = `
  *,
  client:clients(id, name, brand_primary, logo_url),
  author:profiles!content_briefs_created_by_fkey(id, full_name, avatar_url)
`;

export async function getContentBriefs(options?: {
  clientId?: string;
}): Promise<ContentBriefWithRelations[]> {
  if (isDemoMode) {
    const { demoContentBriefs } = await import("@/lib/mock/content");
    return options?.clientId
      ? demoContentBriefs.filter((b) => b.client_id === options.clientId)
      : demoContentBriefs;
  }

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("content_briefs")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (options?.clientId) query = query.eq("client_id", options.clientId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as unknown as ContentBriefWithRelations[];
}

export async function getContentBrief(
  id: string,
): Promise<ContentBriefWithRelations | null> {
  if (isDemoMode) {
    const { demoContentBriefs } = await import("@/lib/mock/content");
    return demoContentBriefs.find((b) => b.id === id) ?? null;
  }

  const supabase = await createSupabaseServerClient();

  /* `maybeSingle`, não `single`: id inexistente — ou existente mas fora
     da carteira de quem pediu — é 404, não erro 500. `single` levanta
     PGRST116 e a página quebraria em vez de mostrar "não encontrado". */
  const { data, error } = await supabase
    .from("content_briefs")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as ContentBriefWithRelations) ?? null;
}

/**
 * O documento por trás do link público.
 *
 * SERVICE ROLE de propósito, e é a decisão mais delicada deste módulo.
 *
 * A alternativa seria dar à role `anon` uma policy do tipo
 * `using (share_token is not null)`. Ela funcionaria — e permitiria a
 * qualquer pessoa com a chave anônima (que vai no bundle do browser,
 * por definição) fazer um `select *` sem filtro e baixar de uma vez o
 * planejamento de conteúdo de TODOS os clientes que já compartilharam
 * algum documento. RLS filtra linha, não impede varredura.
 *
 * Com a service role, o filtro pelo token acontece aqui, no servidor, e
 * a única linha que sai é a de quem tem o token. As três travas:
 *
 *   1. o token vem da URL e é comparado com `eq`, nunca com `like`;
 *   2. token vazio ou curto é recusado antes de tocar no banco — sem
 *      isso, um `/c/` sem nada casaria com a primeira linha nula;
 *   3. documento arquivado não abre, mesmo com token válido: arquivar é
 *      justamente o gesto de tirar de circulação.
 */
export async function getBriefPorToken(
  token: string,
): Promise<ContentBriefWithRelations | null> {
  const limpo = token?.trim() ?? "";
  if (limpo.length < 16) return null;

  if (isDemoMode) {
    const { demoContentBriefs } = await import("@/lib/mock/content");
    const achado = demoContentBriefs.find((b) => b.share_token === limpo);
    return achado && achado.status !== "arquivado" ? achado : null;
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("content_briefs")
    .select(SELECT)
    .eq("share_token", limpo)
    .neq("status", "arquivado")
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as ContentBriefWithRelations) ?? null;
}
