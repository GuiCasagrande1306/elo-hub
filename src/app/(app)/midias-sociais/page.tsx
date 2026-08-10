import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Database } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { SocialWorkspace } from "@/components/social/social-workspace";
import { getClients, getSocialAccounts, getSocialPosts } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mídias sociais" };

/* =====================================================================
   Gestão de mídias sociais
   ---------------------------------------------------------------------
   Calendário editorial da carteira: pauta, aprovação do cliente e
   registro do que foi ao ar.

   NÃO PUBLICA. Nenhuma linha deste módulo fala com API de rede social, e
   o esquema foi desenhado assumindo isso — não é um publicador pela
   metade esperando um motor. O que a tela faz é o que trava a operação
   hoje: saber o que precisa de aprovação, o que está aprovado sem dia
   marcado, e o que foi aprovado para terça e ninguém publicou.

   Sem `redirect` por papel: planejar conteúdo é trabalho da equipe
   inteira, e a policy já limita cada pessoa à carteira que ela enxerga.
   O cadastro de perfis é a única parte restrita a admin — por policy, e
   a interface acompanha via `ehAdmin`.
   ===================================================================== */

export default async function MidiasSociaisPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [posts, accounts, clients] = await Promise.all([
    /* `catch` que devolve `null`, não `[]`: a diferença entre "não há
       peça nenhuma" e "a tabela não existe" é a diferença entre uma tela
       vazia normal e uma migration que ninguém rodou. Engolir o erro
       num array vazio esconderia a segunda por semanas. */
    getSocialPosts().catch(() => null),
    getSocialAccounts().catch(() => null),
    getClients(),
  ]);

  if (posts === null || accounts === null) {
    return (
      <PageContainer>
        <PageHeader
          title="Mídias sociais"
          description="Calendário editorial, aprovação do cliente e registro de publicação."
        />
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <Database className="size-5 text-warning" />
          <div>
            <h2 className="text-sm font-semibold">Falta rodar a migration</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              As tabelas deste módulo ainda não existem no banco. Rode{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">
                20260809000033_midias_sociais.sql
              </code>{" "}
              no SQL Editor do Supabase e recarregue esta página.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Mídias sociais"
        description="Calendário editorial, aprovação do cliente e registro de publicação."
      />

      <div className="mt-7">
        <SocialWorkspace
          posts={posts}
          clients={clients}
          accounts={accounts}
          ehAdmin={user.role === "admin"}
        />
      </div>
    </PageContainer>
  );
}
