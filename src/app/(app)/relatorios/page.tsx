import Link from "next/link";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TemplateSettingsDialog } from "@/components/reports/template-settings-dialog";
import { ReportHistoryList } from "@/components/reports/report-history";
import { ReportSetupTable } from "@/components/reports/report-setup-table";
import { getCurrentUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  getClients,
  getClientsWithGoals,
  getReports,
  getReportSetup,
  getReportTemplates,
} from "@/lib/data";
import { resolverTemplate } from "@/lib/reports/template-resolver";
import type { ClientSegment } from "@/types/database";
import { listarPendentes } from "./actions";
import { SendQueue } from "./send-queue";
import { CommandStation } from "./command-station";

export const metadata: Metadata = { title: "Relatórios" };

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};


export default async function ReportsPage() {
  /* O papel decide o que a TELA diz; quem decide o que o banco DEVOLVE é
     a policy `report_history_select` (migration 30): admin vê tudo,
     colaborador vê os próprios envios e a fila do cron. Sem a frase, um
     colaborador leria a lista curta como perda de dado. */
  const user = await getCurrentUser();

  const [templates, reports, clients, pendentes, comMetricas, agenda] =
    await Promise.all([
      getReportTemplates(),
      getReports(),
      getClients(),
      listarPendentes(),
      /* Resumo REAL por cliente, somado de `daily_metrics` no servidor.
         A estação troca os números junto com a seleção sem ida ao banco,
         e nenhum valor da tela é inventado — o texto que sai daqui vai
         para o cliente final. */
      getClientsWithGoals(),
      /* Quem está pronto para receber automático. Vem primeiro na tela
         porque é o que destrava tudo abaixo: sem destino e dia, o cron
         não prepara e a fila nasce vazia. */
      getReportSetup(),
    ]);

  const resumos = comMetricas.map((linha) => ({
    id: linha.client.id,
    /* O compositor identifica a conta pelo SLUG, não pelo id — é o slug
       que vai na URL e o que `getClientBySlug` resolve. Mandar o id daqui
       abria o compositor em branco. */
    slug: linha.client.slug,
    name: linha.client.name,
    spendCents: linha.computedSpendCents,
    /* O resultado já vem na unidade da conta: faturamento numa loja,
       contagem numa clínica. É o texto do WhatsApp que se monta com
       isso — escrever "Resultados: 4.820" onde são R$ 48,20 de receita
       mandaria o erro direto para o cliente final. */
    resultValue: linha.computedGoalValue,
    metric: linha.metric,
    /* A janela que o servidor de fato somou. Vai junto porque é ela que
       rotula a mensagem enviada ao cliente — antes a tela escolhia um
       rótulo ("últimos 7 dias") que não tinha relação com o número. */
    period: linha.period,
    /* Resolvido AQUI, pela mesma função que o compositor usa para gerar
       o PDF. A estação só exibe: o template é consequência do segmento,
       e o lugar de trocá-lo é o compositor, onde a escolha chega até a
       geração. */
    templateName:
      resolverTemplate(templates, linha.client.segment)?.name ??
      "Padrão do segmento",
  }));


  return (
    <PageContainer>
      <PageHeader
        title="Relatórios"
        description="O que sai hoje e o que já saiu."
        actions={
          <>
            {/* Templates viraram CONFIGURAÇÃO atrás de um botão: mexidos
                talvez uma vez por trimestre, ocupavam metade da tela que
                deveria mostrar o que precisa ser enviado hoje. */}
            {user?.role === "admin" && (
              <TemplateSettingsDialog
                templates={templates.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  segmentLabel: t.segment
                    ? SEGMENT_LABELS[t.segment]
                    : "Genérico",
                  metrics: t.metrics,
                  metricLabels: t.metric_labels ?? {},
                  highlightMetric: t.highlight_metric ?? null,
                  sectionCount: t.sections.length,
                }))}
              />
            )}
            <Button
              size="sm"
              className="h-9"
              nativeButton={false}
              render={<Link href="/relatorios/novo" />}
            >
              Gerar relatório
            </Button>
          </>
        }
      />

      {/* AGENDA ANTES DA ESTAÇÃO. A página inteira pressupunha um fluxo
          configurado; medido em 08/08/2026, nenhuma das 47 contas ativas
          tinha envio ligado. Enquanto houver pendência, o primeiro
          bloco tem de ser o que a resolve — e ele se recolhe sozinho
          quando não houver mais. */}
      <ReportSetupTable linhas={agenda} />

      <div className="mt-8">
        <CommandStation clients={resumos} />
      </div>

      {/* Fila de envio ---------------------------------------------
          Primeiro na página porque é a única seção com trabalho a
          fazer hoje; templates e histórico são consulta. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Aguardando envio
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          O robô gera o PDF na madrugada; você confere e dispara. A mensagem
          sai do <strong>seu</strong> WhatsApp — conecte-o em Configurações.
        </p>

        <span id="fila-de-envio" className="scroll-mt-20" />
      <SendQueue itens={pendentes} />
      </section>

      <ReportHistoryList
        reports={reports}
        /* `Map` não serializa para Client Component — vira objeto. */
        clientNames={Object.fromEntries(clients.map((c) => [c.id, c.name]))}
        escopo={
          user?.role === "admin"
            ? "Todos os envios da equipe."
            : "Seus envios e os relatórios que o robô preparou."
        }
      />

    </PageContainer>
  );
}
