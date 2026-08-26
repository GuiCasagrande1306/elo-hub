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

/** Uma sub-resposta do `/batch`. `body` vem como texto JSON. */
interface SubResposta {
  code?: number;
  body?: string;
}

/** Uma linha de `client_integrations` com o token já junto. */
interface ContaParaLer {
  client_id: string;
  external_account_id: string;
  token: string;
}

/** Os campos pedidos à Graph API, iguais nos dois caminhos de leitura. */
const CAMPOS = "balance,amount_spent,currency,funding_source_details";

/**
 * Quantas contas por requisição ao `/batch`.
 *
 * CINCO, e o número foi medido — não escolhido. As 49 contas ativas,
 * lidas de 26/08/2026 desta máquina, oito rodadas intercaladas:
 *
 *     soltas (uma requisição por conta)   mediana 2.438ms, máx 8.021ms
 *     lotes de 3  (17 requisições)        mediana 1.312ms, máx 6.495ms
 *     lotes de 4  (13 requisições)        mediana 1.411ms, máx 6.426ms
 *     lotes de 5  (10 requisições)        mediana 1.259ms, máx 1.581ms
 *     lotes de 6  ( 9 requisições)        mediana 2.048ms, máx 10.011ms
 *     TODAS num lote só ( 1 requisição)                    9.034ms
 *
 * O ganho não vem de a Meta ficar mais rápida: uma conta sozinha custa
 * 700–900ms e isso não muda. Vem da CAUDA. Cada requisição sorteia um
 * tempo de uma distribuição de cauda pesada, e a página espera o PIOR
 * dos sorteios — com 49 sorteios o pior é péssimo, com 10 é bem menos.
 * Foi medido também que a lentidão é do sorteio e não da conta: a mesma
 * conta devolveu 2.774ms numa rodada e 422ms na seguinte.
 *
 * Lote grande demais anda para trás porque a Meta processa as
 * sub-requisições EM SÉRIE do lado dela — daí os 9s das 49 juntas.
 *
 * O teto documentado da plataforma é 50 por lote; ficamos muito abaixo.
 *
 * Também foi tentado e DESCARTADO: HTTP/2 multiplexado (10–12s, pior
 * ainda por serializar na mesma conexão) e requisição hedge disparada
 * aos 800ms (mediana 1.833ms contra 2.427ms, faixas sobrepostas, ao
 * custo de 40% mais chamadas — ganho dentro do ruído).
 */
const POR_LOTE = 5;

/** O mesmo objeto, venha o dado do lote ou da chamada solta. */
function montarSaldo(dado: RespostaConta): ContaSaldo | null {
  if (dado.error || dado.balance === undefined) return null;

  return {
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
  };
}

/**
 * Um lote: várias contas numa requisição só.
 *
 * ⚠️ CADA SUB-REQUISIÇÃO LEVA O PRÓPRIO TOKEN, no `relative_url`. As 49
 * contas têm 49 tokens distintos (medido) — não existe um token da
 * agência que leia todas —, então sem isso o lote seria inútil aqui.
 *
 * O `access_token` do topo é exigido pela plataforma e não pode ser o
 * token de aplicativo (`app_id|app_secret` volta 190, "Invalid OAuth
 * access token signature"). Usamos o da primeira conta do grupo, e é
 * daí que vem o risco novo: se ELE estiver vencido, o lote inteiro
 * falha, não só a conta dele. Por isso o retorno é `null` em vez de um
 * mapa vazio — quem chama distingue "nenhuma conta tem saldo" de "não
 * consegui perguntar" e refaz o grupo em chamadas soltas.
 *
 * A ordem das respostas espelha a ordem do pedido; é o contrato da
 * plataforma e é por índice que casamos conta e resposta. Uma
 * sub-requisição pode voltar `null` (a Meta desistiu dela) ou com
 * `code` diferente de 200 — nesses casos a conta fica sem saldo
 * conhecido, exatamente como já acontecia quando a chamada solta
 * falhava.
 */
