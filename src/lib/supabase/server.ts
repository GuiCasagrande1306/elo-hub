import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDemoMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Roda com a chave ANON e o JWT do usuário logado — portanto TODA query
 * feita por aqui passa pelas policies de RLS. É o caminho padrão: a
 * autorização vive no banco, não em `if`s espalhados pela aplicação.
 *
 * Next 16: `cookies()` é assíncrono, então esta função também é.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. Ignorar é seguro:
          // quem renova a sessão é o proxy (src/proxy.ts), que roda antes.
        }
      },
    },
  });
}

/**
 * Usuário autenticado + perfil (com a role) numa única chamada.
 *
 * Usa `getUser()`, não `getSession()`: `getSession` lê o cookie sem
 * validar a assinatura no servidor de auth, e cookie é falsificável.
 * Para decisão de autorização, sempre `getUser()`.
 */
export async function getCurrentUser() {
  if (isDemoMode) {
    const { demoCurrentUser } = await import("@/lib/mock/data");
    return demoCurrentUser;
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile ?? null;
}
