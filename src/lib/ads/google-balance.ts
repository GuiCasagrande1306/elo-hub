import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { microsToCents, normalizeCustomerId } from "./normalize";

/* =====================================================================
   Verba de fatura do Google Ads — NÃO é saldo de conta pré-paga
   ---------------------------------------------------------------------
   ⚠️ LEIA ISTO ANTES DE "CONSERTAR" A FÓRMULA.

   A GOOGLE ADS API NÃO EXPÕE O SALDO DE UMA CONTA PRÉ-PAGA. Não é
   limitação de query nem de versão: o dado não existe na API. Resposta
   do time da API em 18/03/2025 — "There is no service or method
   currently available through the Google Ads API to retrieve account
   balance alerts" — e a mesma resposta se repete desde 2015 ("there is
   no officially supported method of programmatically obtaining an
   account's balance"). `billing_setup` e `payments_account` devolvem só
   identificação; `invoice` exige faturamento mensal e é retrospectiva.

   O QUE ESTE ARQUIVO LÊ é `account_budget`, que é a superfície de
   FATURAMENTO MENSAL: "The payments setting in your Google Ads account
   must be configured for monthly invoicing in order to manage billing
   workflows with the API." Ou seja, o número aqui é quanto ainda cabe
   dentro da verba contratada de fatura — dinheiro que a conta pode
   gastar antes de estourar o teto, não dinheiro depositado.

   Os dois conceitos se parecem o suficiente para enganar: medido no
   Atacado de Pratas, o limite aprovado era R$ 218.780,00, que é perfil
   de verba de fatura e não de carteira. Por isso o tipo devolvido e o
   rótulo na tela dizem VERBA, não saldo.

   PARA CONTA PRÉ-PAGA o caminho é o mesmo da Meta, e é o que o próprio
   Google recomenda desde 2015: registrar a recarga à mão e descontar o
   gasto acumulado. `client_integrations.funds_cents` já existe para as
   duas plataformas — ver `balances.ts`.

   ⚠️ O ORÇAMENTO ENCERRADO CONTINUA `APPROVED`. O enum
   `AccountBudgetStatus` tem só UNSPECIFIED, UNKNOWN, PENDING, APPROVED e
   CANCELLED — não existe ENDED. Encerrar mexe na DATA ("you can set the
   end time to the current time"), não no status. Filtrar só por status,
   como este arquivo fazia, somava a sobra de verbas velhas como se
   fosse dinheiro de hoje: numa conta que renova verba todo mês, o
   número exibido crescia indefinidamente.

   ⚠️ NÃO SE SOMA MAIS DE UM. "Only one active account budget is allowed
   per customer." As duas linhas APPROVED medidas na Brazzo Pizza eram um
   vigente e um encerrado, não duas verbas acumuláveis. Depois do filtro
   de vigência sobra no máximo uma; se sobrar mais, é bug de filtro.

   ⚠️ MOEDA. Os micros vêm na moeda DA CONTA, e `account_budget` não tem
   campo de moeda — `customer.currency_code` é recurso atribuído e cabe
   no mesmo SELECT, sem custo. Sem essa guarda, US$ 100 virava "R$
   100,00" na tela: o número não é convertido, só re-rotulado.
   ===================================================================== */

/** Moeda em que o painel sabe apresentar valor. */
const MOEDA_BASE = "BRL";

export interface VerbaGoogle {
  /**
   * Centavos que ainda cabem na verba de fatura vigente.
   * `null` = sem teto, moeda não suportada, ou nenhuma verba vigente.
   */
  balanceCents: number | null;
  /** Faturamento sem teto — não há verba a esgotar. */
  unlimited: boolean;
  /** Moeda da conta, quando a API informou. */
  currency: string | null;
  /** A conta opera em moeda que o painel não sabe exibir. */
  moedaNaoSuportada: boolean;
}

interface LinhaOrcamento {
  accountBudget?: {
    status?: string;
    approvedSpendingLimitMicros?: string;
    approvedSpendingLimitType?: string;
    adjustedSpendingLimitMicros?: string;
    adjustedSpendingLimitType?: string;
    amountServedMicros?: string;
    approvedStartDateTime?: string;
    approvedEndDateTime?: string;
    approvedEndTimeType?: string;
  };
  customer?: {
    currencyCode?: string;
    timeZone?: string;
  };
}

interface Chunk {
  results?: LinhaOrcamento[];
  error?: { message?: string };
}

/* As datas APROVADAS, não as propostas: proposto é o que se pediu,
   aprovado é o que valeu. `customer.currency_code` e `customer.time_zone`
   são recursos atribuídos de `account_budget` e entram no mesmo SELECT —
   a moeda para não exibir dólar como real, o fuso para saber o que é
   "agora" na conta.

   A vigência é resolvida no CÓDIGO e não no WHERE: o literal de data do
   GAQL teria de ser montado no fuso da conta, que só se descobre nesta
   mesma resposta. */
const QUERY = `
  SELECT
    account_budget.status,
    account_budget.approved_spending_limit_micros,
    account_budget.approved_spending_limit_type,
    account_budget.adjusted_spending_limit_micros,
    account_budget.adjusted_spending_limit_type,
    account_budget.amount_served_micros,
    account_budget.approved_start_date_time,
    account_budget.approved_end_date_time,
    account_budget.approved_end_time_type,
    customer.currency_code,
    customer.time_zone
  FROM account_budget
  WHERE account_budget.status = 'APPROVED'
`;

