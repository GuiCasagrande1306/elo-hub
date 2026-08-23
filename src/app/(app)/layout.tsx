import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { OAuthReturnToast } from "@/components/layout/oauth-return-toast";
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

  /* USUÁRIO DE CLIENTE SÓ EXISTE DENTRO DO `/crm`.
     ---------------------------------------------------------------
     A RLS já garante que ele não LEIA dado de outra empresa — isso foi
     provado. O que ela não faz é impedir que ele abra `/clientes` e
     encontre a própria conta emoldurada por tela de agência: verba
     planejada, status do contrato, botão "Novo cliente". Nada disso
     vaza dado de terceiro, e mesmo assim nada disso é para ele.

     A checagem mora AQUI, num lugar só, e não em cada página: assim
     uma rota nova da agência nasce fechada para o cliente sem ninguém
     precisar lembrar. O caminho vem do cabeçalho que o proxy carimba.

     Não é a camada de segurança — continua sendo o Postgres. É o que
     evita oferecer uma porta que dá num cômodo errado. */
  if (user.role === "client") {
    const caminho = (await headers()).get("x-caminho");

    /* SEM O CABEÇALHO, NÃO REDIRECIONA. Ele só existe se o proxy tiver
       rodado; se um dia o matcher deixar uma rota de fora, redirecionar
       às cegas mandaria `/crm` para `/crm` em laço infinito — tela
       branca, e nenhuma pista do motivo. Sem ele o cliente vê a tela da
       agência com os próprios dados, que é feio mas é finito, e o
       Postgres continua barrando o que importa. */
    if (caminho && !caminho.startsWith("/crm")) redirect("/crm");
  }

  const clients = await getClients();

  // `delay` em ms — Base UI, não `delayDuration` do Radix.
  return (
    <TooltipProvider delay={200}>
      {/* `useSearchParams` obriga um limite de Suspense, senão o Next
          desativa a renderização estática de TODAS as rotas abaixo
          deste layout. Não renderiza nada — só dispara o aviso. */}
      <Suspense fallback={null}>
        <OAuthReturnToast />
      </Suspense>

      <AppShell user={user} clients={clients} demoMode={isDemoMode}>
        {children}
      </AppShell>
    </TooltipProvider>
  );
}
