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

/**
 * A mesma resposta, para a carteira inteira, em DUAS consultas.
 *
 * POR QUE ISTO PRECISOU EXISTIR. `tiposDeConversaoDoCliente` faz duas
 * idas ao banco por cliente, e ela foi colocada dentro de
 * `getMetricsWithComparison` — que roda UMA VEZ POR CLIENTE em
 * /performance e no painel do colaborador. Com 61 clientes isso
 * transformou 123 consultas em 245.
 *
 * Medido contra o banco real em 26/08/2026:
 *
 *     245 consultas (como ficou)          1.834ms
 *     123 consultas (como era antes)        303ms
 *     os mesmos dados em lote, 2 consultas   146ms
 *
 * Um segundo e meio para buscar segmento e ação de conversão de 61
 * clientes, um de cada vez, quando tudo cabe em duas consultas. O laço
 * era `Promise.all`, então nem era serial — o custo é a quantidade de
 * round-trips, não a ordem deles.
 *
 * Devolve um Map pronto para consulta por id. Cliente ausente do mapa
 * cai no padrão do segmento, como se tivesse sido perguntado sozinho.
 */
export async function tiposDeConversaoDaCarteira(): Promise<
  Map<string, string[]>
> {
  const mapa = new Map<string, string[]>();

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    for (const c of demoClients) {
      mapa.set(c.id, conversionActionFor(c.segment, null));
    }
    return mapa;
  }

  const admin = createSupabaseAdminClient();

  const [{ data: clientes }, { data: integracoes }] = await Promise.all([
    admin.from("clients").select("id, segment"),
    admin
      .from("client_integrations")
      .select("client_id, conversion_action_type")
      .eq("platform", "meta_ads"),
  ]);

  const override = new Map(
    (integracoes ?? []).map((i) => [i.client_id, i.conversion_action_type]),
  );

  for (const c of clientes ?? []) {
    mapa.set(c.id, conversionActionFor(c.segment, override.get(c.id)));
  }

  return mapa;
}