/**
 * Verba de fatura das contas do Google Ads, indexada por `client_id`.
 *
 * `service_role`: o refresh token vive em `integration_secrets`, tabela
 * com RLS ligada e zero policies — nenhuma sessão de usuário alcança.
 *
 * Falha de uma conta não derruba as outras: a tela mostra o que
 * conseguiu, e a que falhou aparece sem projeção em vez de sumir.
 */
export async function fetchGoogleBalances(): Promise<Map<string, VerbaGoogle>> {
  const saldos = new Map<string, VerbaGoogle>();

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

      const verba = await consultarOrcamento(
        normalizeCustomerId(linha.external_account_id),
        token.accessToken,
      );

      if (verba) saldos.set(linha.client_id, verba);
    }),
  );

  return saldos;
}

/* ------------------------------------------------------------------ */

async function consultarOrcamento(
  customerId: string,
  accessToken: string,
): Promise<VerbaGoogle | null> {
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

      return resolverVerba(linhas);
    } catch {
      // Rede ou timeout: tenta de novo, depois desiste.
    }
  }

  return null;
}

/**
 * "Agora" no fuso da conta, no mesmo formato das datas da API
 * (`yyyy-MM-dd HH:mm:ss`), para comparar como texto.
 *
 * Comparação por string funciona porque o formato é de largura fixa e
 * os campos vão do mais significativo ao menos. Comparar em UTC erraria
 * na virada do dia em toda conta que não esteja em UTC.
 */
function agoraNaConta(fuso: string | undefined): string {
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: fuso || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

  // `sv-SE` já devolve "2026-08-11 14:03:07".
  return partes.replace("T", " ");
}

/**
 * A verba VIGENTE de uma conta.
 *
 * Não soma: a API garante "only one active account budget per customer".
 * O que existia antes era uma soma de tudo que estava `APPROVED`, e como
 * orçamento encerrado permanece nesse status, a sobra de verbas velhas
 * entrava no total. Aqui sobra no máximo uma linha.
 */
export function resolverVerba(linhas: LinhaOrcamento[]): VerbaGoogle {
  const moeda =
    linhas.find((l) => l.customer?.currencyCode)?.customer?.currencyCode ?? null;
  const fuso = linhas.find((l) => l.customer?.timeZone)?.customer?.timeZone;

  const base = { currency: moeda, moedaNaoSuportada: false };

  /* MOEDA ANTES DE TUDO. Sem esta guarda, uma conta em dólar exibia
     "R$ 100,00" para US$ 100 — o valor não é convertido, só recebe outro
     símbolo. Preferimos não mostrar número a mostrar um errado com cara
     de certo, que é a mesma regra que `normalize.ts` já aplica na
     sincronização. */
  if (moeda && moeda.toUpperCase() !== MOEDA_BASE) {
    return {
      balanceCents: null,
      unlimited: false,
      currency: moeda,
      moedaNaoSuportada: true,
    };
  }

  const agora = agoraNaConta(fuso);

  const vigentes = linhas.filter((l) => {
    const b = l.accountBudget;
    if (!b) return false;

    // Ainda não começou.
    if (b.approvedStartDateTime && b.approvedStartDateTime > agora) return false;

    // Sem fim declarado = vale para sempre.
    if (b.approvedEndTimeType === "FOREVER" || !b.approvedEndDateTime) return true;

    return b.approvedEndDateTime >= agora;
  });

  if (vigentes.length === 0) {
    return { ...base, balanceCents: null, unlimited: false };
  }

  /* Se houver mais de uma vigente — que a doc diz não acontecer — vale a
     que começou por último, e não a soma: somar duas verbas seria
     inventar teto que a conta não tem. */
  const b = vigentes.sort((x, y) =>
    (y.accountBudget?.approvedStartDateTime ?? "").localeCompare(
      x.accountBudget?.approvedStartDateTime ?? "",
    ),
  )[0].accountBudget!;

  const ilimitado =
    b.approvedSpendingLimitType === "INFINITE" ||
    b.adjustedSpendingLimitType === "INFINITE" ||
    (b.approvedSpendingLimitMicros === undefined &&
      b.adjustedSpendingLimitMicros === undefined);

  if (ilimitado) return { ...base, balanceCents: null, unlimited: true };

  /* `adjusted` primeiro: é o limite depois dos ajustes (créditos,
     estornos, compensação de overdelivery), ou seja, o que vale de fato.
     `approved` sozinho ignora tudo isso e produziu −R$ 767,09 numa conta
     com folga, medido no Atacado de Pratas.

     A doc NÃO enuncia `adjusted = approved + adjustments` — isso foi
     inferido daquela medição, e vale como observação, não como regra. */
  const limite = b.adjustedSpendingLimitMicros ?? b.approvedSpendingLimitMicros;
  if (limite === undefined) {
    return { ...base, balanceCents: null, unlimited: false };
  }

  /* A subtração acontece em MICROS e só depois vira centavos: arredondar
     os dois lados antes de subtrair dobra o erro possível à toa. */
  const restante = Number(limite) - Number(b.amountServedMicros ?? "0");

  return {
    ...base,
    // Piso em zero: verba estourada é zero de folga, não crédito negativo.
    balanceCents: Math.max(0, microsToCents(restante)),
    unlimited: false,
  };
}
