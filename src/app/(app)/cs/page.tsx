import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageContainer } from "@/components/layout/page-header";
import { PainelDoCs } from "@/components/cs/painel-do-cs";
import { getPainelDoCs } from "@/lib/cs/dados";

export const metadata: Metadata = { title: "Painel do CS" };

/**
 * Painel do CS: a semana do atendimento numa tela. Lê sob RLS a carteira
 * que a pessoa enxerga; ver `lib/cs/dados.ts`.
 */
export default async function PainelDoCsPage() {
  const dados = await getPainelDoCs();
  if (!dados) redirect("/login");

  return (
    <PageContainer>
      <PainelDoCs dados={dados} />
    </PageContainer>
  );
}
