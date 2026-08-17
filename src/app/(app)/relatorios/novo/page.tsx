import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ReportComposer } from "@/components/reports/report-composer";
import { getClients, getReportTemplates } from "@/lib/data";

export const metadata: Metadata = { title: "Gerar relatório" };

/**
 * ⚠️ O TETO VALE PARA O SEGMENTO, e é por isso que ele está aqui.
 *
 * A justificativa original era a `gerarAnaliseIA` do botão de rascunho,
 * que não existe mais. O teto FICA por outra razão, e ela é mais forte:
 * gerar o PDF é o trabalho caro desta tela — payload, consulta à Graph
 * API pelos criativos do período, render e upload —, e uma Server Action
 * herda o `maxDuration` do segmento que a invoca, não do módulo onde
 * mora. Sem esta linha valeria o padrão curto da plataforma e a geração
 * seria cortada no meio, com o sintoma mudo de sempre: spinner some,
 * nenhum toast, nada gravado.
 *
 * Mesmo motivo do `maxDuration` em `/alertas-saldo`.
 */
export const maxDuration = 60;

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const [{ cliente }, clients, templates] = await Promise.all([
    searchParams,
    getClients(),
    getReportTemplates(),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Gerar relatório"
        description="Escolha a conta e o período. O template é o padrão do nicho."
      />

      <div className="mt-7">
        <ReportComposer
          clients={clients}
          templates={templates}
          defaultClientSlug={cliente}
        />
      </div>
    </PageContainer>
  );
}
