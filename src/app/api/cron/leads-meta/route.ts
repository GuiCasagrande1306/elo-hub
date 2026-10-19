import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { buscarLeadsNovosDoMeta } from "@/lib/leads/buscar-leads-meta";

/**
 * GET /api/cron/leads-meta?horas=24
 *
 * Chamado a cada poucos minutos pelo pg_cron do Supabase (o cron da
 * Vercel no plano Hobby só roda uma vez por dia). Mesmo segredo do cron
 * diário: sem ele, qualquer um dispararia avisos nos grupos dos clientes.
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!serverEnv.cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const pedido = Number(request.nextUrl.searchParams.get("horas"));
  const horas = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, 720) : 24;

  const resumo = await buscarLeadsNovosDoMeta(horas);
  for (const r of resumo) {
    if (r.erro) console.error(`[leads-meta] ${r.cliente}: ${r.erro}`);
    if (r.criados) console.info(`[leads-meta] ${r.cliente}: ${r.criados} lead(s) novo(s)`);
  }

  return NextResponse.json({ ok: true, horas, resumo });
}
