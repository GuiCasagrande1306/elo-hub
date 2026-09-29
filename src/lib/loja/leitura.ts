import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { ticketMedio } from "./status-pago";

/* =====================================================================
   O faturamento da loja no período
   ---------------------------------------------------------------------
   ⚠️ `null` QUANDO O CLIENTE NÃO TEM LOJA, e é isso que mantém os
   outros clientes intactos. A integração é por cliente: quem não tiver
   linha em `store_integrations` recebe `null`, e toda tela que consome
   isto simplesmente não desenha a seção — nenhuma bandeira global,
   nenhum "se for e-commerce", nenhum efeito colateral nos outros
   quarenta clientes da carteira.

   ⚠️ E `null` TAMBÉM QUANDO NÃO HÁ DADO NO PERÍODO, pelo mesmo motivo
   de sempre: zero pedidos e zero faturamento afirmam que a loja não
   vendeu nada, o que é diferente de "ainda não sincronizamos esta
   janela". A distinção existe em todo lugar neste projeto e aqui ela
   vale o número que a agência apresenta como resultado.

   ESTE NÚMERO É A LOJA INTEIRA — orgânico, direto, marketplace, cliente
   recorrente. Não é a receita atribuída ao anúncio, que continua em
   `daily_metrics.revenue_cents`. Quem desenha os dois no mesmo quadro
   precisa dizer qual é qual; ver `retornoDaLoja` abaixo.
   ===================================================================== */

export interface TotaisDaLoja {
  pedidosPagos: number;
  receitaCents: number;
  /** Receita ÷ pedidos. `null` sem pedido — nunca R$ 0,00. */
  ticketMedioCents: number | null;
  /** Cancelados e em análise. Fora do faturamento, visível à equipe. */
  pedidosDescartados: number;
  /** Último dia do período com linha gravada. Para a tarja de cobertura. */
  ultimoDiaComDado: string | null;
}

export async function totaisDaLoja(
  clientId: string,
  inicio: string,
  fim: string,
): Promise<TotaisDaLoja | null> {
  if (isDemoMode) {
    return {
      pedidosPagos: 150,
      receitaCents: 8_836_799,
      ticketMedioCents: 58_912,
      pedidosDescartados: 37,
      ultimoDiaComDado: fim,
    };
  }

  try {
    const admin = createSupabaseAdminClient();

    /* A PORTA DE ENTRADA: sem integração ativa, nem consulta o resto.
       É o que garante que este trabalho não toque em cliente nenhum
       além dos que têm loja cadastrada. */
    const { data: integracao } = await admin
      .from("store_integrations")
      .select("id")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .maybeSingle();

    if (!integracao) return null;

    const { data, error } = await admin
      .from("store_daily")
      .select("metric_date, orders_paid, revenue_cents, orders_dropped")
      .eq("client_id", clientId)
      .gte("metric_date", inicio)
      .lte("metric_date", fim)
      .order("metric_date", { ascending: true });

    if (error) return null;

    const linhas = (data ?? []) as {
      metric_date: string;
      orders_paid: number;
      revenue_cents: number;
      orders_dropped: number;
    }[];

    // Sem linha nenhuma = janela não apurada. Ver a nota do cabeçalho.
    if (linhas.length === 0) return null;

    const pedidosPagos = linhas.reduce((a, l) => a + l.orders_paid, 0);
    const receitaCents = linhas.reduce((a, l) => a + l.revenue_cents, 0);

    return {
      pedidosPagos,
      receitaCents,
      ticketMedioCents: ticketMedio(receitaCents, pedidosPagos),
      pedidosDescartados: linhas.reduce((a, l) => a + l.orders_dropped, 0),
      ultimoDiaComDado: linhas[linhas.length - 1]?.metric_date ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Retorno sobre a loja: faturamento da loja ÷ investimento em anúncio.
 *
 * ⚠️ ISTO NÃO É ROAS, E O NOME PRECISA DIZER ISSO. O `roas` do projeto
 * divide a receita ATRIBUÍDA pelo gasto da CAMPANHA DE ORIGEM — mede o
 * anúncio. Este aqui divide a loja inteira pelo investimento total:
 * inclui venda orgânica, direta, de marketplace e de cliente
 * recorrente, que aconteceriam com ou sem anúncio.
 *
 * O número sai muito maior, e é legítimo desde que chamado pelo que é.
 * Imprimi-lo sob o rótulo "ROAS" faria o cliente ler 12 onde o anúncio
 * entregou 3 — e essa é exatamente a classe de erro que esta base já
 * cometeu com o alcance calculado como `impressões × 0,62`.
 *
 * `null` sem investimento: dividir por zero daria `Infinity` impresso.
 */
export function retornoDaLoja(
  receitaDaLojaCents: number,
  investimentoCents: number,
): number | null {
  if (investimentoCents <= 0) return null;
  return receitaDaLojaCents / investimentoCents;
}

/**
 * Quais clientes têm loja integrada — UMA consulta para a carteira.
 *
 * ⚠️ EXISTE PARA NÃO DOBRAR AS CONSULTAS DA LISTA. `getClientsWithGoals`
 * já faz uma busca de métrica por cliente dentro do laço; chamar
 * `totaisDaLoja` ali dentro somaria duas por conta — 114 consultas para
 * atender uma loja. Com este conjunto em mãos, o laço só consulta quem
 * realmente tem loja, que hoje é um cliente.
 */
export async function clientesComLoja(): Promise<Set<string>> {
  if (isDemoMode) return new Set();

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("store_integrations")
      .select("client_id")
      .eq("is_active", true);

    if (error) return new Set();
    return new Set((data ?? []).map((l) => (l as { client_id: string }).client_id));
  } catch {
    return new Set();
  }
}

/**
 * Só a receita da loja no período, sem o resto.
 *
 * Versão enxuta de `totaisDaLoja` para quem já sabe que o cliente tem
 * loja — pula a consulta de existência. `null` quando não há dado na
 * janela, e quem chama mantém o número que tinha.
 */
export async function receitaDaLoja(
  clientId: string,
  inicio: string,
  fim: string,
): Promise<number | null> {
  if (isDemoMode) return null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("store_daily")
      .select("revenue_cents")
      .eq("client_id", clientId)
      .gte("metric_date", inicio)
      .lte("metric_date", fim);

    if (error || !data || data.length === 0) return null;
    return (data as { revenue_cents: number }[]).reduce(
      (a, l) => a + l.revenue_cents,
      0,
    );
  } catch {
    return null;
  }
}
