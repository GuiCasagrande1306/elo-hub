import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Database, Inbox } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { LeadsWorkspace } from "@/components/leads/leads-workspace";
import { getClients, getTeam } from "@/lib/data";
import { getLeadBoard } from "@/lib/leads/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leads" };

/* =====================================================================
   CRM de leads do cliente
   ---------------------------------------------------------------------
   O funil de quem respondeu ao anúncio: o cliente diz quais leads
   prestaram e quais não, e o motivo do descarte é o que devolve à mídia
   uma informação que o Gerenciador nunca teve.

   NÃO É O `/comercial`. Lá é o funil de venda da Elo — quanto de MRR
   entra se fechar. Aqui é o funil do CLIENTE, e quem mais usa esta tela
   é alguém de fora da agência. As duas telas se parecem de propósito
   (mesmo quadro, mesmo arraste), mas os números não se somam nunca.

   DE QUEM É O QUADRO. Um usuário de papel 'client' tem `client_id` no
   perfil e vê só a própria empresa — não há seletor para ele, porque
   não há escolha. A equipe da agência escolhe a conta pelo seletor, e o
   que ele lista já vem recortado pela RLS: um colaborador sem acesso à
   conta simplesmente não a recebe.
   ===================================================================== */

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ cliente: slugPedido }, clients, team] = await Promise.all([
    searchParams,
    getClients(),
    getTeam(),
  ]);

  const ehCliente = user.role === "client";

  /* Para quem é de fora, a conta vem do PERFIL e o parâmetro da URL é
     ignorado. A RLS recusaria o quadro de outra empresa de qualquer
     forma, mas honrar `?cliente=` aqui produziria uma tela vazia e
     confusa em vez do funil da pessoa. */
  const selecionado = ehCliente
    ? (clients.find((c) => c.id === user.client_id) ?? null)
    : (clients.find((c) => c.slug === slugPedido) ?? clients[0] ?? null);

  if (!selecionado) {
    return (
      <PageContainer>
        <PageHeader
          title="Leads"
          description="O funil de quem respondeu aos anúncios."
        />
        <VazioSemConta ehCliente={ehCliente} />
      </PageContainer>
    );
  }

  /* `null` em vez de `[]` no catch, como em `/conteudo`: a diferença
     entre "nenhum lead ainda" e "as tabelas não existem" é a diferença
     entre uma tela vazia normal e uma migration que ninguém rodou.
     Engolir num array vazio esconderia a segunda por semanas. */
  const board = await getLeadBoard(selecionado.id).catch(() => null);

  if (!board) {
    return (
      <PageContainer>
        <PageHeader
          title="Leads"
          description="O funil de quem respondeu aos anúncios."
        />
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <Database className="size-5 text-warning" />
          <div>
            <h2 className="text-sm font-semibold">Falta rodar a migration</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              As tabelas deste módulo ainda não existem no banco, ou o funil
              padrão não pôde ser criado. Rode{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">
                20260822000054
              </code>{" "}
              a{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">
                20260822000060
              </code>{" "}
              no SQL Editor do Supabase, na ordem, e recarregue esta página.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leads"
        description={
          ehCliente
            ? "Quem chegou pelos anúncios. Diga quais prestaram — é isso que afina a campanha."
            : `Funil de ${selecionado.name}. O que o cliente aprova e descarta aqui é o que mede a qualidade da mídia.`
        }
      />

      <div className="mt-7">
        <LeadsWorkspace
          board={board}
          client={selecionado}
          clients={ehCliente ? [] : clients}
          team={ehCliente ? [] : team}
          podeTrocarDeConta={!ehCliente}
        />
      </div>
    </PageContainer>
  );
}

function VazioSemConta({ ehCliente }: { ehCliente: boolean }) {
  return (
    <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
      <Inbox className="size-5 text-muted-foreground" />
      <div>
        <h2 className="text-sm font-semibold">
          {ehCliente ? "Sua conta ainda não foi vinculada" : "Nenhuma conta disponível"}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {ehCliente
            ? "Seu usuário existe, mas ainda não está ligado a uma empresa. Peça para a equipe da Elo concluir o vínculo — sem ele, não há funil para mostrar."
            : "Você não tem acesso a nenhuma conta com funil de leads. Se isso parece errado, fale com um administrador."}
        </p>
      </div>
    </div>
  );
}
