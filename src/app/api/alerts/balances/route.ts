import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import {
  DIAS_DE_ALERTA,
  DIAS_DE_ATENCAO,
  getBalanceAlerts,
} from "@/lib/ads/balances";

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
      thresholds: { critical: DIAS_DE_ALERTA, warning: DIAS_DE_ATENCAO },
      /* A origem agora é POR CONTA, em `alerts[].balanceSource`: Meta vem
         de leitura manual e Google da API, e um campo único no topo
         mentiria sobre metade das linhas. */
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
