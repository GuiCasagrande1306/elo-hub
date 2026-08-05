import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ClientsDirectory } from "@/components/clients/clients-directory";
import { NewClientSheet } from "@/components/clients/new-client-sheet";
import { getClientsWithGoals } from "@/lib/data";
import { mesCorrenteBR, nomeDoMes } from "@/lib/date-br";
import { formatCurrency, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Clientes" };

/**
 * Listagem de clientes com acompanhamento de metas.
 *
 * Server Component: busca sob RLS e agrega o executado a partir de
 * `daily_metrics` — a carteira já chega filtrada, sem nenhuma checagem
 * de papel nesta página. Toda a interatividade (busca, filtros, canal do
 * Realtime) vive em `ClientsDirectory`.
 *
 * Nota de rota: o pedido citava `app/clients/page.tsx`. O projeto usa
 * rotas em português dentro do grupo autenticado, então isto é
 * `app/(app)/clientes/page.tsx` — criar um `/clients` paralelo
 * duplicaria a tela e quebraria os links já existentes na sidebar.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;

  /* Entrada do usuário: só aceitamos "YYYY-MM" plausível. Um mês
     inválido cai no corrente em vez de virar erro — filtro quebrado não
     pode derrubar a listagem inteira. */
  const mesValido = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
  const mesAtual = mesCorrenteBR().referencia;
  const mes = mesValido ?? mesAtual;

  const rows = await getClientsWithGoals(mes === mesAtual ? undefined : mes);

  // Totais da carteira: o número que o dono da agência olha primeiro.
  const totals = rows.reduce(
    (acc, row) => ({
      planned: acc.planned + (row.goal?.planned_budget_cents ?? 0),
      executed: acc.executed + row.computedSpendCents,
      results: acc.results + row.computedResults,
      withGoal: acc.withGoal + (row.goal ? 1 : 0),
    }),
    { planned: 0, executed: 0, results: 0, withGoal: 0 },
  );

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        description={
          /* Nomear o mês importa mais quando NÃO é o corrente: sem
             isso, olhar julho e ler "ciclo atual" faz o número parecer
             de agosto. */
          totals.withGoal > 0
            ? `${totals.withGoal} de ${rows.length} contas com meta definida em ${nomeDoMes(mes)}.`
            : `Nenhuma conta com meta definida em ${nomeDoMes(mes)}.`
        }
        // O botão vive DENTRO do Sheet (é o `SheetTrigger`), então o
        // estado de abertura não precisa subir para esta página, que é
        // Server Component.
        actions={<NewClientSheet />}
      />

      {/* Resumo da carteira ---------------------------------------- */}
      {rows.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Verba planejada"
            value={
              totals.planned > 0 ? formatCurrency(totals.planned) : "—"
            }
          />
          <SummaryTile
            label="Investido no ciclo"
            value={formatCurrency(totals.executed)}
          />
          <SummaryTile
            label="Resultados"
            value={formatNumber(Math.round(totals.results))}
          />
          <SummaryTile
            label="Contas ativas"
            value={String(
              rows.filter((r) => r.client.status === "active").length,
            )}
          />
        </dl>
      )}

      <div className="mt-7">
        <ClientsDirectory rows={rows} month={mes} />
      </div>
    </PageContainer>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2/50 p-3.5 ring-1 ring-hairline">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums tracking-[-0.02em]">
        {value}
      </dd>
    </div>
  );
}
