import "server-only";

import { isDemoMode } from "@/lib/env";
import { dataNoBrasil } from "@/lib/date-br";
import { saudeDaSequencia, type SaudeAtual } from "./saude";

export type { SaudeAtual };
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Client,
  EntradaDaLinhaDoTempo,
  Profile,
  SaudeDaConta,
} from "@/types/database";

/* Leituras da página do cliente em abas. Todas sob RLS. */

export async function getLinhaDoTempo(
  clientId: string,
  limite = 100,
): Promise<EntradaDaLinhaDoTempo[]> {
  if (isDemoMode) {
    const { demoLinhaDoTempo } = await import("@/lib/mock/data");
    return demoLinhaDoTempo
      .filter((e) => e.client_id === clientId)
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))
      .slice(0, limite);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_timeline")
    .select("*, autor:profiles!client_timeline_created_by_fkey(id, full_name)")
    .eq("client_id", clientId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limite);

  // Erro do banco não vira lista vazia calada: a aba mostraria "nada
  // registrado" sobre um histórico que existe.
  if (error) throw new Error(`Linha do tempo: ${error.message}`);
  return (data ?? []) as EntradaDaLinhaDoTempo[];
}

/**
 * Saúde da conta = a marcada na última otimização da esteira, e desde
 * quando ela está nessa cor (a sequência de otimizações seguidas com a
 * mesma cor; otimização sem cor marcada não interrompe nem conta).
 */
export async function getSaudeAtual(clientId: string): Promise<SaudeAtual | null> {
  let linhas: { dia: string; account_health: SaudeDaConta | null }[];

  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    linhas = demoOptimizations
      .filter((o) => o.client_id === clientId)
      .sort((a, b) => b.dia.localeCompare(a.dia));
  } else {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("optimization_history")
      .select("dia, account_health")
      .eq("client_id", clientId)
      .not("account_health", "is", null)
      .order("dia", { ascending: false })
      .limit(60);
    if (error) throw new Error(`Saúde da conta: ${error.message}`);
    linhas = data ?? [];
  }

  return saudeDaSequencia(linhas, dataNoBrasil(new Date()));
}

/** Dono da conta e colaboradores vinculados, sem repetir. */
export async function getResponsaveis(
  client: Pick<Client, "id" | "owner_id">,
): Promise<Pick<Profile, "id" | "full_name" | "role">[]> {
  if (isDemoMode) {
    const { demoProfiles } = await import("@/lib/mock/data");
    return demoProfiles.filter((p) => p.id === client.owner_id);
  }

  const supabase = await createSupabaseServerClient();
  const { data: membros, error } = await supabase
    .from("client_members")
    .select("profile_id")
    .eq("client_id", client.id);
  if (error) throw new Error(`Responsáveis: ${error.message}`);

  const ids = [...new Set([client.owner_id, ...(membros ?? []).map((m) => m.profile_id)])].filter(
    (id): id is string => Boolean(id),
  );
  if (ids.length === 0) return [];

  const { data: perfis, error: erroPerfis } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", ids);
  if (erroPerfis) throw new Error(`Responsáveis: ${erroPerfis.message}`);
  return (perfis ?? []) as Pick<Profile, "id" | "full_name" | "role">[];
}
