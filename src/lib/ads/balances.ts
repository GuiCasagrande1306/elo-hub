import "server-only";

import { dataNoBrasil, resolvePeriod } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchPrepaidBalances, type ContaSaldo } from "./meta-balance";
import { fetchGoogleBalances, type VerbaGoogle } from "./google-balance";
import type { AdPlatform, Client } from "@/types/database";

/* =====================================================================
   Motor de previsão de saldo — Meta e Google
   ---------------------------------------------------------------------
   Conta que zera no meio da campanha é o pior tipo de erro operacional:
   silencioso, e o prejuízo (anúncio fora do ar) só aparece no resultado
   do mês. Este módulo estima quantos dias faltam.

   AS DUAS PLATAFORMAS CHEGAM AO MESMO NÚMERO POR CAMINHOS DIFERENTES, e
   isso não é uma inconsistência a corrigir — é o que cada API permite:

     Meta    saldo informado na recarga − gasto desde então.
             A Graph API NÃO expõe a carteira. Seu campo `balance` é o
             acumulado A PAGAR e SOBE conforme veicula: medido no Nuur,
             devolvia R$ 23,34 com o painel mostrando R$ 341,77.
             Ver `meta-balance.ts`.

     Google  `adjusted_spending_limit − amount_served`, direto da API.
             NÃO `approved_spending_limit`, que ignora créditos e
             estornos: medido no Atacado de Pratas, a fórmula com
             `approved` devolve −R$ 767,09 numa conta com R$ 750,43 de
             folga. Ver `google-balance.ts`.

   SÓ CONTA PRÉ-PAGA ENTRA AQUI. Em conta pós-paga não há crédito a
   esgotar — no Google elas voltam com limite `INFINITE`, e na Meta o
   `balance` é dívida. O filtro é `client_integrations.billing_type`.

   O RITMO é o mesmo para as duas: `daily_metrics`, alimentada pela
   sincronização diária. Não vale uma chamada extra por conta para
   recalcular o que já está no banco, e usar a mesma fonte garante que
   Meta e Google sejam comparáveis na mesma tela.
   ===================================================================== */

/** Abaixo disto a conta é crítica. */
export const DIAS_DE_ALERTA = 3;

/** Entre este valor e `DIAS_DE_ALERTA`, é atenção. */
export const DIAS_DE_ATENCAO = 7;

/** Janela do ritmo de gasto. */
const JANELA_DIAS = 7;

export type BalanceSource =
  /**
   * Saldo lido da própria Meta, em `funding_source_details`.
   *
   * É a fonte boa e passou a ser o caminho principal — ver a nota em
   * `meta-balance.ts`. As outras existem para quando esta não responde.
   */
  | "saldo_meta"
  | "manual"
  /** Verba de fatura lida da API — NÃO é saldo de conta pré-paga. */
  | "verba_fatura"
  | "moeda_nao_suportada"
  | "indisponivel";

/**
 * Estado da conta. Mais largo que crítico/atenção/saudável de propósito:
 * "não sei o saldo" e "não tem teto" são respostas diferentes de "está
 * tudo bem", e achatá-las nas três produziria alarme falso ou silêncio
 * falso. `unknown` é o estado mais comum numa conta recém-marcada como
 * pré-paga, e a tela precisa pedir o número em vez de dizer "saudável".
 */
export type BalanceStatus =
  | "critical"
  | "warning"
  | "healthy"
  | "unknown"
  | "unlimited"
  /**
   * A leitura informada não bate com a realidade da conta.
   *
   * Acontece quando a projeção zera o saldo E a conta continua gastando:
   * alguém recarregou e não avisou o painel. Medido em 19/08/2026 na
   * Nuur Libanese Bakery — R$ 341,77 lidos catorze dias antes, gasto
   * desde então maior que isso, e a conta veiculando a R$ 35,76/dia com
   * dado até a véspera.
   *
   * Sem este estado a tela gritava CRÍTICO numa conta cheia. E o
   * estrago do alarme falso não é o susto: é que a próxima vez que a
   * tela gritar, ninguém corre.
   */
  | "stale";

/** O objeto padronizado: mesma forma para Meta e Google. */
export interface BalanceForecast {
  /** Centavos disponíveis. `null` = desconhecido ou sem teto. */
  currentBalance: number | null;
  /** Centavos por dia. */
  burnRate: number;
  /** `null` quando não dá para projetar (sem ritmo, sem saldo, sem teto). */
  daysLeft: number | null;
  status: BalanceStatus;
}

