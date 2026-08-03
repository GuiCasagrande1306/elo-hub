import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getCurrentUser } from "@/lib/supabase/server";
import { getClients } from "@/lib/data";
import { isDemoMode } from "@/lib/env";

/**
 * Layout autenticado.
 *
 * A lista de clientes da sidebar já vem filtrada pelo RLS: um
 * colaborador simplesmente não recebe as contas em que não foi
 * incluído. Não há filtro cosmético no cliente — o que não veio do
 * banco não existe para aquela sessão.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Rede de segurança: o proxy já teria redirecionado, mas uma sessão
  // pode expirar entre o proxy e a renderização.
  if (!user) redirect("/login");

  const clients = await getClients();

  // `delay` em ms — Base UI, não `delayDuration` do Radix.
  return (
    <TooltipProvider delay={200}>
      <AppShell user={user} clients={clients} demoMode={isDemoMode}>
        {children}
      </AppShell>
    </TooltipProvider>
  );
}
