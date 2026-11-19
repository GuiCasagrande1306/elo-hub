import "server-only";

import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { normalizeCustomerId } from "./normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VendaDoGoogle } from "@/lib/loja/magazord";

/* =====================================================================
   Vendas PAGAS da loja → conversão importada no Google Ads
   ---------------------------------------------------------------------
   Por que existe: a conversão que a BW Commerce dispara na página de
   "pedido concluído" conta pedido CRIADO, pago ou não. Medido no
   Atacado de Pratas, 01–18/11/2026: dos 46 pedidos com gclid, só 30
   foram pagos (R$ 14,9 mil de R$ 34,3 mil) — o painel mostrava ROAS
   quase o dobro do real. Aqui só entra pedido pago, com o valor da loja.

   ⚠️ VAI PELA DATA MANAGER API, NÃO PELA API DO GOOGLE ADS. Medido em
   19/11/2026: `uploadClickConversions` recusa integração nova ("should
   use the Data Manager API ... limited to existing users"). A Data
   Manager pede o escopo `datamanager` no token (rota auth/google) e a
   API ativada no projeto do Cloud. Token antigo, só com `adwords`, é
   recusado aqui — reautorizar o Google do cliente resolve.

   A ação de destino é achada PELO NOME, em cada conta: quem não tiver
   uma ação "Compra paga (Magazord)" (tipo importação de cliques) não
   recebe nada. É o interruptor por cliente, sem coluna nova no banco.

   ⚠️ REENVIA A JANELA INTEIRA, de propósito — mesma razão do sync da
   loja: o boleto que compensa no dia 22 transforma o pedido do dia 20
   em venda. `transactionId` = número do pedido: o Google fica com o
   primeiro envio e trata os seguintes como ajuste do mesmo pedido.

   ⚠️ A DATA MANAGER FALHA O LOTE INTEIRO por um evento inválido. Por
   isso a janela é curta (mês corrente, clique < 90 dias) e o motivo
   volta no resultado.

   ⚠️ ENGOLE O PRÓPRIO ERRO, igual a `coletarConversoesGoogle`: falhar
   aqui não pode fazer o faturamento da loja contar como não apurado.

   shortcut: pedido pago e DEPOIS cancelado não é retirado do Google
   (seria um ajuste de retração); fazer se o volume aparecer.
   ===================================================================== */

export const NOME_DA_ACAO = "Compra paga (Magazord)";

export interface ResultadoDoEnvio {
  ok: boolean;
  enviadas: number;
  motivo?: string;
}

export async function enviarVendasAoGoogle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  vendas: VendaDoGoogle[],
): Promise<ResultadoDoEnvio> {
  if (vendas.length === 0) return { ok: true, enviadas: 0 };

  try {
    const { data: integracao, error } = await admin
      .from("client_integrations")
      .select("external_account_id, integration_secrets(refresh_token)")
      .eq("client_id", clientId)
      .eq("platform", "google_ads")
      .maybeSingle();

    if (error) return { ok: false, enviadas: 0, motivo: error.message };

    const linha = integracao as {
      external_account_id?: string | null;
      integration_secrets?: { refresh_token?: string | null } | null;
    } | null;
    const refresh = linha?.integration_secrets?.refresh_token;
    if (!linha?.external_account_id || !refresh) {
      return { ok: true, enviadas: 0, motivo: "cliente sem Google Ads" };
    }

    const token = await exchangeRefreshToken(refresh);
    if (!token.ok) return { ok: false, enviadas: 0, motivo: token.message };

    const customerId = normalizeCustomerId(linha.external_account_id);
    const mcc = serverEnv.googleAdsLoginCustomerId
      ? normalizeCustomerId(serverEnv.googleAdsLoginCustomerId)
      : null;
    const auth = { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" };

    const busca = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          ...auth,
          "developer-token": serverEnv.googleAdsDeveloperToken,
          ...(mcc ? { "login-customer-id": mcc } : {}),
        },
        body: JSON.stringify({
          query: `SELECT conversion_action.id FROM conversion_action
                  WHERE conversion_action.name = '${NOME_DA_ACAO}'
                    AND conversion_action.status = 'ENABLED'`,
        }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      },
    );
    if (!busca.ok) return { ok: false, enviadas: 0, motivo: (await busca.text()).slice(0, 200) };
    const acaoId = ((await busca.json()) as {
      results?: { conversionAction?: { id?: string } }[];
    }).results?.[0]?.conversionAction?.id;
    if (!acaoId) return { ok: true, enviadas: 0, motivo: "conta sem a ação" };

    const envio = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        destinations: [
          {
            operatingAccount: { accountType: "GOOGLE_ADS", accountId: customerId },
            ...(mcc ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: mcc } } : {}),
            productDestinationId: acaoId,
          },
        ],
        events: vendas.map((v) => ({
          adIdentifiers: v.gclid ? { gclid: v.gclid } : v.gbraid ? { gbraid: v.gbraid } : { wbraid: v.wbraid },
          // A API da loja devolve hora de Brasília, sem fuso.
          eventTimestamp: `${v.dataHora.slice(0, 10)}T${v.dataHora.slice(11, 19)}-03:00`,
          conversionValue: v.valorCents / 100,
          currency: "BRL",
          transactionId: v.pedidoId,
          eventSource: "WEB",
        })),
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });

    if (!envio.ok) return { ok: false, enviadas: 0, motivo: (await envio.text()).slice(0, 300) };
    return { ok: true, enviadas: vendas.length };
  } catch (erro) {
    return {
      ok: false,
      enviadas: 0,
      motivo: erro instanceof Error ? erro.message : "falha ao enviar vendas",
    };
  }
}