async function lerLote(
  grupo: ContaParaLer[],
): Promise<Map<string, ContaSaldo> | null> {
  const corpo = new URLSearchParams();
  corpo.set("access_token", grupo[0].token);
  // Sem os cabeçalhos de cada sub-resposta o payload cai à metade.
  corpo.set("include_headers", "false");
  corpo.set(
    "batch",
    JSON.stringify(
      grupo.map((c) => ({
        method: "GET",
        relative_url: `${c.external_account_id}?fields=${CAMPOS}&access_token=${encodeURIComponent(c.token)}`,
      })),
    ),
  );

  try {
    const resposta = await fetch(
      `https://graph.facebook.com/${serverEnv.metaApiVersion}/`,
      {
        method: "POST",
        body: corpo,
        // Curto: a página não pode ficar pendurada por um lote.
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      },
    );

    const payload: unknown = await resposta.json();
    if (!resposta.ok || !Array.isArray(payload)) return null;

    const doLote = new Map<string, ContaSaldo>();

    (payload as (SubResposta | null)[]).forEach((sub, i) => {
      const conta = grupo[i];
      if (!conta || !sub || sub.code !== 200 || !sub.body) return;

      let dado: RespostaConta;
      try {
        dado = JSON.parse(sub.body) as RespostaConta;
      } catch {
        return;
      }

      const saldo = montarSaldo(dado);
      if (saldo) doLote.set(conta.client_id, saldo);
    });

    return doLote;
  } catch {
    // Rede ou timeout: o grupo inteiro volta pelo caminho solto.
    return null;
  }
}

/** O caminho antigo, uma conta por requisição. Rede de segurança. */
async function lerUma(conta: ContaParaLer): Promise<ContaSaldo | null> {
  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/${conta.external_account_id}`,
  );
  url.searchParams.set("fields", CAMPOS);

  try {
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${conta.token}` },
      // Curto: a página não pode ficar pendurada por uma conta.
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    if (!resposta.ok) return null;
    return montarSaldo((await resposta.json()) as RespostaConta);
  } catch {
    // Rede ou timeout: a conta fica sem saldo conhecido.
    return null;
  }
}

/**
 * Saldo das contas pré-pagas do Meta, indexado por `client_id`.
 *
 * service_role: `integration_secrets` tem RLS ligada e zero policies —
 * nenhuma sessão alcança token. Só o servidor.
 *
 * Falha de uma conta não derruba as outras: a tela precisa mostrar o
 * que conseguiu, e uma conta sem saldo aparece como indisponível em vez
 * de sumir. Com o lote isso continua valendo em dois níveis: a
 * sub-requisição que falha derruba só a conta dela, e o lote que falha
 * inteiro é refeito conta a conta.
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
    .eq("is_active", true)
    /* ORDENADO só para os lotes saírem sempre com a mesma composição.
       Sem isso o agrupamento segue a ordem que o Postgres devolver, e
       quando um token vence o lote que cai muda a cada carregamento —
       um dia some a conta A, no outro a B. Com ordem fixa o defeito
       fica no mesmo lugar e dá para achar. */
    .order("client_id");

  const linhas = (data ?? []) as unknown as {
    client_id: string;
    external_account_id: string;
    integration_secrets?: { access_token?: string | null } | null;
  }[];

  const contas: ContaParaLer[] = [];
  for (const linha of linhas) {
    const token = linha.integration_secrets?.access_token;
    if (!token || linha.external_account_id.startsWith("pending:")) continue;
    contas.push({
      client_id: linha.client_id,
      external_account_id: linha.external_account_id,
      token,
    });
  }

  const grupos: ContaParaLer[][] = [];
  for (let i = 0; i < contas.length; i += POR_LOTE) {
    grupos.push(contas.slice(i, i + POR_LOTE));
  }

  const resultados = await Promise.all(
    grupos.map(async (grupo) => {
      const doLote = await lerLote(grupo);
      if (doLote) return doLote;

      /* O lote não respondeu — token do topo vencido, rede, timeout.
         Refazer conta a conta custa o tempo de antes, e só para este
         grupo. Perder cinco contas de uma vez numa tela que existe para
         dizer quais vão parar seria pior que a demora. */
      const solto = new Map<string, ContaSaldo>();
      await Promise.all(
        grupo.map(async (conta) => {
          const saldo = await lerUma(conta);
          if (saldo) solto.set(conta.client_id, saldo);
        }),
      );
      return solto;
    }),
  );

  for (const parcial of resultados) {
    for (const [clientId, saldo] of parcial) saldos.set(clientId, saldo);
  }

  return saldos;
}