export interface BalanceAlert extends BalanceForecast {
  clientId: string;
  clientName: string;
  clientSlug: string;
  platform: AdPlatform;
  balanceSource: BalanceSource;
  /** "VISA *1346" — deixa julgar se `balance` é crédito ou dívida. */
  fundingLabel: string | null;
  /** Data da última leitura informada (Meta). */
  fundsRecordedAt: string | null;
  /** `balance` da Meta: acumulado a pagar. Informativo, não é saldo. */
  accruedCents: number | null;
  /** Divisor usado no ritmo: dias com gasto na janela, no máximo 7. */
  diasDeRitmo: number;
  /**
   * Há quantos dias a leitura foi informada. `null` quando não há
   * leitura.
   *
   * A âncora não é um fato permanente: ela é um número lido numa data e
   * envelhece. Aos catorze dias, o saldo mostrado é a leitura menos duas
   * semanas de gasto estimado — e qualquer recarga no meio o torna
   * ficção. A tela precisa poder dizer isso, e para isso precisa do
   * número.
   */
  diasDesdeLeitura: number | null;
  /** Data do último dia com gasto — a prova de que a conta está no ar. */
  ultimoGastoEm: string | null;
  /**
   * Como a conta é recarregada: `pix`, `cartao` ou `null`.
   *
   * MUDA O QUE O ALERTA SIGNIFICA. Em Pix, saldo acabando é tarefa para
   * alguém hoje. Em cartão, a conta se recarrega sozinha — e o alerta só
   * é urgente quando a cobrança falha, que é justamente quando o saldo
   * cai e não sobe.
   *
   * Não vem da API: a Central de Cobrança da Meta não é exposta. Ver a
   * migration 51, que mede o que foi tentado.
   */
  formaDeRecarga: "pix" | "cartao" | null;
  /** Id da conta na plataforma — monta o link da cobrança. */
  externalAccountId: string | null;
  /** Último aviso de recarga mandado ao grupo do cliente. */
  avisoEnviadoEm: string | null;
  /** Grupo do cliente no WhatsApp, o mesmo dos relatórios. */
  destinoDoCliente: string | null;
}

/* ------------------------------------------------------------------ */
/* A matemática, isolada do banco                                      */
/* ------------------------------------------------------------------ */

/**
 * Ritmo diário a partir do gasto da janela.
 *
 * O divisor é o número de dias em que a conta REALMENTE gastou, não os
 * 7 fixos. Uma conta ligada há dois dias que gastou R$ 200 queima
 * R$ 100/dia, não R$ 28,57 — dividir por 7 daria uma projeção 3,5×
 * otimista justamente na conta nova, que é onde ninguém tem intuição
 * para desconfiar.
 *
 * O mesmo divisor deixa o alerta CONSERVADOR para conta que ficou
 * pausada parte da semana: assume que ela volta a gastar no ritmo em
 * que gasta quando está no ar. Para aviso de recarga é a suposição
 * certa — errar para o lado de avisar cedo custa uma conferida; errar
 * para o outro custa anúncio fora do ar.
 */
export function calcularRitmo(
  gastoNaJanelaCents: number,
  diasComGasto: number,
): number {
  if (gastoNaJanelaCents <= 0 || diasComGasto <= 0) return 0;
  return Math.round(gastoNaJanelaCents / Math.min(diasComGasto, JANELA_DIAS));
}

/**
 * Projeção e status a partir de saldo e ritmo.
 *
 * A ordem dos casos importa: saldo zerado é crítico ANTES de olhar o
 * ritmo, senão uma conta zerada e pausada sairia como "saudável".
 */
