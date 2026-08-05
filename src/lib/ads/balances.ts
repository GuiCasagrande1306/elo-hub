import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchPrepaidBalances, type ContaSaldo } from "./meta-balance";
import type { AdPlatform, Client } from "@/types/database";

/* =====================================================================
   Alerta de saldo de mídia
   ---------------------------------------------------------------------
   Conta que zera no meio da campanha é o pior tipo de erro operacional:
   silencioso, e o prejuízo (anúncio fora do ar) só aparece no resultado
   do mês. Este módulo estima quantos dias faltam.

   SÓ CONTA PRÉ-PAGA ENTRA AQUI. Em conta pós-paga o gasto é faturado
   depois e o campo `balance` da Meta significa dívida acumulada — o
   oposto de folga. O filtro é por `client_integrations.billing_type`,
   marcado no cadastro da conta: confiar em quem lembra de conferir
   produziria um alerta invertido, que parece certo.

   `balanceSource` acompanha cada linha: enquanto for "mock", a tela
   precisa dizer isso, sob pena de a equipe confiar num número inventado
   para decidir recarga.

   O GASTO MÉDIO, esse, é real: sai de `daily_metrics`, alimentada pela
   sincronização. Quando o saldo vier das APIs, metade do cálculo já
   estará correta e testada.
   ===================================================================== */

/** Abaixo disto a conta entra no alerta. */
export const DIAS_DE_ALERTA = 3;

/** Janela do ritmo de gasto. */
const JANELA_DIAS = 7;

export type BalanceSource = "mock" | "meta_api" | "google_api";

export interface BalanceAlert {
  clientId: string;
  clientName: string;
  clientSlug: string;
  platform: AdPlatform;
  /** Centavos. */
  balanceCents: number;
  /** Centavos por dia, média dos últimos 7 dias. */
  dailySpendCents: number;
  /** null quando a conta não gastou nada — não dá para projetar. */
  daysLeft: number | null;
  severity: "zerado" | "critico" | "atencao" | "ok";
  balanceSource: BalanceSource;
  /** "VISA *1346" — deixa julgar se `balance` é crédito ou dívida. */
  fundingLabel: string | null;
  /** Alguém já informou o saldo? Distingue "R$ 0" de "não sei". */
  fundsKnown: boolean;
  /** Data da última leitura informada. */
  fundsRecordedAt: string | null;
  /** `balance` da Meta: acumulado a pagar. Informativo, não é saldo. */
  accruedCents: number | null;
}

export async function getBalanceAlerts(): Promise<BalanceAlert[]> {
  const { clients, gastoPorConta, prePagas, saldos, fundos, gastoDesdeRecarga } =
    await carregar();

  const alertas: BalanceAlert[] = [];

  for (const client of clients) {
    for (const platform of ["meta_ads", "google_ads"] as const) {
      // Conta pós-paga não tem crédito a esgotar — nem entra na conta.
      if (!prePagas.has(`${client.id}:${platform}`)) continue;

      const gasto7d = gastoPorConta.get(`${client.id}:${platform}`) ?? 0;
      const dailySpendCents = Math.round(gasto7d / JANELA_DIAS);
      /* Só o Meta devolve saldo hoje. Sem dado, a conta não some da
         lista — aparece sem projeção, que é honesto. Sumir faria
         parecer que ninguém está monitorando. */
      const saldo = platform === "meta_ads" ? saldos.get(client.id) : undefined;
      /* Disponível = o que foi informado na recarga MENOS o gasto
         desde então. Só a âncora é manual; o desconto vem de
         `daily_metrics`, que sincroniza todo dia.

         `balance` da Graph API não entra nesta conta: ele é o acumulado
         A PAGAR e sobe conforme veicula — usá-lo inverteria o alerta.
         Fica exposto à parte, como informação. */
      const informado = fundos.get(`${client.id}:${platform}`);
      const gastoPos = gastoDesdeRecarga.get(`${client.id}:${platform}`) ?? 0;
      // Não deixa negativo: saldo estourado é zero, não dívida.
      const balanceCents = informado
        ? Math.max(0, informado.cents - gastoPos)
        : 0;

      /* Sem gasto não há ritmo, e sem ritmo não há projeção. Dividir por
         zero daria Infinity e a conta apareceria como "0 dias" — alarme
         falso justamente para quem está pausado. */
      /* Sem saldo informado não há projeção — e a conta aparece
         pedindo o número, em vez de sumir ou fingir um alerta. */
      const daysLeft =
        informado && dailySpendCents > 0
          ? Math.floor(balanceCents / dailySpendCents)
          : null;

      /* TODA conta pré-paga entra na lista, em risco ou não.
         Antes só as em risco apareciam, e uma conta recém-marcada como
         pré-paga com saldo folgado simplesmente não existia na tela —
         indistinguível de "esqueci de configurar". A severidade
         diferencia; a ausência, não. */
      const zerado = Boolean(informado) && balanceCents === 0;
      const emRisco =
        zerado || (daysLeft !== null && daysLeft <= DIAS_DE_ALERTA);

      alertas.push({
        clientId: client.id,
        clientName: client.name,
        clientSlug: client.slug,
        platform,
        balanceCents,
        dailySpendCents,
        daysLeft,
        severity: !emRisco
          ? "ok"
          : zerado
            ? "zerado"
            : (daysLeft ?? 0) <= 1
              ? "critico"
              : "atencao",
        fundingLabel: saldo?.fundingLabel ?? null,
        /** Sem isto a tela não sabe distinguir "R$ 0" de "não informado". */
        fundsKnown: Boolean(informado),
        fundsRecordedAt: informado?.desde ?? null,
        accruedCents: saldo?.balanceCents ?? null,
        balanceSource: "mock",
      });
    }
  }

  // Mais urgente primeiro: quem zerou, depois quem tem menos dias.
  return alertas.sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1));
}

/* ------------------------------------------------------------------ */

async function carregar(): Promise<{
  clients: Client[];
  gastoPorConta: Map<string, number>;
  /** Chaves `clientId:platform` das contas pré-pagas. */
  prePagas: Set<string>;
  /** Saldo real do Meta, por `client_id`. Ausente = não obtido. */
  saldos: Map<string, ContaSaldo>;
  /** Saldo informado à mão, por `clientId:platform`. */
  fundos: Map<string, { cents: number; desde: string }>;
  /** Gasto acumulado desde a data da recarga. */
  gastoDesdeRecarga: Map<string, number>;
}> {
  const desde = new Date();
  desde.setDate(desde.getDate() - JANELA_DIAS);
  const desdeISO = desde.toISOString().slice(0, 10);

  if (isDemoMode) {
    const { demoClients, demoMetrics } = await import("@/lib/mock/data");
    const mapa = new Map<string, number>();

    for (const m of demoMetrics) {
      if (m.metric_date < desdeISO) continue;
      const chave = `${m.client_id}:${m.platform}`;
      mapa.set(chave, (mapa.get(chave) ?? 0) + m.spend_cents);
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

    return {
      clients: demoClients,
      gastoPorConta: mapa,
      prePagas,
      saldos,
      fundos: new Map(),
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
        .select("client_id, platform, spend_cents")
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
  for (const m of metrics ?? []) {
    const chave = `${m.client_id}:${m.platform}`;
    mapa.set(chave, (mapa.get(chave) ?? 0) + (m.spend_cents as number));
  }

  return {
    clients: (clients ?? []) as Client[],
    gastoPorConta: mapa,
    prePagas,
    saldos: await fetchPrepaidBalances(),
    fundos,
    gastoDesdeRecarga,
  };
}
