import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { microsToCents, normalizeCustomerId } from "./normalize";

/* =====================================================================
   Saldo do Google Ads — `account_budget`
   ---------------------------------------------------------------------
   Diferente da Meta, aqui a API DEVOLVE o número. Medido em 07/08/2026
   nas 7 contas ligadas do Elo Hub.

   ⚠️ A FÓRMULA ÓBVIA ESTÁ ERRADA.

   `approved_spending_limit_micros − amount_served_micros` parece a
   conta certa e produz saldo NEGATIVO em conta saudável. Medido no
   Atacado de Pratas:

       approved  R$ 218.780,00
       served    R$ 219.547,09   →  approved − served = −R$ 767,09
       adjusted  R$ 220.297,52   →  adjusted − served = +R$ 750,43

   O que falta é `total_adjustments_micros` (R$ 1.517,52 nessa conta):
   créditos, estornos e ajustes de fatura aplicados depois da aprovação.
   `adjusted_spending_limit_micros` já é `approved + adjustments`, ou
   seja, o limite EFETIVO. É ele que entra na conta.

   Com a fórmula ingênua o alerta apareceria como "zerado" numa conta
   com R$ 750 de folga — o mesmo tipo de inversão que o `balance` da
   Meta causava, e a razão de este arquivo existir separado.

   ⚠️ SEGUNDA ARMADILHA: `approved_spending_limit_type = 'INFINITE'`.
   Quatro das sete contas medidas (todas pós-pagas) não têm limite
   nenhum — o campo numérico simplesmente não vem. `undefined − served`
   vira NaN, e defaultar para zero produziria "−R$ 86.943,01" na Clínica
   Mustafa, marcando como crítica a conta que nunca pode acabar. Conta
   ilimitada devolve `unlimited: true` e NÃO é projetada.

   O que NÃO foi verificado: se `adjusted − served` bate com o saldo que
   o painel do Google mostra. Isso exige comparar com a tela, como foi
   feito no Nuur para a Meta. Até lá o número aparece rotulado como
   vindo da API, para quem lê poder julgar.
   ===================================================================== */

export interface SaldoGoogle {
  /** Centavos restantes. `null` quando ilimitado ou indisponível. */
  balanceCents: number | null;
  /** Conta em faturamento sem teto — não há saldo a esgotar. */
  unlimited: boolean;
}

interface LinhaOrcamento {
  accountBudget?: {
    status?: string;
    approvedSpendingLimitMicros?: string;
    approvedSpendingLimitType?: string;
    adjustedSpendingLimitMicros?: string;
    amountServedMicros?: string;
  };
}

interface Chunk {
  results?: LinhaOrcamento[];
  error?: { message?: string };
}

/* Só orçamentos APROVADOS. Um budget PENDING ainda não vale, e um
   CANCELLED já não vale — somar qualquer um dos dois inflaria o saldo e
   adiaria o alerta de recarga. */
const QUERY = `
  SELECT
    account_budget.status,
    account_budget.approved_spending_limit_micros,
    account_budget.approved_spending_limit_type,
    account_budget.adjusted_spending_limit_micros,
    account_budget.amount_served_micros
  FROM account_budget
  WHERE account_budget.status = 'APPROVED'
`;

/**
 * Saldo das contas do Google Ads, indexado por `client_id`.
 *
 * `service_role`: o refresh token vive em `integration_secrets`, tabela
 * com RLS ligada e zero policies — nenhuma sessão de usuário alcança.
 *
 * Falha de uma conta não derruba as outras: a tela mostra o que
 * conseguiu, e a que falhou aparece sem projeção em vez de sumir.
 */
