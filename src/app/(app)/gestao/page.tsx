import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Landmark,
  Repeat,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CashflowChart, GrowthChart } from "@/components/finance/finance-charts";
import { TransactionsTable } from "@/components/finance/transactions-table";
import { getClientFees, getClients, getFinancialData } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildCashflowSeries, buildFinanceSnapshot } from "@/lib/finance/kpi";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Gestão" };

/* =====================================================================
   Gestão financeira — restrita a admin
   ---------------------------------------------------------------------
   PROTEÇÃO EM DUAS CAMADAS, e elas não são redundantes:

   1. Aqui, no Server Component: `redirect("/")` para quem não é admin.
      É NAVEGAÇÃO — evita que um colaborador que digite /gestao veja um
      erro feio ou um esqueleto de página vazio.

   2. No banco, via policy `financial_admin_only`. É a SEGURANÇA. Mesmo
      que alguém contorne o redirect, a query volta com violação de
      privilégio.

   Não faço essa checagem no `proxy.ts` de propósito: ela exigiria uma
   consulta ao banco a cada requisição do matcher, e a própria
   documentação do Next diz para não usar o proxy como camada de
   autorização.
   ===================================================================== */

export default async function GestaoPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [{ transactions, monthly }, clients, fees] = await Promise.all([
    getFinancialData(12),
    getClients(),
    getClientFees(),
  ]);

  const snapshot = buildFinanceSnapshot(transactions, clients, fees);
  const series = buildCashflowSeries(monthly);

  return (
    <PageContainer>
      <PageHeader
        title="Gestão"
        description="Fluxo de caixa, recorrência e inadimplência da agência."
        actions={
          <Button variant="outline" render={<Link href="/gestao/recorrencia" />}>
            <Repeat className="size-4" />
            Recorrência
          </Button>
        }
      />

      {/* ---------------------------- KPIs ---------------------------- */}
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:gap-4">
        <FinanceCard
          icon={TrendingUp}
          label="Receita recorrente (MRR)"
          value={formatCurrency(snapshot.mrrCents)}
          hint={`${clients.filter((c) => c.status === "active").length} contas ativas`}
          index={0}
        />
        <FinanceCard
          icon={Wallet}
          label="Saldo em caixa"
          value={formatCurrency(snapshot.balanceCents)}
          hint="Somente lançamentos baixados"
          tone={snapshot.balanceCents < 0 ? "negative" : "positive"}
          index={1}
        />
        <FinanceCard
          icon={Landmark}
          label="Entradas previstas"
          value={formatCurrency(snapshot.expectedIncomeCents)}
          hint="Receita pendente no período"
          index={2}
        />
        <FinanceCard
          icon={AlertTriangle}
          label="Contas a pagar"
          value={formatCurrency(snapshot.payableCents)}
          hint="Despesa pendente"
          index={3}
        />
      </div>

      {/* Inadimplência — separado dos KPIs porque é um alerta, não um
          número de rotina. Só aparece quando existe. */}
      {snapshot.overdueCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-negative-muted px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-negative" />
          <span className="text-sm font-medium text-negative">
            {formatCurrency(snapshot.overdueIncomeCents)} em atraso
          </span>
          <span className="text-sm text-negative/85">
            {formatNumber(snapshot.overdueCount)}{" "}
            {snapshot.overdueCount === 1 ? "lançamento" : "lançamentos"} ·{" "}
            {formatPercent(snapshot.defaultRate, 1)} do previsto
          </span>
        </div>
      )}

      {/* --------------------------- Gráficos -------------------------- */}
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Panel
          title="Fluxo de caixa"
          description="Entradas contra saídas, mês a mês. Só o que foi liquidado."
        >
          <CashflowChart data={series} />
        </Panel>

        <Panel
          title="Tendência de crescimento"
          description="Caixa acumulado nos últimos 12 meses."
        >
          <GrowthChart data={series} />
        </Panel>
      </div>

      {/* ------------------------- Lançamentos ------------------------- */}
      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Lançamentos
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Últimos 12 meses. Use a baixa para registrar o que entrou ou saiu.
          </p>
        </div>

        <TransactionsTable transactions={transactions} clients={clients} />
      </section>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function FinanceCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  index,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "positive" | "negative";
  index: number;
}) {
  return (
    <article
      style={{ "--rise-delay": `${index * 55}ms` } as React.CSSProperties}
      className="rise-in surface-card flex flex-col p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="eyebrow">{label}</h3>
        <Icon className="size-4 shrink-0 text-muted-foreground/70" strokeWidth={1.9} />
      </div>

      <p
        data-slot="metric-value"
        className={cn(
          "mt-3 text-[1.85rem] font-semibold leading-none tracking-[-0.025em]",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </p>

      <p className="mt-2.5 text-xs text-muted-foreground">{hint}</p>
    </article>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
