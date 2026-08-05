import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { syncAllClients } from "@/lib/ads/sync";

/**
 * GET /api/cron/sync-ads
 *
 * Rodada de sincronização das plataformas de mídia. Chamada pelo Vercel
 * Cron (ver `vercel.json`).
 *
 * AUTENTICAÇÃO
 * Definindo `CRON_SECRET` no projeto, a Vercel envia
 * `Authorization: Bearer <CRON_SECRET>` automaticamente nas invocações
 * de cron. Sem esse header a rota recusa — do contrário qualquer um na
 * internet dispararia sync e queimaria a cota das APIs do Google e da
 * Meta, que é limitada e compartilhada entre todos os clientes.
 *
 * A rota é GET porque é o método que o Vercel Cron usa.
 *
 * O disparo manual do painel NÃO passa por aqui: ele usa a Server Action
 * `triggerSyncNow`, que valida sessão de admin. Assim o CRON_SECRET
 * nunca precisa chegar ao browser.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

// Nunca cachear: cada invocação precisa buscar dados novos.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");

  if (!serverEnv.cronSecret) {
    return NextResponse.json(
      {
        error: "CRON_SECRET não configurado.",
        hint: "Defina a variável no painel da Vercel para habilitar o cron.",
      },
      { status: 503 },
    );
  }

  if (auth !== `Bearer ${serverEnv.cronSecret}`) {
    // 401 genérico de propósito: não confirma se o segredo existe.
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // `?mode=month` na rodada diária captura reatribuições retroativas;
  // a rodada de hora em hora usa a janela curta padrão.
  const mode = searchParams.get("mode") === "month" ? "month" : "recent";
  const lookbackDays = Number(searchParams.get("lookbackDays"));

  /* Backfill: `?since=&until=`. Conta vinculada no meio da relação
     chega com histórico que o sistema nunca viu, e `mode` só alcança o
     mês corrente. Formato validado aqui — data malformada viraria um
     `time_range` que a Graph API recusa com erro obscuro. */
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const range =
    since && until && ISO.test(since) && ISO.test(until) && since <= until
      ? { since, until }
      : undefined;

  const report = await syncAllClients({
    mode,
    range,
    clientId: searchParams.get("clientId") ?? undefined,
    lookbackDays: Number.isFinite(lookbackDays) && lookbackDays > 0
      ? Math.min(lookbackDays, 90)
      : undefined,
  });

  // 200 mesmo com falhas parciais: o job RODOU. Devolver 500 faria a
  // Vercel marcar a invocação como falha e mascararia o fato de que a
  // maioria dos clientes sincronizou. As falhas vêm detalhadas no corpo
  // e ficam gravadas em `client_integrations.sync_error`.
  return NextResponse.json(report, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
