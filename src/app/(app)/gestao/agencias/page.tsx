import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { AgenciesWorkspace } from "@/components/finance/agencies-workspace";
import { getAgencies, getClients } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Agências" };

/* =====================================================================
   Cadastro de agências
   ---------------------------------------------------------------------
   A lista que antes era `const` no código. Duas coisas moram na mesma
   linha porque são a mesma entidade vista de dois ângulos:

     IDENTIDADE  nome, cor e logo — o que o cliente final vê assinando o
                 relatório da conta que aquela agência atende.
     CONTRATO    honorário e dia de cobrança — o que a agência paga.

   Separá-las em duas telas obrigaria a cadastrar a mesma agência duas
   vezes, com o risco clássico de a grafia divergir entre elas.

   SÓ ADMIN, e a trava real está na policy: mexer aqui move dinheiro de
   lugar, porque a régua de faturamento decide pela agência do cliente.
   ===================================================================== */

export default async function AgenciasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [agencias, clients] = await Promise.all([getAgencies(), getClients()]);

  /* Quantos clientes cada agência atende. Vai junto porque é o número
     que decide se dá para remover a linha — e porque ver "12 contas" ao
     lado do honorário é o que denuncia um valor desatualizado. */
  const contas = new Map<string, number>();
  for (const c of clients) {
    if (!c.agency_partner) continue;
    contas.set(c.agency_partner, (contas.get(c.agency_partner) ?? 0) + 1);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Agências"
        description="Quem atende cada conta, o que assina os relatórios e o que paga de honorário."
      />

      <AgenciesWorkspace
        agencias={agencias.map((a) => ({
          ...a,
          clientes: contas.get(a.agency) ?? 0,
        }))}
      />
    </PageContainer>
  );
}
