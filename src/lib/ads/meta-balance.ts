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

   ⚠️ `balance` NÃO É SALDO DISPONÍVEL. Medido contra o painel na conta
   do Nuur: a Graph API devolveu `balance: 2334` (R$ 23,34) enquanto o
   painel mostrava R$ 341,77 de fundos. Os R$ 23,34 são o valor
   ACUMULADO A PAGAR desde o último débito — ele SOBE conforme veicula,
   e zera quando a Meta cobra.

   A carteira de fundos não é exposta pela Graph API. Foram testados
   `prepay_balance`, `balance_percent_used`, `credit_limit`,
   `funding_source_details`, e as edges `billing_transactions` e
   `payment_methods`: nenhum existe ou traz o número. `is_prepay_account`
   volta false mesmo em conta com carteira.

   Por isso este módulo NÃO projeta dias restantes. Projeção a partir de
   `balance` inverte o alerta — a conta que mais gastou apareceria como a
   mais crítica, e foi exatamente o que aconteceu no primeiro teste.
   ===================================================================== */

export interface ContaSaldo {
  balanceCents: number;
  currency: string;
  /** `funding_source_details.type` da Graph API. */
  fundingType: number | null;
  /** Ex.: "VISA *1346" ou "Saldo disponível (R$171,43 BRL)". */
  fundingLabel: string | null;
  amountSpentCents: number;
  /**
   * O SALDO DE VERDADE, quando a conta é pré-paga.
   *
   * ⚠️ CORREÇÃO DE UMA AFIRMAÇÃO QUE SUSTENTAVA O MÓDULO INTEIRO. O
   * cabeçalho de `balances.ts` dizia "a Graph API NÃO expõe a carteira"
   * e daí saiu todo o desenho da âncora manual: alguém abria o
   * gerenciador, lia o número e digitava no painel.
   *
   * A API expõe. Não no campo `balance` — esse é mesmo o acumulado a
   * pagar, e sobe conforme veicula — e sim em
   * `funding_source_details.display_string`, que numa conta pré-paga é
   * literalmente "Saldo disponível (R$171,43 BRL)".
   *
   * Medido em 19/08/2026 nas 42 contas Meta ativas:
   *
   *     type 20   27 contas   display_string traz o saldo
   *     type  1   14 contas   "VISA *1346" — cartão, não há saldo
   *     sem tipo   1 conta
   *
   * `null` quando não há valor a extrair: cartão, moeda diferente de
   * BRL, ou formato que este parser não reconhece. Null é "não sei",
   * nunca zero — zero significa conta vazia e derruba anúncio.
   */
  availableCents: number | null;
}

/**
 * O valor dentro de "Saldo disponível (R$1.206,01 BRL)".
 *
 * EXPORTADA PARA TESTE. É um parser sobre texto de interface, que é
 * exatamente o tipo de coisa que quebra em silêncio quando a plataforma
 * muda a frase — e o estrago aqui é um saldo errado com cara de certo.
 *
 * A moeda entra na checagem: a string traz o código no fim, e uma conta
 * em dólar devolveria "1.206,01" com "R$" impresso por cima na tela.
 * Fora BRL, devolve `null`.
 *
 * O formato é o brasileiro — ponto de milhar, vírgula decimal. Trocar
 * na ordem errada ("1.206,01" -> 1.20601) é o defeito clássico deste
 * parser, e por isso o ponto sai ANTES de a vírgula virar ponto.
 */
export function saldoDoTextoDePagamento(
  texto: string | null | undefined,
): number | null {
  if (!texto) return null;

  const dentroDosParenteses = texto.match(/\(([^)]*)\)/)?.[1];
  if (!dentroDosParenteses) return null;

  if (!/\bBRL\b/i.test(dentroDosParenteses)) return null;

  const numero = dentroDosParenteses.match(/([\d.,]+)/)?.[1];
  if (!numero) return null;

  const emPontoDecimal = numero.replace(/\./g, "").replace(",", ".");
  const valor = Number(emPontoDecimal);

  if (!Number.isFinite(valor) || valor < 0) return null;

  return Math.round(valor * 100);
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
    /* SEM filtro por `billing_type`, e essa remoção é metade do
       conserto. A marcação é manual e estava errada nos dois sentidos:
       medido em 19/08/2026, a Nuur estava como pré-paga sendo cartão
       (VISA *1346), e NOVE contas com saldo real — Satö, Looka Modas,
       D'Mori, Dom Leonello, Atacado de Pratas, Cura da Alma, Entre Nós,
       Pizzaria D'Rancho e The Boris Burguer — estavam como pós-pagas e
       nem eram consultadas.

       Quem decide agora é a própria conta: `funding_source_details` diz
       se há carteira ou cartão, e diz o número. Uma chamada a mais por
       conta de cartão é barata; uma conta pré-paga invisível custa
       anúncio fora do ar. */
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
          availableCents: saldoDoTextoDePagamento(
            dado.funding_source_details?.display_string,
          ),
          amountSpentCents: Number(dado.amount_spent ?? 0),
        });
      } catch {
        // Rede ou timeout: a conta fica sem saldo conhecido.
      }
    }),
  );

  return saldos;
}
