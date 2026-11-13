import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { NewClientSheet } from "@/components/clients/new-client-sheet";
import { OnboardingBoard } from "@/components/onboarding/onboarding-board";
import { getAgencies, getClients } from "@/lib/data";

export const metadata: Metadata = { title: "Onboarding" };

/**
 * Clientes entrando: status `onboarding`. O cadastro de cliente novo
 * mora AQUI (o formulário já nasce com status Onboarding). Saem daqui (e entram em
 * Clientes) pelo botão do checklist a 100%, que vira o status para
 * `active`. A lista vem sob RLS, como a de Clientes.
 */
export default async function OnboardingPage() {
  const [todos, agencias] = await Promise.all([getClients(), getAgencies()]);
  const clients = todos.filter((c) => c.status === "onboarding");

  return (
    <PageContainer>
      <PageHeader
        title="Onboarding"
        description={
          clients.length === 1
            ? "1 cliente entrando."
            : `${clients.length} clientes entrando.`
        }
        actions={<NewClientSheet agencias={agencias.map((a) => a.agency)} />}
      />
      <div className="mt-7">
        <OnboardingBoard clients={clients} />
      </div>
    </PageContainer>
  );
}
