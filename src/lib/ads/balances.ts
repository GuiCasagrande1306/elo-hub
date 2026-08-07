import "server-only";

import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchPrepaidBalances, type ContaSaldo } from "./meta-balance";
import { fetchGoogleBalances, type SaldoGoogle } from "./google-balance";
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

export type BalanceSource = "manual" | "google_api" | "indisponivel";

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
  | "unlimited";

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
  opts: { unlimited?: boolean } = {},
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

  // Sem saldo é crítico mesmo sem ritmo: os anúncios já podem ter caído.
  if (balanceCents <= 0) {
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

export async function getBalanceAlerts(): Promise<BalanceAlert[]> {
  const {
    clients,
    gastoPorConta,
    diasComGasto,
    prePagas,
    saldos,
    saldosGoogle,
    fundos,
    gastoDesdeRecarga,
  } = await carregar();

  const alertas: BalanceAlert[] = [];

  for (const client of clients) {
    for (const platform of ["meta_ads", "google_ads"] as const) {
      const chave = `${client.id}:${platform}`;

      // Conta pós-paga não tem crédito a esgotar — nem entra na conta.
      if (!prePagas.has(chave)) continue;

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
        /* Direto da API. Os dois "sem número" ficam distintos: conta sem
           orçamento localizável (`indisponivel`) e conta sem teto
           (`unlimited`) — a segunda está bem, a primeira precisa de
           atenção humana. */
        const google = saldosGoogle.get(client.id);
        balanceCents = google?.balanceCents ?? null;
        unlimited = google?.unlimited ?? false;
        balanceSource = google ? "google_api" : "indisponivel";
      } else {
        /* Meta: âncora manual MENOS o gasto desde então. Só a leitura
           inicial é manual; o desconto vem de `daily_metrics`, que
           sincroniza todo dia.

           `null` quando ninguém informou — e não zero, como estava
           antes. Zero significa "acabou" e disparava crítico numa conta
           que podia estar cheia; `null` faz a tela pedir o número. */
        balanceCents = informado
          ? // Piso em zero: saldo estourado é zero, não dívida.
            Math.max(0, informado.cents - (gastoDesdeRecarga.get(chave) ?? 0))
          : null;
        balanceSource = informado ? "manual" : "indisponivel";
      }

      /* TODA conta pré-paga entra na lista, em risco ou não. Antes só as
         em risco apareciam, e uma conta recém-marcada como pré-paga com
         saldo folgado simplesmente não existia na tela — indistinguível
         de "esqueci de configurar". O status diferencia; a ausência,
         não. */
      alertas.push({
        ...projetar(balanceCents, burnRate, { unlimited }),
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
      });
    }
  }

  /* Mais urgente primeiro, por STATUS e depois por dias. `daysLeft`
     nulo ia para a frente da fila com o `?? -1` de antes: a conta sem
     saldo informado aparecia acima da que zera amanhã. */
  const PESO: Record<BalanceStatus, number> = {
    critical: 0,
    warning: 1,
    unknown: 2,
    healthy: 3,
    unlimited: 4,
  };

  return alertas.sort(
    (a, b) =>
      PESO[a.status] - PESO[b.status] ||
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) -
        (b.daysLeft ?? Number.MAX_SAFE_INTEGER),
  );
}


/* ------------------------------------------------------------------ */

