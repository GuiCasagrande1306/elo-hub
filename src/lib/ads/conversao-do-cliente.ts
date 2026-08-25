import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { conversionActionFor } from "./conversion-action";

/* =====================================================================
   Que conversão esta conta mede
   ---------------------------------------------------------------------
   `conversionActionFor` já responde isso, mas precisa de dois dados que
   moram em tabelas diferentes: o segmento do cliente e o override da
   integração. Quem calcula KPI não deveria ter que saber disso, e antes
   deste arquivo cada chamador buscava do seu jeito — ou não buscava.

   O RESULTADO É O MESMO DO SYNC, e tem de ser: é ele que decide quais
   `action_type` viram a coluna `conversions` em `daily_metrics`. Se a
   leitura divergir da escrita, o isolamento por campanha de origem
   procura a família errada e o custo por resultado sai do denominador
   errado — em silêncio, porque o número continua plausível.
   ===================================================================== */

/**
 * O override do Meta ganha do segmento; sem override, vale o segmento.
 *
 * SÓ O META tem override consultado aqui. O Google não passa por
 * `campanha-de-origem` de verdade — as linhas dele vêm sem objetivo e
 * caem no ramo "não sei" da regra —, então um segundo override não
 * mudaria conta nenhuma e faria esta função devolver duas listas para
 * um cliente que tem uma métrica só.
 */
export async function tiposDeConversaoDoCliente(
  clientId: string,
): Promise<string[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const cliente = demoClients.find((c) => c.id === clientId);
    return conversionActionFor(cliente?.segment, null);
  }

  const admin = createSupabaseAdminClient();

  const [{ data: cliente }, { data: integracao }] = await Promise.all([
    admin.from("clients").select("segment").eq("id", clientId).maybeSingle(),
    admin
      .from("client_integrations")
      .select("conversion_action_type")
      .eq("client_id", clientId)
      .eq("platform", "meta_ads")
      .maybeSingle(),
  ]);

  return conversionActionFor(
    cliente?.segment,
    integracao?.conversion_action_type,
  );
}
