import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Clock, FileText, TriangleAlert } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getClients, getReports, getReportTemplates } from "@/lib/data";
import { formatDateFull, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientSegment, ReportStatus } from "@/types/database";
import { listarPendentes } from "./actions";
import { SendQueue } from "./send-queue";

export const metadata: Metadata = { title: "Relatórios" };

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  ecommerce: "E-commerce",
  local_business: "Negócio local",
  launch: "Lançamento",
  saas: "SaaS",
  infoproduct: "Infoproduto",
  b2b_services: "Serviços B2B",
  other: "Outro",
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
  const [templates, reports, clients, pendentes] = await Promise.all([
    getReportTemplates(),
    getReports(),
    getClients(),
    listarPendentes(),
  ]);

  const clientName = (id: string) =>
    clients.find((c) => c.id === id)?.name ?? "Cliente";

  return (
    <PageContainer>
      <PageHeader
        title="Relatórios"
        description="Templates por segmento e histórico de envios."
        actions={
          <Button
            size="sm"
            className="h-9"
            nativeButton={false}
            render={<Link href="/relatorios/novo" />}
          >
            Gerar relatório
          </Button>
        }
      />

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

        <SendQueue itens={pendentes} />
      </section>

      {/* Templates ------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Templates por segmento
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          O segmento do cliente define automaticamente quais métricas e seções
          entram no PDF.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => (
            <article key={template.id} className="surface-card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-medium ring-1 ring-hairline">
                  {template.segment
                    ? SEGMENT_LABELS[template.segment]
                    : "Genérico"}
                </span>
                {template.is_default && (
                  <span className="text-2xs text-signal">padrão</span>
                )}
              </div>

              <h3 className="mt-3 text-sm font-semibold leading-snug">
                {template.name}
              </h3>
              <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
                {template.description}
              </p>

              <div className="mt-4 border-t border-hairline pt-3">
                <p className="eyebrow mb-2">Métricas em destaque</p>
                <div className="flex flex-wrap gap-1">
                  {template.metrics.slice(0, 5).map((metric) => (
                    <span
                      key={metric}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {metric}
                    </span>
                  ))}
                </div>
                <p className="mt-2.5 text-2xs text-muted-foreground">
                  {template.sections.length} seções no PDF
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Histórico ------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Histórico de envios
        </h2>

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
