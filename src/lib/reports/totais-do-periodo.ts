import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAccountTotals, type TotaisDaConta } from "@/lib/ads/meta-ads";
import { normalizeCustomerId } from "@/lib/ads/normalize";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   Alcance, frequência e cliques no link da janela
   ---------------------------------------------------------------------
   IRMÃO DE `creative-insights.ts`, e pelo mesmo motivo: são números que
   o banco NÃO TEM e não pode derivar.

   `daily_metrics` guarda investimento, impressões, cliques, conversões e
   receita. Alcance não está lá, e não bastaria acrescentar uma coluna
   diária: alcance NÃO SE SOMA — a mesma pessoa atingida em três dias é
   uma pessoa na semana e três na soma. A explicação longa está em
   `fetchAccountTotals`, que é quem pede a janela inteira de uma vez e
   deixa a desduplicação com a Meta.

   Cliques no link e engajamento da publicação vêm junto porque estão na
   mesma resposta: pedir duas vezes seria duas chamadas para uma conta
   que já está do outro lado da linha.

   ⚠️ `null` NÃO É ZERO. Falha de rede, token vencido ou conta sem Meta
   devolvem `null`, e o relatório simplesmente OMITE esses cartões. A
   alternativa — imprimir "Alcance 0" — é a versão moderna do
   `impressões × 0,62` que esta base já imprimiu para clientes de
   verdade.
   ===================================================================== */

export type TotaisDoPeriodo = TotaisDaConta;

export async function totaisDoPeriodo(
  clientId: string,
  since: string,
  until: string,
  timeoutMs = 7_000,
): Promise<TotaisDoPeriodo | null> {
  /* A demonstração não fala com a Graph API.
     ------------------------------------------------------------------
     Dois cuidados, e os dois foram vistos na tela antes de virarem
     código:

     1. COERENTE CONSIGO MESMO. Frequência tem de bater com impressões ÷
        alcance (43.679 ÷ 18.430 = 2,37), senão a própria demo exibe uma
        contradição a quem for conferir.

     2. DIFERENTE ENTRE AS JANELAS. Devolvendo o mesmo objeto para o
        período atual e o anterior, TODO cartão novo saía com "0,0%" e
        "mesmo valor no período anterior" — a demo parecia defeito em
        vez de demonstrar a comparação. A variação sai de um dígito da
        data de início, então é estável entre recargas (a mesma janela
        mostra sempre o mesmo número) e diferente entre janelas. */
  if (isDemoMode) {
    const fator = 1 - (Number(since.slice(-2)) % 13) / 100;
    const n = (v: number) => Math.round(v * fator);

    return {
      reach: n(18_430),
      impressions: n(43_679),
      /* Recalculada a partir dos dois acima, e não escalada junto: uma
         razão multiplicada pelo mesmo fator do numerador e do
         denominador deixaria de ser a razão deles. */
      frequency: Number((n(43_679) / Math.max(n(18_430), 1)).toFixed(2)),
      clicks: n(1_284),
      linkClicks: n(862),
      pageEngagement: n(3_105),
      spendCents: n(486_300),
    };
  }

  try {
    /* Cliente ADMIN: o token vive em `integration_secrets`, que tem RLS
       ligada e zero policies. Quem pediu o relatório já provou acesso
       antes, na resolução do cliente. Mesmo desenho de
       `creative-insights.ts`. */
    const admin = createSupabaseAdminClient();

    const { data } = await admin
      .from("client_integrations")
      .select("external_account_id, integration_secrets(access_token)")
      .eq("client_id", clientId)
      .eq("platform", "meta_ads")
      .eq("is_active", true)
      .maybeSingle();

    const linha = data as unknown as {
      external_account_id: string | null;
      integration_secrets?: { access_token?: string | null } | null;
    } | null;

    const token = linha?.integration_secrets?.access_token;
    const conta = linha?.external_account_id;

    // `pending:` = conta autorizada mas ainda sem conta de anúncios escolhida.
    if (!token || !conta || conta.startsWith("pending:")) return null;

    return await fetchAccountTotals(
      token,
      normalizeCustomerId(conta),
      since,
      until,
      timeoutMs,
    );
  } catch {
    return null;
  }
}
