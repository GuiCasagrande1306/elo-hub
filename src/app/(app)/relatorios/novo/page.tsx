import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ReportComposer } from "@/components/reports/report-composer";
import { getClients, getReportTemplates } from "@/lib/data";

export const metadata: Metadata = { title: "Gerar relatório" };

/**
 * ⚠️ O TETO VALE PARA A SERVER ACTION, e é por isso que ele está aqui.
 *
 * `gerarAnaliseIA` é chamada pelo botão "Escrever rascunho com IA" e
 * herda o `maxDuration` DO SEGMENTO que a invoca — esta página —, não do
 * módulo onde ela mora. Sem esta linha valia o padrão curto da
 * plataforma: a ação monta o payload do relatório (duas consultas) e só
 * então abre o stream do modelo, e a função era cortada antes de
 * responder. O sintoma era mudo: o spinner sumia, nenhum toast aparecia
 * e os campos continuavam vazios.
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
        description="Compile o período, escreva a leitura do time e envie ao cliente."
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
