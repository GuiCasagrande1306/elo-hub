import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { DIAS_DE_ALERTA, getBalanceAlerts } from "@/lib/ads/balances";

/**
 * GET /api/alerts/balances
 *
 * Contas de anúncio prestes a esgotar. Aberta a QUALQUER usuário
 * autenticado — não é dado financeiro da agência, é operação de mídia,
 * e quem gerencia a conta precisa ver antes de o anúncio cair.
 *
 * A leitura interna passa por RLS: a lista de clientes é global desde a
 * mudança de policy, mas `daily_metrics` continua restrita, então o
 * gasto médio só aparece para quem tem acesso à conta.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const alerts = await getBalanceAlerts();

  return NextResponse.json(
    {
      alerts,
      threshold: DIAS_DE_ALERTA,
      // Explícito na resposta, não só na tela: quem consumir esta API
      // de fora precisa saber que o saldo ainda é simulado.
      balanceSource: "mock",
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
