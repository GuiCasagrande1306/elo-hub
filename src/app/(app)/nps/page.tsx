import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PainelNps } from "@/components/nps/painel-nps";
import { serverEnv } from "@/lib/env";
import { dadosDoPainelNps } from "@/lib/nps/dados";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "NPS dos clientes" };
export const dynamic = "force-dynamic";

export default async function NpsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/painel");

  const { respostas, clientes } = await dadosDoPainelNps();

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="NPS dos clientes"
        description="Pesquisa trimestral de satisfação: quanto os clientes recomendam a agência e o que precisa melhorar."
      />
      <PainelNps
        respostas={respostas}
        clientes={clientes}
        baseDoLink={`${serverEnv.appUrl.replace(/\/$/, "")}/pesquisa/`}
      />
    </PageContainer>
  );
}
