"use server";

import { revalidatePath } from "next/cache";

import { isDemoMode } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { syncAllClients } from "@/lib/ads/sync";

/**
 * Disparo manual da sincronização, a partir do painel.
 *
 * ⚠️ CHECAGEM DE PERMISSÃO EXPLÍCITA — e obrigatória.
 *
 * `syncAllClients` usa a chave `service_role`, que IGNORA RLS por
 * completo e toca dados de todos os clientes. Em todo o resto do sistema
 * a autorização é do banco e a aplicação não precisa checar nada; aqui é
 * a exceção, porque o RLS está fora do caminho. Sem este `if`, qualquer
 * colaborador logado dispararia uma varredura na carteira inteira.
 *
 * Restrito a admin também por custo: a cota das APIs do Google e da Meta
 * é limitada e compartilhada entre todos os clientes da agência.
 */
export type SyncActionResult =
  | {
      ok: true;
      succeeded: number;
      failed: number;
      rows: number;
      durationMs: number;
      failures: { client: string; platform: string; message: string }[];
    }
  | { ok: false; error: string };

export async function triggerSyncNow(): Promise<SyncActionResult> {
  const user = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "Sessão expirada. Entre novamente." };
  }

  if (user.role !== "admin") {
    return {
      ok: false,
      error: "Apenas administradores podem disparar a sincronização.",
    };
  }

  if (isDemoMode) {
    return {
      ok: false,
      error:
        "Modo demo: não há credenciais das plataformas nem banco real para sincronizar.",
    };
  }

  // Disparo manual sincroniza o MÊS inteiro, não a janela curta: quem
  // clica no botão normalmente está corrigindo um número que ficou
  // errado, e reprocessar só os últimos dias não resolveria isso.
  const report = await syncAllClients({ mode: "month" });

  // Revalida as telas que leem métricas — as barras e KPIs se atualizam
  // sem o usuário precisar navegar.
  revalidatePath("/clientes");
  revalidatePath("/performance");
  revalidatePath("/");

  return {
    ok: true,
    succeeded: report.succeeded,
    failed: report.failed,
    rows: report.totalRowsUpserted,
    durationMs: report.durationMs,
    failures: report.results
      .filter((r) => !r.ok)
      .map((r) => ({
        client: r.clientName,
        platform: r.platform,
        message: r.message ?? "erro desconhecido",
      })),
  };
}
