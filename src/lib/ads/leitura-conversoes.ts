import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { resumir, type ResumoDeConversoes } from "./categorias-google";

/**
 * As conversões do Google de um cliente, já classificadas.
 *
 * `null` quando a conta não tem nenhuma linha na janela — e isso é
 * diferente de "teve zero conversões". A tela não desenha a seção no
 * primeiro caso e desenha vazia no segundo, porque "ainda não
 * coletamos" e "não houve" pedem reações opostas.
 *
 * `null` TAMBÉM no erro, com o motivo no log: a seção é complemento da
 * ficha, e derrubar a página do cliente por causa dela trocaria um
 * número a menos por nenhuma página.
 */
export async function conversoesDoGoogle(
  clientId: string,
  inicio: string,
  fim: string,
): Promise<ResumoDeConversoes | null> {
  if (isDemoMode) {
    const { demoConversoesGoogle } = await import("@/lib/mock/data");
    return resumir(demoConversoesGoogle);
  }

  try {
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("google_conversion_daily")
      .select("category, all_conversions")
      .eq("client_id", clientId)
      .gte("metric_date", inicio)
      .lte("metric_date", fim);

    if (error) {
      console.error("[conversões google]", error.message);
      return null;
    }
    if (!data || data.length === 0) return null;

    return resumir(
      (data as { category: string | null; all_conversions: number }[]).map((l) => ({
        category: l.category,
        /* `numeric` do Postgres chega como string no PostgREST. Sem o
           Number, a soma vira concatenação de texto e o painel mostra
           "169" para 1 + 6 + 9. */
        allConversions: Number(l.all_conversions),
      })),
    );
  } catch {
    return null;
  }
}
