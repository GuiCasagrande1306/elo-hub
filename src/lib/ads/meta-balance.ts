import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Saldo real da conta de anúncios
   ---------------------------------------------------------------------
   Substitui `saldoSimulado`, que derivava um número entre R$ 0 e R$ 800
   de um hash do id do cliente. Era placeholder declarado no código — só
   que numa tela chamada "Alertas de saldo", em produção, alimentando
   decisão sobre dinheiro real. Um alerta inventado é pior que alerta
   nenhum: ensina a equipe a confiar num número que não existe.

   ⚠️ O QUE `balance` SIGNIFICA depende da forma de pagamento, e a Meta
   não separa os dois campos:

     • conta PRÉ-PAGA  → crédito restante. Cai conforme veicula.
     • conta PÓS-PAGA  → valor acumulado desde a última fatura. SOBE
                          conforme veicula.

   Ler o segundo como se fosse o primeiro inverte o alerta: a conta que
   mais gastou pareceria a mais folgada. Por isso devolvemos também
   `fundingType` e `fundingLabel` — a tela mostra a fonte junto do
   número, e quem lê consegue julgar.
   ===================================================================== */

export interface ContaSaldo {
  balanceCents: number;
  currency: string;
  /** `funding_source_details.type` da Graph API. */
  fundingType: number | null;
  /** Ex.: "VISA *1346". */
  fundingLabel: string | null;
  amountSpentCents: number;
}

interface RespostaConta {
  balance?: string;
  amount_spent?: string;
  currency?: string;
  funding_source_details?: { type?: number; display_string?: string };
  error?: { message?: string; code?: number };
}

/**
 * Saldo das contas pré-pagas do Meta, indexado por `client_id`.
 *
 * service_role: `integration_secrets` tem RLS ligada e zero policies —
 * nenhuma sessão alcança token. Só o servidor.
 *
 * Falha de uma conta não derruba as outras: a tela precisa mostrar o
 * que conseguiu, e uma conta sem saldo aparece como indisponível em vez
 * de sumir.
 */
export async function fetchPrepaidBalances(): Promise<
  Map<string, ContaSaldo>
> {
  const saldos = new Map<string, ContaSaldo>();
  if (!serverEnv.metaAppId) return saldos;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("client_integrations")
    .select("client_id, external_account_id, integration_secrets(access_token)")
    .eq("platform", "meta_ads")
    .eq("billing_type", "prepaid")
    .eq("is_active", true);

  const linhas = (data ?? []) as unknown as {
    client_id: string;
    external_account_id: string;
    integration_secrets?: { access_token?: string | null } | null;
  }[];

  await Promise.all(
    linhas.map(async (linha) => {
      const token = linha.integration_secrets?.access_token;
      if (!token || linha.external_account_id.startsWith("pending:")) return;

      const url = new URL(
        `https://graph.facebook.com/${serverEnv.metaApiVersion}/${linha.external_account_id}`,
      );
      url.searchParams.set(
        "fields",
        "balance,amount_spent,currency,funding_source_details",
      );

      try {
        const resposta = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          // Curto: a página não pode ficar pendurada por uma conta.
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });

        const dado = (await resposta.json()) as RespostaConta;
        if (!resposta.ok || dado.error || dado.balance === undefined) return;

        saldos.set(linha.client_id, {
          // `balance` já vem na menor unidade da moeda — o mesmo
          // centavo que o resto do sistema usa. Não dividir por 100.
          balanceCents: Number(dado.balance),
          currency: dado.currency ?? "BRL",
          fundingType: dado.funding_source_details?.type ?? null,
          fundingLabel: dado.funding_source_details?.display_string ?? null,
          amountSpentCents: Number(dado.amount_spent ?? 0),
        });
      } catch {
        // Rede ou timeout: a conta fica sem saldo conhecido.
      }
    }),
  );

  return saldos;
}
