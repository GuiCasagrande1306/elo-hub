import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Database, FileText, Plus } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { BriefCard } from "@/components/content/brief-card";
import { Button } from "@/components/ui/button";
import { getClients } from "@/lib/data";
import { getContentBriefs } from "@/lib/content/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Conteúdo" };

/* =====================================================================
   Briefs de conteúdo
   ---------------------------------------------------------------------
   A linha editorial de cada cliente: diagnóstico do perfil, formato que
   funciona, roteiros da semana e o que ainda falta o cliente confirmar.

   AGRUPADA POR CLIENTE, não ordenada por data. Ninguém abre esta tela
   perguntando "o que foi escrito ontem" — abre perguntando "o que a
   gente combinou com a Brazzo". Uma lista cronológica misturaria três
   clientes na mesma tela e obrigaria a ler o nome em cada linha.

   Sem `redirect` por papel: escrever conteúdo é trabalho da equipe
   inteira, e a policy já limita cada pessoa à carteira que ela enxerga.
   ===================================================================== */

export default async function ConteudoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [briefs, clients] = await Promise.all([
    /* `null` em vez de `[]` no catch: a diferença entre "nenhum
       documento ainda" e "a tabela não existe" é a diferença entre uma
       tela vazia normal e uma migration que ninguém rodou. Engolir num
       array vazio esconderia a segunda por semanas. */
    getContentBriefs().catch(() => null),
    getClients(),
  ]);

  if (briefs === null) {
    return (
      <PageContainer>
        <PageHeader
          title="Conteúdo"
          description="Linha editorial, roteiros e banco de ganchos por cliente."
        />
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <Database className="size-5 text-warning" />
          <div>
            <h2 className="text-sm font-semibold">Falta rodar a migration</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              A tabela deste módulo ainda não existe no banco. Rode{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">
                20260822000053_briefs_de_conteudo.sql
              </code>{" "}
              no SQL Editor do Supabase e recarregue esta página.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  /* Arquivado sai da lista principal: o status existe justamente para
     tirar da frente sem perder. Continua alcançável pelo link direto. */
  const ativos = briefs.filter((b) => b.status !== "arquivado");
  const arquivados = briefs.filter((b) => b.status === "arquivado");

  const porCliente = new Map<string, typeof ativos>();
  for (const brief of ativos) {
    const lista = porCliente.get(brief.client_id) ?? [];
    lista.push(brief);
    porCliente.set(brief.client_id, lista);
  }

  /* A ordem dos clientes é a de `getClients` (alfabética), não a de
     chegada dos documentos: a lista precisa ficar no mesmo lugar entre
     uma visita e outra para que se ache um cliente sem ler tudo. */
  const grupos = clients
    .map((cliente) => ({ cliente, briefs: porCliente.get(cliente.id) ?? [] }))
    .filter((g) => g.briefs.length > 0);

  return (
    <PageContainer>
      <PageHeader
        title="Conteúdo"
        description="Linha editorial, roteiros e banco de ganchos por cliente."
        actions={
          <Button nativeButton={false} render={<Link href="/conteudo/novo" />}>
            <Plus className="size-4" />
            Novo documento
          </Button>
        }
      />

      {ativos.length === 0 ? (
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <FileText className="size-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Nenhum documento ainda</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Um brief reúne o diagnóstico do perfil, a fórmula que funciona,
              os roteiros da semana e o checklist do que precisa vir do
              cliente antes de gravar.
            </p>
          </div>
          <Button variant="outline" nativeButton={false} render={<Link href="/conteudo/novo" />}>
            Criar o primeiro
          </Button>
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-10">
          {grupos.map(({ cliente, briefs: doCliente }) => (
            <section key={cliente.id}>
              <div className="flex items-baseline gap-3">
                <h2 className="heading-display text-lg">{cliente.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {doCliente.length}{" "}
                  {doCliente.length === 1 ? "documento" : "documentos"}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {doCliente.map((brief) => (
                  <BriefCard key={brief.id} brief={brief} />
                ))}
              </div>
            </section>
          ))}

          {arquivados.length > 0 ? (
            <section>
              <h2 className="heading-display text-lg text-muted-foreground">
                Arquivados
              </h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {arquivados.map((brief) => (
                  <BriefCard key={brief.id} brief={brief} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
