"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isDemoMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Cliente Supabase do browser — usado por hooks de Realtime e mutações
 * otimistas. Singleton: cada `createBrowserClient` abre seu próprio
 * socket, e N sockets por aba estouram o limite de conexões do projeto.
 */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (isDemoMode) return null; // em demo não há socket a abrir
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}