export function projetar(
  balanceCents: number | null,
  burnRate: number,
  opts: {
    unlimited?: boolean;
    /**
     * A conta gastou nos últimos dias?
     *
     * É a única evidência independente da âncora manual, e é o que
     * separa "acabou" de "a leitura envelheceu". Ver o estado `stale`.
     */
    gastandoAgora?: boolean;
  } = {},
): BalanceForecast {
  if (opts.unlimited) {
    return {
      currentBalance: null,
      burnRate,
      daysLeft: null,
      status: "unlimited",
    };
  }

  if (balanceCents === null) {
    return { currentBalance: null, burnRate, daysLeft: null, status: "unknown" };
  }

  if (balanceCents <= 0) {
    /* ZERO E GASTANDO É CONTRADIÇÃO, não emergência.
       -----------------------------------------------------------------
       Conta sem saldo não veicula: a plataforma derruba o anúncio no
       mesmo dia. Se a projeção diz zero e a conta gastou ontem, quem
       está errado é a projeção — alguém recarregou sem avisar o painel.

       O caminho antigo devolvia `critical` aqui e produzia o alarme
       falso descrito em `stale`. */
    if (opts.gastandoAgora) {
      return {
        currentBalance: 0,
        burnRate,
        daysLeft: null,
        status: "stale",
      };
    }

    // Parada E zerada: aí é o que parece. Os anúncios já podem ter caído.
    return { currentBalance: 0, burnRate, daysLeft: 0, status: "critical" };
  }

  /* Sem gasto não há ritmo, e sem ritmo não há projeção. Dividir por
     zero daria Infinity, e "0 dias" numa conta pausada com saldo é
     alarme falso. `null` diz o que é: indefinido. */
  if (burnRate <= 0) {
    return {
      currentBalance: balanceCents,
      burnRate: 0,
      daysLeft: null,
      status: "healthy",
    };
  }

  const daysLeft = Math.floor(balanceCents / burnRate);

  return {
    currentBalance: balanceCents,
    burnRate,
    daysLeft,
    status:
      daysLeft <= DIAS_DE_ALERTA
        ? "critical"
        : daysLeft <= DIAS_DE_ATENCAO
          ? "warning"
          : "healthy",
  };
}

/**
 * Dias inteiros entre duas datas ISO, sem passar por fuso.
 *
 * `new Date("2026-08-05")` é meia-noite UTC; na Vercel isso já é outro
 * dia em São Paulo, e a diferença saía um a mais ou a menos conforme a
 * hora da requisição. Comparar só a parte da data resolve.
 */
