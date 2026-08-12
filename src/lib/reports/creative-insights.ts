import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { conversionActionFor } from "@/lib/ads/conversion-action";
import { fetchAdInsights, type AdInsight } from "@/lib/ads/meta-ads";
import { normalizeCustomerId } from "@/lib/ads/normalize";

/* =====================================================================
   Desempenho dos criativos NA JANELA DO RELATÓRIO
   ---------------------------------------------------------------------
   ⚠️ POR QUE ISTO EXISTE, e por que ler o banco não bastava.

   `ad_creatives` guarda UMA linha por anúncio, sobrescrita por upsert a
   cada sincronização. Os números que estão lá são os da ÚLTIMA janela
   sincronizada — o mês corrente. Um relatório de agosto gerado em
   setembro mostrava, na galeria de anúncios, o investimento de setembro.

   Pior no dia 1º de cada mês: a janela do sync é só o próprio dia 1, os
   insights voltam quase vazios, e o `spend_cents` de TODOS os criativos
   é sobrescrito para perto de zero. O relatório saía com "Investido
   R$ 0,00" em cada anúncio.

   A tabela é uma FOTO, não uma série temporal — não há como recuperar do
   banco o que cada anúncio gastou num período passado. Por isso a
   consulta é feita à Graph API, com a janela exata do relatório.

   ⚠️ MAPA VAZIO NÃO É ZERO. `fetchAdInsights` engole qualquer erro —
   rede, token vencido, conta sem Meta — e devolve Map vazio; o
   sincronizador converte isso em `?? 0`. Repetir esse padrão aqui
   reproduziria exatamente o defeito que este arquivo conserta: uma falha
   de rede viraria "R$ 0,00" impresso com confiança no documento do
   cliente. Aqui, falha devolve `null`, e quem chama mantém o que tinha e
   avisa na tela de onde vieram os números.
   ===================================================================== */

export interface MetricasDeCriativo {
  spendCents: number;
  conversions: number;
  impressions: number;
  clicks: number;
}

/**
 * Métricas por `external_ad_id` na janela pedida.
 *
 * `null` quando não deu para apurar: conta sem integração Meta, sem
 * token, ou a chamada falhou. Nunca devolve um mapa vazio como se
 * significasse "gastou zero".
 *
 * TIMEOUT CURTO de propósito. O padrão do módulo é 25s, pensado para a
 * sincronização noturna; aqui há alguém esperando na tela, e no cron o
 * orçamento é de ~37s para TODOS os relatórios do dia. Uma conta lenta
 * não pode custar o relatório das outras — melhor a galeria sair
 * rotulada do que a fila inteira ser adiada.
 */
export async function metricasDeCriativosNoPeriodo(
  clientId: string,
  since: string,
  until: string,
  timeoutMs = 7_000,
): Promise<Map<string, MetricasDeCriativo> | null> {
  try {
    /* Cliente ADMIN: o token vive em `integration_secrets`, tabela com
       RLS ligada e ZERO policies — nenhuma sessão de usuário alcança.
       A autorização de quem pediu o relatório já aconteceu antes, na
       resolução do cliente, que roda sob RLS. */
    const admin = createSupabaseAdminClient();

    const { data } = await admin
      .from("client_integrations")
      .select(
        "external_account_id, conversion_action_type, integration_secrets(access_token), clients(segment)",
      )
      .eq("client_id", clientId)
      .eq("platform", "meta_ads")
      .eq("is_active", true)
      .maybeSingle();

    const linha = data as unknown as {
      external_account_id: string | null;
      conversion_action_type: string | null;
      integration_secrets?: { access_token?: string | null } | null;
      clients?: { segment?: string | null } | null;
    } | null;

    const token = linha?.integration_secrets?.access_token;
    const conta = linha?.external_account_id;

    // `pending:` marca conta escolhida mas ainda não autorizada.
    if (!token || !conta || conta.startsWith("pending:")) return null;

    const insights = await fetchAdInsights(
      token,
      normalizeCustomerId(conta),
      since,
      until,
      conversionActionFor(
        linha?.clients?.segment as never,
        linha?.conversion_action_type as never,
      ),
      timeoutMs,
    );

    /* Mapa vazio = não apurou. Conta que realmente não veiculou no
       período devolve linhas com zero, não lista vazia — então tratar
       vazio como "tudo zero" só acerta por acidente e erra no caso que
       importa, que é a falha. */
    if (insights.size === 0) return null;

    return new Map(
      [...insights.entries()].map(([id, i]: [string, AdInsight]) => [
        id,
        {
          spendCents: i.spendCents,
          conversions: i.conversions,
          impressions: i.impressions,
          clicks: i.clicks,
        },
      ]),
    );
  } catch {
    return null;
  }
}
