import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContentBrief } from "@/types/database";

/**
 * O documento para a página que vira PDF.
 *
 * SERVICE ROLE, e num arquivo separado de propósito: é a única leitura
 * de brief que ignora a RLS, e ela precisa ser fácil de achar quando
 * alguém for auditar quem alcança esta tabela sem sessão.
 *
 * Quem autoriza é o token HMAC verificado NA ROTA, antes de esta função
 * ser chamada. Por isso ela não recebe usuário nenhum: no momento em
 * que roda, o único visitante é o Chromium do próprio servidor.
 *
 * ⚠️ Nunca chamar daqui de outro lugar sem repetir a verificação do
 * token. `import "server-only"` impede que a chave vaze para o browser
 * — não substitui a checagem de permissão.
 */
export async function getBriefParaImpressao(
  id: string,
): Promise<ContentBrief | null> {
  if (isDemoMode) {
    const { demoContentBriefs } = await import("@/lib/mock/content");
    return demoContentBriefs.find((b) => b.id === id) ?? null;
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("content_briefs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as ContentBrief) ?? null;
}