export async function fetchGoogleBalances(): Promise<Map<string, SaldoGoogle>> {
  const saldos = new Map<string, SaldoGoogle>();

  if (!serverEnv.googleAdsDeveloperToken || !serverEnv.googleAdsClientId) {
    return saldos;
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("client_integrations")
    .select("client_id, external_account_id, integration_secrets(refresh_token)")
    .eq("platform", "google_ads")
    .eq("billing_type", "prepaid")
    .eq("is_active", true);

  const linhas = (data ?? []) as unknown as {
    client_id: string;
    external_account_id: string;
    integration_secrets?: { refresh_token?: string | null } | null;
  }[];

  /* As contas da carteira foram autorizadas pelo MESMO usuário do MCC,
     então compartilham refresh token. Trocar uma vez por conta faria
     três chamadas idênticas ao endpoint de OAuth a cada carregamento da
     tela — o cache por token deduplica dentro da invocação.

     Guarda a PROMESSA, não o resultado: com `Promise.all`, as três
     entram ao mesmo tempo e um cache de resultado ainda estaria vazio
     quando a segunda consultasse. */
  const tokens = new Map<string, ReturnType<typeof exchangeRefreshToken>>();

  await Promise.all(
    linhas.map(async (linha) => {
      const refresh = linha.integration_secrets?.refresh_token;
      if (!refresh || linha.external_account_id.startsWith("pending:")) return;

      if (!tokens.has(refresh)) tokens.set(refresh, exchangeRefreshToken(refresh));
      const token = await tokens.get(refresh)!;
      if (!token.ok) return;

      const saldo = await consultarOrcamento(
        normalizeCustomerId(linha.external_account_id),
        token.accessToken,
      );

      if (saldo) saldos.set(linha.client_id, saldo);
    }),
  );

  return saldos;
}

/* ------------------------------------------------------------------ */

async function consultarOrcamento(
  customerId: string,
  accessToken: string,
): Promise<SaldoGoogle | null> {
  /* Uma repetição, com respiro. Medido: `UNSUPPORTED_VERSION` aparece de
     forma intermitente no v21 — a mesma consulta que falha numa conta
     passa na tentativa seguinte. Não é versão morta (essa devolve HTML
     404, ver a nota em `google-ads.ts`); é instabilidade. Sem o retry a
     conta apareceria sem saldo por motivo nenhum. */
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (tentativa > 0) await new Promise((r) => setTimeout(r, 700));

    try {
      const resposta = await fetch(
        `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": serverEnv.googleAdsDeveloperToken,
            ...(serverEnv.googleAdsLoginCustomerId
              ? {
                  "login-customer-id": normalizeCustomerId(
                    serverEnv.googleAdsLoginCustomerId,
                  ),
                }
              : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: QUERY }),
          /* 8s como na Meta, não 15s. Com a repetição abaixo, 15s daria
             pior caso de 30s numa página que o usuário está olhando —
             melhor mostrar a conta sem saldo do que segurar a tela
             inteira esperando uma que não vai responder. */
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        },
      );

      const payload = (await resposta.json()) as Chunk[] | Chunk;
      const chunks = Array.isArray(payload) ? payload : [payload];

      if (!resposta.ok || chunks[0]?.error) continue;

      const linhas = chunks.flatMap((c) => c.results ?? []);
      if (linhas.length === 0) return null;

      return somarOrcamentos(linhas);
    } catch {
      // Rede ou timeout: tenta de novo, depois desiste.
    }
  }

  return null;
}

/**
 * Consolida os orçamentos aprovados de uma conta.
 *
 * Uma conta pode ter mais de um: medido na Brazzo Pizza, com dois. O
 * restante SOMA — são verbas que a conta ainda pode consumir.
 *
 * Mas um único orçamento ilimitado torna a conta inteira ilimitada, e
 * isso é checado ANTES da soma: somar os finitos e ignorar o infinito
 * produziria um teto que não existe, e um alerta de recarga para uma
 * conta que nunca vai parar por falta de saldo.
 */
export function somarOrcamentos(linhas: LinhaOrcamento[]): SaldoGoogle {
  let total = 0;
  let algumFinito = false;

  for (const linha of linhas) {
    const b = linha.accountBudget;
    if (!b) continue;

    const ilimitado =
      b.approvedSpendingLimitType === "INFINITE" ||
      (b.approvedSpendingLimitMicros === undefined &&
        b.adjustedSpendingLimitMicros === undefined);

    if (ilimitado) return { balanceCents: null, unlimited: true };

    /* `adjusted` primeiro: é `approved` + ajustes, o limite que vale.
       `approved` sozinho ignora estorno e crédito, e foi o que produziu
       −R$ 767,09 numa conta com folga. */
    const limite = b.adjustedSpendingLimitMicros ?? b.approvedSpendingLimitMicros;
    if (limite === undefined) continue;

    const servido = b.amountServedMicros ?? "0";
    algumFinito = true;

    /* Piso em zero por orçamento, não no total: um budget estourado é
       zero de folga, não um crédito negativo que abateria a sobra de
       outro orçamento da mesma conta. */
    total += Math.max(0, microsToCents(limite) - microsToCents(servido));
  }

  return algumFinito
    ? { balanceCents: total, unlimited: false }
    : { balanceCents: null, unlimited: false };
}
