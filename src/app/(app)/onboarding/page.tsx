import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { OnboardingBoard } from "@/components/onboarding/onboarding-board";
import { getClients } from "@/lib/data";

export const metadata: Metadata = { title: "Onboarding" };

/**
 * Clientes entrando: status `onboarding`. Saem daqui (e entram em
 * Clientes) pelo botão do checklist a 100%, que vira o status para
 * `active`. A lista vem sob RLS, como a de Clientes.
 */
export default async function OnboardingPage() {
  const clients = (await getClients()).filter((c) => c.status === "onboarding");

  return (
    <PageContainer>
      <PageHeader
        title="Onboarding"
        description={
          clients.length === 1
            ? "1 cliente entrando."
            : `${clients.length} clientes entrando.`
        }
      />
      <div className="mt-7">
        <OnboardingBoard clients={clients} />
      </div>
    </PageContainer>
  );
}