async function carregar(): Promise<{
  clients: Client[];
  gastoPorConta: Map<string, number>;
  /**
   * Datas COM gasto na janela, por conta. É o divisor do ritmo — ver
   * `calcularRitmo`. `Set` e não contador para não contar duas vezes a
   * conta que tem uma linha por plataforma no mesmo dia.
   */
  diasComGasto: Map<string, Set<string>>;
  /** Chaves `clientId:platform` das contas pré-pagas. */
  prePagas: Set<string>;
  /** `balance` do Meta (acumulado a pagar), por `client_id`. */
  saldos: Map<string, ContaSaldo>;
  /** Saldo do Google vindo da API, por `client_id`. */
  saldosGoogle: Map<string, SaldoGoogle>;
  /** Saldo informado à mão, por `clientId:platform`. */
  fundos: Map<string, { cents: number; desde: string }>;
  /** Gasto acumulado desde a data da recarga. */
  gastoDesdeRecarga: Map<string, number>;
}> {
  /* Janela de exatamente 7 dias, ancorada no fuso de São Paulo.

     Duas correções em relação ao que estava aqui:

     1. `- JANELA_DIAS` com `.gte()` incluía as DUAS pontas e produzia 8
        dias — a tela chegou a exibir "8 dias com gasto" numa janela
        chamada de semanal.

     2. `new Date().toISOString()` recorta a data em UTC. Na Vercel, das
        21h à meia-noite o "hoje" já é o dia seguinte, e a janela
        deslizava um dia antes da hora. Mesmo motivo de `date-br`
        existir. */
  const fim = new Date(`${dataNoBrasil()}T12:00:00-03:00`);
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (JANELA_DIAS - 1));
  const desdeISO = dataNoBrasil(inicio);

  if (isDemoMode) {
    const { demoClients, demoMetrics } = await import("@/lib/mock/data");
    const mapa = new Map<string, number>();
    const dias = new Map<string, Set<string>>();

    for (const m of demoMetrics) {
      if (m.metric_date < desdeISO) continue;
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
            fundingType: 2,
            fundingLabel: "Saldo pré-pago (demo)",
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
    const saldosGoogle = new Map<string, SaldoGoogle>(
      demoClients.map((c, i) => [
        c.id,
        i % 2 === 0
          ? { balanceCents: ((i * 7919) % 90_000) + 1_000, unlimited: false }
          : { balanceCents: null, unlimited: true },
      ]),
    );

    return {
      clients: demoClients,
      gastoPorConta: mapa,
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
  const supabase = await createSupabaseServerClient();

  const [{ data: clients }, { data: metrics }, { data: integracoes }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("status", "active").order("name"),
      supabase
        .from("daily_metrics")
        /* `metric_date` entra no select para o divisor do ritmo: sem a
           data não dá para saber se os 7 dias de gasto vieram de 7 dias
           ou de 2. Ver `calcularRitmo`. */
        .select("client_id, platform, spend_cents, metric_date")
        .gte("metric_date", desdeISO),
      supabase
        .from("client_integrations")
        .select("client_id, platform, funds_cents, funds_recorded_at")
        .eq("billing_type", "prepaid")
        .eq("is_active", true),
    ]);

  const prePagas = new Set(
    (integracoes ?? []).map((i) => `${i.client_id}:${i.platform}`),
  );

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
  if (fundos.size > 0) {
    const maisAntiga = [...fundos.values()]
      .map((f) => f.desde)
      .sort()[0];

    const { data: desdeRecarga } = await supabase
      .from("daily_metrics")
      .select("client_id, platform, spend_cents, metric_date")
      .gt("metric_date", maisAntiga);

    for (const m of desdeRecarga ?? []) {
      const chave = `${m.client_id}:${m.platform}`;
      const f = fundos.get(chave);
      // `>` e não `>=`: o gasto do dia da recarga já estava refletido no
      // número que a pessoa leu no painel.
      if (!f || (m.metric_date as string) <= f.desde) continue;
      gastoDesdeRecarga.set(
        chave,
        (gastoDesdeRecarga.get(chave) ?? 0) + (m.spend_cents as number),
      );
    }
  }

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
  const [saldos, saldosGoogle] = await Promise.all([
    fetchPrepaidBalances(),
    fetchGoogleBalances(),
  ]);

  return {
    clients: (clients ?? []) as Client[],
    gastoPorConta: mapa,
    diasComGasto: dias,
    prePagas,
    saldos,
    saldosGoogle,
    fundos,
    gastoDesdeRecarga,
  };
}
