import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdPlatform, Client } from "@/types/database";

/* =====================================================================
   Alerta de saldo de mídia
   ---------------------------------------------------------------------
   Conta que zera no meio da campanha é o pior tipo de erro operacional:
   silencioso, e o prejuízo (anúncio fora do ar) só aparece no resultado
   do mês. Este módulo estima quantos dias faltam.

   ⚠️ "SALDO" SÓ EXISTE EM CONTA PRÉ-PAGA. Na Meta e no Google, contas
   pós-pagas — a maioria no Brasil — não têm crédito restante: elas
   acumulam gasto e faturam depois. Nelas o campo `balance` significa
   dívida em aberto, não folga. Ler um pelo outro inverteria o alerta.

   Por isso `balanceSource` acompanha cada linha: enquanto for "mock", a
   tela precisa dizer isso, sob pena de a equipe confiar num número
   inventado para decidir recarga.

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
  severity: "zerado" | "critico" | "atencao";
  balanceSource: BalanceSource;
}

/**
 * Saldo por conta.
 *
 * ⚠️ MOCK. Nenhuma API está plugada ainda, e não há coluna no banco
 * para guardar saldo. Determinístico a partir do id do cliente para que
 * a tela não mude a cada refresh — número que dança sozinho na tela
 * treina a equipe a ignorar o alerta.
 *
 * Ao plugar de verdade:
 *   Meta   → GET /{ad_account_id}?fields=balance,spend_cap,amount_spent
 *   Google → GET customers/{id}/billingSetups + accountBudgets
 * e trocar `balanceSource` para a origem correspondente.
 */
function saldoSimulado(clientId: string, platform: AdPlatform): number {
  let semente = 0;
  for (const ch of `${clientId}:${platform}`) {
    semente = (semente * 31 + ch.charCodeAt(0)) % 100_000;
  }
  // De R$ 0 a R$ 800, em centavos.
  return (semente % 801) * 100;
}

export async function getBalanceAlerts(): Promise<BalanceAlert[]> {
  const { clients, gastoPorConta } = await carregar();

  const alertas: BalanceAlert[] = [];

  for (const client of clients) {
    for (const platform of ["meta_ads", "google_ads"] as const) {
      const gasto7d = gastoPorConta.get(`${client.id}:${platform}`) ?? 0;
      const dailySpendCents = Math.round(gasto7d / JANELA_DIAS);
      const balanceCents = saldoSimulado(client.id, platform);

      /* Sem gasto não há ritmo, e sem ritmo não há projeção. Dividir por
         zero daria Infinity e a conta apareceria como "0 dias" — alarme
         falso justamente para quem está pausado. */
      const daysLeft =
        dailySpendCents > 0
          ? Math.floor(balanceCents / dailySpendCents)
          : null;

      const zerado = balanceCents === 0;
      const emRisco = zerado || (daysLeft !== null && daysLeft <= DIAS_DE_ALERTA);
      if (!emRisco) continue;

      // Conta parada e sem saldo não é urgência: não há campanha no ar
      // para cair. Fica de fora para o alerta não virar ruído.
      if (zerado && dailySpendCents === 0) continue;

      alertas.push({
        clientId: client.id,
        clientName: client.name,
        clientSlug: client.slug,
        platform,
        balanceCents,
        dailySpendCents,
        daysLeft,
        severity: zerado ? "zerado" : (daysLeft ?? 0) <= 1 ? "critico" : "atencao",
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

    return { clients: demoClients, gastoPorConta: mapa };
  }

  /* Leitura sob RLS. Desde que a carteira virou legível por toda a
     equipe, qualquer usuário vê a lista de clientes — e `daily_metrics`
     continua com policy própria, então o gasto só aparece para quem tem
     acesso à conta. O alerta é global; o número é filtrado. */
  const supabase = await createSupabaseServerClient();

  const [{ data: clients }, { data: metrics }] = await Promise.all([
    supabase.from("clients").select("*").eq("status", "active").order("name"),
    supabase
      .from("daily_metrics")
      .select("client_id, platform, spend_cents")
      .gte("metric_date", desdeISO),
  ]);

  const mapa = new Map<string, number>();
  for (const m of metrics ?? []) {
    const chave = `${m.client_id}:${m.platform}`;
    mapa.set(chave, (mapa.get(chave) ?? 0) + (m.spend_cents as number));
  }

  return { clients: (clients ?? []) as Client[], gastoPorConta: mapa };
}
