import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { CrmWorkspace } from "@/components/crm/crm-workspace";
import {
  getAgencyContracts,
  getDeals,
  getStageEvents,
  getTeam,
} from "@/lib/data";
import { AGENCY_PARTNERS } from "@/lib/validation/client";

export const metadata: Metadata = { title: "Comercial" };

/**
 * CRM comercial: o funil de quem ainda não é cliente.
 *
 * Server Component. Os dados chegam prontos e a interatividade toda vive
 * no `CrmWorkspace`, que é cliente — mesma divisão do módulo de tarefas.
 *
 * O que o banco devolve é decidido pela RLS (`crm_deals_select`, que é
 * `using (true)`): o funil é da equipe. Não há filtro por papel aqui de
 * propósito — quem decide é o banco, não a página.
 */
export default async function ComercialPage() {
  const [deals, team, contratos, eventos] = await Promise.all([
    getDeals(),
    getTeam(),
    getAgencyContracts(),
    /* As passagens de etapa, que são a base de toda conta do funil.
       `getStageEvents` devolve `[]` no erro em vez de lançar: o quadro
       é a tela, e uma consulta de métrica que falha não pode derrubar a
       lista de negócios. */
    getStageEvents(),
  ]);

  /* Agências vêm do CADASTRO, com a lista fixa como reserva. Um negócio
     ganho vira cliente, e `clients.agency_partner` precisa casar
     caractere a caractere com `agency_contracts.agency` — oferecer um
     nome que não existe no cadastro quebraria o vínculo de faturamento
     em silêncio, que é exatamente o defeito descrito em
     `validation/client.ts`. */
  const agencias = contratos.length
    ? [...new Set(contratos.map((c) => c.agency))].sort()
    : [...AGENCY_PARTNERS];

  return (
    <PageContainer>
      <PageHeader
        title="Comercial"
        description="Quem está em negociação, quanto vale e qual é o próximo passo."
      />

      <CrmWorkspace
        deals={deals}
        team={team}
        agencias={agencias}
        eventos={eventos}
      />
    </PageContainer>
  );
}
