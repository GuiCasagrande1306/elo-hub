import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ClientAccessPanel } from "@/components/settings/client-access-panel";
import { getClients } from "@/lib/data";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Acesso dos clientes" };
export const dynamic = "force-dynamic";

/* =====================================================================
   Quem, de fora da agência, entra no Elo Hub
   ---------------------------------------------------------------------
   Separada da tela de Equipe de propósito. As duas mexem em `profiles`,
   mas a pergunta é outra: Equipe é "quem da Elo faz o quê"; esta é
   "quem do cliente vê a base do cliente". Misturar as listas convida ao
   engano de um clique — e o engano aqui é dar carteira inteira a quem
   deveria ver uma empresa só.

   `notFound()` e não aviso de permissão, como na tela de Equipe: a
   existência da página não é informação que um colaborador precise.
   ===================================================================== */

interface AcessoDeCliente {
  id: string;
  email: string;
  full_name: string;
  client_id: string;
  created_at: string;
}

export default async function AcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();

  const { cliente } = await searchParams;

  const supabase = await createSupabaseServerClient();

  const [{ data: acessos }, clients] = await Promise.all([
    /* Sob RLS: a policy `profiles_admin_all` cobre a leitura, e usar o
       cliente de sessão em vez de `service_role` mantém a regra num
       lugar só. A tela não precisa de poder que o banco não dê. */
    supabase
      .from("profiles")
      .select("id, email, full_name, client_id, created_at")
      .eq("role", "client")
      .order("created_at", { ascending: false }),
    getClients(),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Acesso dos clientes"
        description="Quem, de fora da agência, entra no painel — e em qual empresa."
      />

      <div className="mt-6 rounded-xl border border-hairline bg-surface-2/50 p-4">
        <p className="text-sm font-medium">O que o cliente enxerga</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Só o <strong>CRM da própria empresa</strong>: os leads dele, o funil
          dele, os contatos dele. Não vê a carteira, nem métricas de mídia, nem
          honorários, nem nenhuma outra conta — a separação é feita pelo
          Postgres, em cada consulta, não por telas escondidas.
        </p>
      </div>

      <div className="mt-5">
        <ClientAccessPanel
          acessos={(acessos ?? []) as AcessoDeCliente[]}
          clients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            brand_primary: c.brand_primary,
          }))}
          clienteInicial={cliente ?? null}
        />
      </div>
    </PageContainer>
  );
}
