import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, FileText, TriangleAlert } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TemplateSettingsDialog } from "@/components/reports/template-settings-dialog";
import { getCurrentUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  getClients,
  getClientsWithGoals,
  getReports,
  getReportTemplates,
} from "@/lib/data";
import { formatDateFull, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientSegment, ReportStatus } from "@/types/database";
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

const STATUS_META: Record<
  ReportStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground", icon: FileText },
  queued: { label: "Na fila", className: "bg-muted text-muted-foreground", icon: Clock },
  generating: { label: "Gerando", className: "bg-warning-muted text-warning", icon: Clock },
  ready: { label: "Pronto", className: "bg-signal-muted text-signal", icon: CheckCircle2 },
  sending: { label: "Enviando", className: "bg-warning-muted text-warning", icon: Clock },
  sent: { label: "Enviado", className: "bg-positive-muted text-positive", icon: CheckCircle2 },
  failed: { label: "Falhou", className: "bg-negative-muted text-negative", icon: TriangleAlert },
};

export default async function ReportsPage() {
  /* O papel decide o que a TELA diz; quem decide o que o banco DEVOLVE é
     a policy `report_history_select` (migration 30): admin vê tudo,
     colaborador vê os próprios envios e a fila do cron. Sem a frase, um
     colaborador leria a lista curta como perda de dado. */
  const user = await getCurrentUser();

  const [templates, reports, clients, pendentes, comMetricas] =
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
    ]);

  const resumos = comMetricas.map((linha) => ({
    id: linha.client.id,
    name: linha.client.name,
    spendCents: linha.computedSpendCents,
    /* O resultado já vem na unidade da conta: faturamento numa loja,
       contagem numa clínica. É o texto do WhatsApp que se monta com
       isso — escrever "Resultados: 4.820" onde são R$ 48,20 de receita
       mandaria o erro direto para o cliente final. */
    resultValue: linha.computedGoalValue,
    metric: linha.metric,
  }));

  const clientName = (id: string) =>
    clients.find((c) => c.id === id)?.name ?? "Cliente";

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

      <div className="mt-6">
        <CommandStation
          clients={resumos}
          templates={templates.map((t) => ({ id: t.id, name: t.name }))}
        />
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

      {/* Histórico ------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Histórico de envios
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {user?.role === "admin"
            ? "Todos os envios da equipe."
            : "Seus envios e os relatórios que o robô preparou."}
        </p>

        {reports.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-hairline py-14 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum relatório gerado ainda.
            </p>
          </div>
        ) : (
          <div className="surface-card mt-4 overflow-hidden">
            <div className="hidden grid-cols-[1fr_180px_130px_120px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
              {["Relatório", "Período", "Status", "Enviado em"].map((label) => (
                <span key={label} className="eyebrow">
                  {label}
                </span>
              ))}
            </div>

            <ul className="divide-y divide-hairline">
              {reports.map((report) => {
                const status = STATUS_META[report.status];
                return (
                  <li
                    key={report.id}
                    className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_180px_130px_120px] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {report.title}
                      </p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {clientName(report.client_id)}
                        {report.channel === "whatsapp" && report.recipient
                          ? ` · WhatsApp ${report.recipient}`
                          : ""}
                      </p>
                    </div>

                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatPeriod(report.period_start, report.period_end)}
                    </span>

                    <span
                      className={cn(
                        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
                        status.className,
                      )}
                    >
                      <status.icon className="size-3" />
                      {status.label}
                    </span>

                    <span className="text-xs tabular-nums text-muted-foreground">
                      {report.delivered_at
                        ? formatDateFull(report.delivered_at)
                        : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
