"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock, FileText, TriangleAlert } from "lucide-react";

import {
  PeriodPicker,
  janelaDeDias,
  type Periodo,
} from "@/components/dashboard/period-picker";
import { formatDateFull, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReportHistory as Registro } from "@/types/database";

/* =====================================================================
   Histórico de envios, com recorte por data
   ---------------------------------------------------------------------
   O filtro é NO CLIENTE, e é uma escolha, não preguiça: a página já
   carrega o histórico inteiro para a contagem do topo, e mandar o
   recorte para o servidor custaria um round-trip por clique numa lista
   que uma agência fecha na casa das centenas de linhas por ano. Quando
   passar de alguns milhares, o corte natural é levar filtro e paginação
   para a query — a assinatura deste componente não muda.

   Filtra por `created_at`, não por `delivered_at`: relatório preparado e
   ainda não enviado tem entrega nula, e sumiria do recorte justamente
   quando alguém procura o que ficou para trás.
   ===================================================================== */

const STATUS_META: Record<
  Registro["status"],
  { label: string; className: string; icon: typeof Clock }
> = {
  /* `draft` faltava no mapa da página antiga e o TypeScript não acusava
     porque lá o Record não era tipado pelo enum. Um status sem entrada
     quebraria a linha em tempo de execução. */
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground", icon: FileText },
  queued: { label: "Na fila", className: "bg-muted text-muted-foreground", icon: Clock },
  generating: { label: "Gerando", className: "bg-muted text-muted-foreground", icon: Clock },
  ready: { label: "Pronto", className: "bg-signal-muted text-signal", icon: CheckCircle2 },
  sending: { label: "Enviando", className: "bg-warning-muted text-warning", icon: Clock },
  sent: { label: "Enviado", className: "bg-positive-muted text-positive", icon: CheckCircle2 },
  failed: { label: "Falhou", className: "bg-negative-muted text-negative", icon: TriangleAlert },
};

export function ReportHistoryList({
  reports,
  clientNames,
  escopo,
}: {
  reports: Registro[];
  /** `Map` não atravessa a fronteira do servidor — chega como objeto. */
  clientNames: Record<string, string>;
  escopo: string;
}) {
  /* 90 dias e não 30: o histórico é consulta de "o que já saiu", e o
     ciclo natural de conferência com cliente é o trimestre. */
  const [periodo, setPeriodo] = useState<Periodo>(() => janelaDeDias(90));

  const filtrados = useMemo(
    () =>
      reports.filter((r) => {
        const dia = r.created_at.slice(0, 10);
        return dia >= periodo.since && dia <= periodo.until;
      }),
    [reports, periodo],
  );

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Histórico de envios
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{escopo}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-2xs tabular-nums text-muted-foreground">
            {filtrados.length} de {reports.length}
          </span>
          <PeriodPicker valor={periodo} onChange={setPeriodo} />
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-hairline py-14 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum relatório gerado ainda.
          </p>
        </div>
      ) : filtrados.length === 0 ? (
        /* Lista vazia POR FILTRO é diferente de histórico vazio, e a
           frase precisa dizer qual dos dois — senão parece perda de
           dado logo depois de a policy nova entrar. */
        <div className="mt-4 rounded-xl border border-dashed border-hairline py-14 text-center">
          <FileText className="mx-auto size-6 text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum envio neste período.
          </p>
          <p className="mt-1 text-2xs text-muted-foreground">
            Há {reports.length}{" "}
            {reports.length === 1 ? "registro" : "registros"} fora do
            recorte — amplie o intervalo.
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
            {filtrados.map((report) => {
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
                      {clientNames[report.client_id] ?? "Cliente"}
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
  );
}
