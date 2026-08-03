import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ReportComposer } from "@/components/reports/report-composer";
import { getClients, getReportTemplates } from "@/lib/data";

export const metadata: Metadata = { title: "Gerar relatório" };

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