function diasEntre(deISO: string, ateISO: string): number {
  const ms =
    Date.parse(`${ateISO}T12:00:00Z`) - Date.parse(`${deISO}T12:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export async function getBalanceAlerts(
  comoSistema = false,
): Promise<BalanceAlert[]> {
  const hojeISO = dataNoBrasil();

  const {
    clients,
    gastoPorConta,
    diasComGasto,
    prePagas,
    saldos,
    saldosGoogle,
    fundos,
    gastoDesdeRecarga,
    recargas,
    contasExternas,
    avisos,
  } = await carregar(comoSistema);

  const alertas: BalanceAlert[] = [];

  for (const client of clients) {
    for (const platform of ["meta_ads", "google_ads"] as const) {
      const chave = `${client.id}:${platform}`;

      /* QUEM ENTRA NA LISTA: quem tem carteira, não quem foi marcado.
         -----------------------------------------------------------------
         A marcação `billing_type` é manual e estava errada nos dois
         sentidos — medido em 19/08/2026, uma conta de cartão marcada
         como pré-paga e nove contas com saldo real marcadas como
         pós-pagas, invisíveis na tela.

         Agora a conta entra se a Meta reporta carteira OU se alguém a
         marcou como pré-paga. A marcação vira rede de segurança para
         quando a API não responde, e deixa de ser a verdade. */
      const carteiraMeta =
        platform === "meta_ads"
          ? saldos.get(client.id)?.availableCents ?? null
          : null;

      if (!prePagas.has(chave) && carteiraMeta === null) continue;

      const burnRate = calcularRitmo(
        gastoPorConta.get(chave) ?? 0,
        diasComGasto.get(chave)?.size ?? 0,
      );

      const saldoMeta =
        platform === "meta_ads" ? saldos.get(client.id) : undefined;
      const informado = fundos.get(chave);

      /* --- Saldo: caminho diferente por plataforma ----------------- */
      let balanceCents: number | null;
      let unlimited = false;
      let balanceSource: BalanceSource;

      if (platform === "google_ads") {
        /* A ÂNCORA MANUAL VEM PRIMEIRO, e isso é o oposto do que era.
           -----------------------------------------------------------
           A Google Ads API não expõe saldo de conta pré-paga — o dado
           não existe, e o próprio Google recomenda desde 2015 registrar
           a recarga e descontar o gasto. O que a API devolve é
           `account_budget`, verba de FATURAMENTO MENSAL, que só existe
           em conta faturada e mede outra coisa: quanto ainda cabe no
           teto contratado.

           Como o número da API tem cara de saldo, ele estava ocupando o
           lugar do saldo. Agora: se alguém informou a recarga, é ela que
           manda; a verba de fatura só aparece quando não há âncora, e
           rotulada pelo que é. Mesmo caminho da Meta, mesmo campo no
           banco (`funds_cents`), que já aceita as duas plataformas. */
        const google = saldosGoogle.get(client.id);

        if (informado) {
          balanceCents = Math.max(
            0,
            informado.cents - (gastoDesdeRecarga.get(chave) ?? 0),
          );
          balanceSource = "manual";
        } else if (google?.moedaNaoSuportada) {
          /* Conta em moeda estrangeira: o valor viria em micros de outra
             moeda e a tela imprimiria "R$" em cima. Melhor não mostrar
             número do que mostrar um errado com aparência de certo. */
          balanceCents = null;
          balanceSource = "moeda_nao_suportada";
        } else {
          balanceCents = google?.balanceCents ?? null;
          unlimited = google?.unlimited ?? false;
          balanceSource =
            google && (google.balanceCents !== null || google.unlimited)
              ? "verba_fatura"
              : "indisponivel";
        }
      } else {
        /* META: A CONTA DIZ O SALDO. Sem âncora, sem subtração, sem
           envelhecimento — o número é o que o gerenciador mostra, lido
           na hora.

           A âncora manual continua atrás, para a conta que a API não
           responde (rede, token, moeda estrangeira). Nesse caso vale o
           desenho antigo: leitura menos o gasto desde então. */
        /* CARTÃO NÃO TEM SALDO A ESGOTAR, e dizer isso é melhor que
           inventar um.

           Quando a Meta responde e o método de pagamento é cartão, a
           conta só está aqui porque alguém a marcou como pré-paga —
           medido na Nuur, marcada pré-paga com "VISA *1346". O caminho
           antigo caía na âncora manual, que envelhecia sem parar e
           produzia um "releia o saldo" eterno numa conta que nunca
           acaba. */
        const respondeu = saldoMeta !== undefined;
        const ehCartao = respondeu && carteiraMeta === null;

        if (ehCartao) {
          balanceCents = null;
          unlimited = true;
          balanceSource = "saldo_meta";
        } else if (carteiraMeta !== null) {
          balanceCents = carteiraMeta;
          balanceSource = "saldo_meta";
        } else if (informado) {
          // Piso em zero: saldo estourado é zero, não dívida.
          balanceCents = Math.max(
            0,
            informado.cents - (gastoDesdeRecarga.get(chave) ?? 0),
          );
          balanceSource = "manual";
        } else {
          balanceCents = null;
          balanceSource = "indisponivel";
        }
      }

      /* TODA conta pré-paga entra na lista, em risco ou não. Antes só as
         em risco apareciam, e uma conta recém-marcada como pré-paga com
         saldo folgado simplesmente não existia na tela — indistinguível
         de "esqueci de configurar". O status diferencia; a ausência,
         não. */
      /* ÚLTIMO DIA COM GASTO, tirado do conjunto que já alimenta o
         ritmo — sem consulta extra. É a evidência de que a conta está no
         ar, e é o que permite desconfiar da âncora em vez do saldo. */
      const diasDoRitmo = [...(diasComGasto.get(chave) ?? [])].sort();
      const ultimoGastoEm = diasDoRitmo[diasDoRitmo.length - 1] ?? null;

      /* DOIS DIAS de folga, não um. O sync roda de madrugada e o dado de
         ontem pode não ter fechado; exigir gasto "ontem" marcaria como
         parada uma conta que só não sincronizou ainda. */
      const gastandoAgora =
        ultimoGastoEm !== null && diasEntre(ultimoGastoEm, hojeISO) <= 2;

      alertas.push({
        ...projetar(balanceCents, burnRate, {
          unlimited,
          /* SÓ A ÂNCORA MANUAL PODE ESTAR VENCIDA.
             ---------------------------------------------------------
             `stale` nasceu para o saldo digitado à mão: ele envelhece, e
             uma conta que continua veiculando com a projeção zerada
             significa que alguém recarregou sem avisar o painel.

             Com o saldo lido da Meta na hora, zero é zero — a conta
             gastou ontem e acabou hoje. Marcar isso como "releia o
             saldo" mandaria conferir um número que já está certo, e
             enterraria uma conta com anúncio fora do ar no meio das
             pendências de cadastro. */
          gastandoAgora: balanceSource === "manual" && gastandoAgora,
        }),
        clientId: client.id,
        clientName: client.name,
        clientSlug: client.slug,
        platform,
        balanceSource,
        fundingLabel: saldoMeta?.fundingLabel ?? null,
        fundsRecordedAt: informado?.desde ?? null,
        accruedCents: saldoMeta?.balanceCents ?? null,
        /* O divisor de fato, não a contagem crua: exibir "8 dias"
           enquanto a divisão usa 7 faria a tela desmentir o cálculo. */
        diasDeRitmo: Math.min(diasComGasto.get(chave)?.size ?? 0, JANELA_DIAS),
        formaDeRecarga: recargas.get(chave) ?? null,
        externalAccountId: contasExternas.get(chave) ?? null,
        avisoEnviadoEm: avisos.get(chave) ?? null,
        destinoDoCliente: client.whatsapp_phone ?? null,
        diasDesdeLeitura: informado
          ? diasEntre(informado.desde.slice(0, 10), hojeISO)
          : null,
        ultimoGastoEm,
      });
    }
  }

  /* Mais urgente primeiro, por STATUS e depois por dias. `daysLeft`
     nulo ia para a frente da fila com o `?? -1` de antes: a conta sem
     saldo informado aparecia acima da que zera amanhã. */
  const PESO: Record<BalanceStatus, number> = {
    critical: 0,
    warning: 1,
    /* Logo abaixo de atenção: a linha pede AÇÃO — alguém tem de reler o
       saldo —, mas não é emergência, porque a conta está veiculando. */
    stale: 2,
    unknown: 3,
    healthy: 4,
    unlimited: 5,
  };

  return alertas.sort(
    (a, b) =>
      PESO[a.status] - PESO[b.status] ||
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) -
        (b.daysLeft ?? Number.MAX_SAFE_INTEGER),
  );
}


/* ------------------------------------------------------------------ */

async function carregar(comoSistema = false): Promise<{
  clients: Client[];
  gastoPorConta: Map<string, number>;
  /**
   * Datas COM gasto na janela, por conta. É o divisor do ritmo — ver
   * `calcularRitmo`. `Set` e não contador para não contar duas vezes a
   * conta que tem uma linha por plataforma no mesmo dia.
   */
  diasComGasto: Map<string, Set<string>>;
  recargas: Map<string, "pix" | "cartao">;
  contasExternas: Map<string, string>;
  avisos: Map<string, string>;
  /** Chaves `clientId:platform` das contas pré-pagas. */
  prePagas: Set<string>;
  /** `balance` do Meta (acumulado a pagar), por `client_id`. */
  saldos: Map<string, ContaSaldo>;
  /** Saldo do Google vindo da API, por `client_id`. */
  saldosGoogle: Map<string, VerbaGoogle>;
  /** Saldo informado à mão, por `clientId:platform`. */
  fundos: Map<string, { cents: number; desde: string }>;
  /** Gasto acumulado desde a data da recarga. */
  gastoDesdeRecarga: Map<string, number>;
}> {
  /* Janela de 7 dias COMPLETOS, terminando ONTEM — e vinda de
     `resolvePeriod`, não recalculada aqui.

     A JANELA TERMINAVA HOJE, e isso subestimava o ritmo. O cron roda às
     06:20 BRT pedindo o mês corrente inteiro, então as duas APIs
     devolvem uma linha do DIA EM CURSO com o gasto de umas seis horas.
     Ela entrava na soma com valor parcial e no `Set` de dias com gasto
     como se fosse um dia inteiro: numerador incompleto, denominador
     cheio. Medido com os números reais da tela — Nuur exibia R$ 34,31/dia
     e 4 dias restantes quando o ritmo real era ~R$ 38,50 e restavam 3;
     Atacado exibia 2 dias quando restava 1. Numa tela cujo limiar de
     crítico é 3 dias, um dia de otimismo é a diferença entre o cartão
     vermelho e o amarelo.

     Usar `resolvePeriod("7d")` em vez de recalcular também acaba com a
     divergência: "últimos 7 dias" em /performance e aqui passam a ser o
     mesmo conjunto de datas. O módulo `date-br` já diz, em caixa alta,
     que todo preset termina ontem porque o dia corrente ainda está
     sendo veiculado — esta página era a única exceção. */
  const { start: desdeISO, end: ateISO } = resolvePeriod(
    `${JANELA_DIAS}d` as "7d",
  );

  if (isDemoMode) {
    const { demoClients, demoMetrics } = await import("@/lib/mock/data");
    const mapa = new Map<string, number>();
    const dias = new Map<string, Set<string>>();

    for (const m of demoMetrics) {
      if (m.metric_date < desdeISO || m.metric_date > ateISO) continue;
      const chave = `${m.client_id}:${m.platform}`;
      mapa.set(chave, (mapa.get(chave) ?? 0) + m.spend_cents);
      if (m.spend_cents > 0) {
        if (!dias.has(chave)) dias.set(chave, new Set());
        dias.get(chave)!.add(m.metric_date);
      }
    }

    // No demo todas são pré-pagas, senão a tela nasceria vazia e não
    // haveria como avaliar a interface.
    const prePagas = new Set<string>();
    for (const c of demoClients) {
      prePagas.add(`${c.id}:meta_ads`);
      prePagas.add(`${c.id}:google_ads`);
    }

    /* Demo não chama a Graph API. Saldo determinístico a partir do id
       para a tela não mudar a cada refresh — número que dança sozinho
       treina a equipe a ignorar o alerta. Só aqui: em produção o saldo
       vem da Meta ou não vem. */
    const saldos = new Map<string, ContaSaldo>(
      demoClients.map((c) => {
        let semente = 0;
        for (const ch of c.id) semente = (semente * 31 + ch.charCodeAt(0)) % 100_000;
        return [
          c.id,
          {
            balanceCents: (semente % 801) * 100,
            currency: "BRL",
            /* 20 é o tipo de carteira pré-paga na Graph API, e o rótulo
               segue a frase real — o demo tem de exercitar o mesmo
               caminho de leitura que produção. */
            fundingType: 20,
            fundingLabel: `Saldo disponível (R$${((semente % 801)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} BRL)`,
            availableCents: (semente % 801) * 100,
            amountSpentCents: 0,
          },
        ];
      }),
    );

    /* Fundos informados também no demo: sem eles TODA conta cairia em
       `unknown` e a tela demonstraria só o estado vazio. Derivados do
       mesmo `balance` fictício, para os números baterem entre si. */
    const fundos = new Map<string, { cents: number; desde: string }>();
    for (const [clientId, saldo] of saldos) {
      fundos.set(`${clientId}:meta_ads`, {
        cents: saldo.balanceCents,
        desde: desdeISO,
      });
    }

    /* Google no demo: metade das contas ilimitada, para a interface
       mostrar os dois estados. Determinístico pelo id. */
    const saldosGoogle = new Map<string, VerbaGoogle>(
      demoClients.map((c, i) => [
        c.id,
        i % 2 === 0
          ? {
              balanceCents: ((i * 7919) % 90_000) + 1_000,
              unlimited: false,
              currency: "BRL",
              moedaNaoSuportada: false,
            }
          : {
              balanceCents: null,
              unlimited: true,
              currency: "BRL",
              moedaNaoSuportada: false,
            },
      ]),
    );

    return {
      clients: demoClients,
      gastoPorConta: mapa,
      /* Alterna Pix e cartão no demo para as duas frases de alerta
         aparecerem — uma tela de demonstração que só exercita um dos
         caminhos esconde metade do comportamento. */
      contasExternas: new Map(
        demoClients.map((c) => [`${c.id}:meta_ads`, `act_${c.id.replace(/\D/g, "") || "100"}`]),
      ),
      avisos: new Map(),
      recargas: new Map(
        demoClients.map((c, i) => [
          `${c.id}:meta_ads`,
          i % 2 === 0 ? ("pix" as const) : ("cartao" as const),
        ]),
      ),
      diasComGasto: dias,
      prePagas,
      saldos,
      saldosGoogle,
      fundos,
      gastoDesdeRecarga: new Map(),
    };
  }

  /* Leitura sob RLS. Desde que a carteira virou legível por toda a
     equipe, qualquer usuário vê a lista de clientes — e `daily_metrics`
     continua com policy própria, então o gasto só aparece para quem tem
     acesso à conta. O alerta é global; o número é filtrado. */
  /* `comoSistema` é o caminho do CRON, que não tem sessão. Sem ele, a
     leitura sob RLS devolve zero cliente numa invocação sem usuário — e
     o aviso diário sairia dizendo que está tudo bem. */
  const supabase = comoSistema
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const t0 = Date.now();

  const [
    { data: clients, error: erroClients },
    { data: metrics, error: erroMetrics },
    { data: integracoes, error: erroIntegracoes },
  ] = await Promise.all([
      supabase.from("clients").select("*").eq("status", "active").order("name"),
      supabase
        .from("daily_metrics")
        /* `metric_date` entra no select para o divisor do ritmo: sem a
           data não dá para saber se os 7 dias de gasto vieram de 7 dias
           ou de 2. Ver `calcularRitmo`.

           ⚠️ LIMITE EXPLÍCITO, e ele é a trava de segurança. Esta
           consulta varre a carteira inteira e não filtra por cliente.
           Medida em 20/08/2026: 713 linhas em sete dias — 71% do teto
           de mil do PostgREST, que corta em silêncio. Não estoura hoje;
           estoura sozinha quando a carteira passar de ~85 contas, e o
           sintoma seria ritmo de gasto menor do que o real, ou seja
           alerta de saldo tarde demais.

           `PAGINA * 2` como teto declarado: se um dia a consulta
           devolver exatamente isso, o `throw` abaixo avisa em vez de
           truncar. Melhor a tela cair com mensagem do que projetar dias
           restantes sobre metade do gasto. */
        .select("client_id, platform, spend_cents, metric_date")
        .gte("metric_date", desdeISO)
        // Sem o `.lte` a linha parcial de hoje entrava na janela.
        .lte("metric_date", ateISO)
        .order("id")
        .range(0, 1999),
      supabase
        .from("client_integrations")
        /* LITERAL, não concatenação: o tipo do retorno é inferido do
           texto do select em tempo de compilação, e uma soma de strings
           apaga essa inferência — o resultado vira `GenericStringError`
           e todo campo lido depois deixa de existir para o TypeScript. */
        .select(
          "client_id, platform, funds_cents, funds_recorded_at, recharge_method, external_account_id, recharge_notice_sent_at",
        )
        .eq("billing_type", "prepaid")
        .eq("is_active", true),
    ]);

  /* CRONÔMETRO POR ETAPA. A tela estourou o teto de 60s da função
     enquanto o mesmo cálculo rodava em 1,8s com service_role — a
     diferença é a RLS, e sem medir cada etapa em PRODUÇÃO a conclusão
     seria chute. Vai para o log da Vercel, não para a tela. */
  const msConsultas = Date.now() - t0;

  /* ERRO DE CONSULTA NÃO PODE VIRAR LISTA VAZIA, e este módulo já pagou
     por isso. O Supabase devolve `{ data: null, error }` sem lançar; o
     código lia `integracoes ?? []` e seguia como se não houvesse conta
     pré-paga nenhuma.

     Aconteceu de verdade em 19/08/2026: a coluna `recharge_notice_sent_at`
     entrou no select antes de a migration rodar, o Postgres recusou com
     42703, e as contas do Google sumiram da tela — de 31 linhas para 27,
     sem aviso nenhum. Numa tela cujo trabalho é dizer quais contas vão
     parar, sumir em silêncio é o pior desfecho possível.

     Lançar deixa a página cair no boundary de erro, que é visível. */
  const falha = erroClients ?? erroMetrics ?? erroIntegracoes;
  if (falha) {
    throw new Error(
      `Alertas de saldo: consulta recusada pelo banco — ${falha.message}`,
    );
  }

  /* CHEGOU NO TETO = tem mais, e o resto sumiu. Ver a nota no `.range`
     acima. Falhar aqui é a escolha certa: um ritmo de gasto calculado
     sobre metade das linhas produz "restam 12 dias" numa conta que zera
     em seis, e ninguém tem como desconfiar do número. */
  if ((metrics ?? []).length >= 2000) {
    throw new Error(
      "Alertas de saldo: a janela de 7 dias passou de 2000 linhas e foi " +
        "truncada. A leitura precisa virar paginada antes de a tela voltar.",
    );
  }

  const prePagas = new Set(
    (integracoes ?? []).map((i) => `${i.client_id}:${i.platform}`),
  );

  const recargas = new Map<string, "pix" | "cartao">();
  const contasExternas = new Map<string, string>();
  const avisos = new Map<string, string>();

  for (const i of integracoes ?? []) {
    const chave = `${i.client_id}:${i.platform}`;
    const m = i.recharge_method as "pix" | "cartao" | null;
    if (m) recargas.set(chave, m);

    const conta = i.external_account_id as string | null;
    if (conta) contasExternas.set(chave, conta);

    const aviso = i.recharge_notice_sent_at as string | null;
    if (aviso) avisos.set(chave, aviso);
  }

  /* Saldo informado + a data de leitura, por conta. O desconto do gasto
     posterior é feito adiante, com `daily_metrics` — só a âncora é
     manual, o resto se atualiza sozinho. */
  const fundos = new Map<string, { cents: number; desde: string }>();
  for (const i of integracoes ?? []) {
    if (i.funds_cents === null || !i.funds_recorded_at) continue;
    fundos.set(`${i.client_id}:${i.platform}`, {
      cents: Number(i.funds_cents),
      desde: i.funds_recorded_at as string,
    });
  }

  /* Gasto por conta DESDE cada recarga. Consulta separada da janela de
     7 dias porque a recarga pode ser bem mais antiga — reaproveitar
     aquela subtrairia só a última semana e inflaria o saldo. */
  const gastoDesdeRecarga = new Map<string, number>();
  const tRecarga = Date.now();
  if (fundos.size > 0) {
    const maisAntiga = [...fundos.values()].map((f) => f.desde).sort()[0];

    /* FILTRADA E PAGINADA, e isso não é otimização — é correção.
       ---------------------------------------------------------------
       `daily_metrics` é granular por CAMPANHA (`unique (client_id,
       platform, metric_date, campaign_id)`, e a Meta é lida com
       `level=campaign`), então são N linhas por conta POR DIA. A
       consulta anterior era aberta: sem filtro de cliente, sem filtro de
       plataforma, sem `order` e sem `range`, varrendo desde a recarga
       mais antiga de TODA a carteira.

       `max_rows = 1000` está declarado em `supabase/config.toml`. Ao
       bater no teto, o PostgREST corta em silêncio — e o gasto que não
       veio simplesmente não é subtraído, então o saldo da Meta aparece
       MAIOR do que é e a conta parece saudável já vazia. Sem `order`,
       ainda por cima, quais linhas se perdem muda a cada carregamento.

       Ordenação por `id` porque `metric_date` não é único: com chave
       ambígua, o `range` pode repetir ou pular linha na virada da
       página, e aqui isso vira gasto contado duas vezes ou nenhuma. */
    const contas = [...fundos.keys()].map((k) => k.split(":"));
    const idsComFundo = [...new Set(contas.map(([id]) => id))];
    const plataformasComFundo = [...new Set(contas.map(([, p]) => p))];

    const PAGINA = 1000;

    for (let inicio = 0; ; inicio += PAGINA) {
      const { data: pagina, error } = await supabase
        .from("daily_metrics")
        .select("client_id, platform, spend_cents, metric_date")
        .in("client_id", idsComFundo)
        .in("platform", plataformasComFundo)
        .gt("metric_date", maisAntiga)
        .order("id")
        .range(inicio, inicio + PAGINA - 1);

      if (error) throw error;

      for (const m of pagina ?? []) {
        const chave = `${m.client_id}:${m.platform}`;
        const f = fundos.get(chave);
        // `>` e não `>=`: o gasto do dia da recarga já estava refletido
        // no número que a pessoa leu no painel.
        if (!f || (m.metric_date as string) <= f.desde) continue;
        gastoDesdeRecarga.set(
          chave,
          (gastoDesdeRecarga.get(chave) ?? 0) + (m.spend_cents as number),
        );
      }

      if ((pagina?.length ?? 0) < PAGINA) break;
    }
  }

  const msRecarga = Date.now() - tRecarga;

  const mapa = new Map<string, number>();
  const dias = new Map<string, Set<string>>();

  for (const m of metrics ?? []) {
    const chave = `${m.client_id}:${m.platform}`;
    const gasto = m.spend_cents as number;
    mapa.set(chave, (mapa.get(chave) ?? 0) + gasto);

    /* Só dia COM gasto conta. Dia sincronizado com zero é dia em que a
       conta não veiculou — incluí-lo diluiria o ritmo e adiaria o
       alerta de recarga. */
    if (gasto > 0) {
      if (!dias.has(chave)) dias.set(chave, new Set());
      dias.get(chave)!.add(m.metric_date as string);
    }
  }

  /* As duas APIs em paralelo: são independentes, e em série a página
     esperaria a soma dos dois tempos. Cada uma engole as próprias
     falhas e devolve o que conseguiu. */
  const tApis = Date.now();
  const [saldos, saldosGoogle] = await Promise.all([
    fetchPrepaidBalances(),
    fetchGoogleBalances(),
  ]);

  console.log(
    `[saldos] consultas ${msConsultas}ms · gastoDesdeRecarga ${msRecarga}ms · ` +
      `APIs ${Date.now() - tApis}ms · ${(clients ?? []).length} contas, ` +
      `${(metrics ?? []).length} métricas · sistema=${comoSistema}`,
  );

  return {
    clients: (clients ?? []) as Client[],
    gastoPorConta: mapa,
    diasComGasto: dias,
    prePagas,
    saldos,
    saldosGoogle,
    fundos,
    gastoDesdeRecarga,
    recargas,
    contasExternas,
    avisos,
  };
}


/**
 * A mesma lista, lida com service_role.
 *
 * Para o CRON, que roda sem usuário. `getBalanceAlerts()` passa pela
 * RLS: numa invocação sem sessão ela devolve zero cliente, e o aviso
 * diário sairia afirmando que não há nada crítico — o pior desfecho
 * possível para um alerta.
 */
export function getBalanceAlertsAsSystem(): Promise<BalanceAlert[]> {
  return getBalanceAlerts(true);
}
