import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ContractsTable } from "@/components/finance/contracts-table";
import { MaterializeButton } from "@/components/finance/materialize-button";
import { RecurringExpensesPanel } from "@/components/finance/recurring-expenses-panel";
import {
  getClientFinancials,
  getClients,
  getRecurringExpenses,
} from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { mesCorrente, proximoMes, rotuloMes } from "@/lib/finance/recurrence";
import { formatCurrency } from "@/lib/format";

export const metadata: Metadata = { title: "Recorrência" };

/* =====================================================================
   Recorrência — o que se repete todo mês
   ---------------------------------------------------------------------
   Esta tela não mostra dinheiro que entrou; mostra o CONTRATO. É a
   diferença entre ela e /gestao, e a razão de serem duas páginas: lá se
   dá baixa no que aconteceu, aqui se define o que vai acontecer.

   Mesma proteção em duas camadas de /gestao: `redirect` para navegação,
   RLS para segurança.
   ===================================================================== */

export default async function RecorrenciaPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [clients, financials, expenses] = await Promise.all([
    getClients(),
    getClientFinancials(),
    getRecurringExpenses(),
  ]);

  /* Só cliente ativo aparece: pausado e churn não geram cobrança, e
     deixá-los na lista faria alguém preencher um dia de vencimento que
     o job vai ignorar de qualquer forma. */
  const ativos = clients.filter((c) => c.status === "active");

  /* Previsto = o que o job CONSEGUE materializar hoje, não a soma dos
     honorários. Contrato sem dia de vencimento fica de fora da conta
     pela mesma razão que fica de fora do job — mostrar o total cheio
     aqui prometeria uma entrada que não vai ser gerada. */
  const entradasPrevistas = ativos.reduce((acc, c) => {
    const f = financials.get(c.id);
    return f?.billing_day ? acc + f.monthly_fee_cents : acc;
  }, 0);

  const saidasPrevistas = expenses
    .filter((d) => d.is_active)
    .reduce((acc, d) => acc + d.amount_cents, 0);

  const atual = mesCorrente();

  return (
    <PageContainer>
      <Link
        href="/gestao"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Gestão
      </Link>

      <PageHeader
        title="Recorrência"
        description="O que se repete todo mês: honorário de cliente e custo fixo da agência."
      />

      {/* ------------------------- Resumo -------------------------- */}
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <Resumo
          label="Entradas previstas"
          value={formatCurrency(entradasPrevistas)}
          hint="Contratos com dia de cobrança definido"
        />
        <Resumo
          label="Saídas previstas"
          value={formatCurrency(saidasPrevistas)}
          hint={`${expenses.filter((d) => d.is_active).length} despesas ativas`}
        />
        <Resumo
          label="Resultado previsto"
          value={formatCurrency(entradasPrevistas - saidasPrevistas)}
          hint="Antes de projeto pontual e verba de mídia"
          tone={entradasPrevistas - saidasPrevistas < 0 ? "negative" : "positive"}
        />
      </div>

      {/* --------------------- Emissão do mês ---------------------- */}
      <section className="surface-card mt-7 p-5 sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold tracking-[-0.01em]">
            Emitir o mês
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cria os lançamentos previstos em Gestão, como pendentes. Rodar de
            novo não duplica nada — o que já existe é ignorado.
          </p>
        </header>

        <MaterializeButton
          meses={[
            { valor: atual, rotulo: rotuloMes(atual) },
            { valor: proximoMes(atual), rotulo: rotuloMes(proximoMes(atual)) },
          ]}
        />
      </section>

      {/* ------------------------ Contratos ------------------------ */}
      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Contratos
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Honorário e dia de vencimento. Sem os dois preenchidos, o cliente
            fica fora do faturamento do mês.
          </p>
        </div>

        <ContractsTable
          clients={ativos}
          /* Map não atravessa a fronteira de serialização para Client
             Component — vira objeto aqui. */
          financials={Object.fromEntries(
            ativos.map((c) => {
              const f = financials.get(c.id);
              return [
                c.id,
                {
                  monthly_fee_cents: f?.monthly_fee_cents ?? 0,
                  billing_day: f?.billing_day ?? null,
                },
              ];
            }),
          )}
        />
      </section>

      {/* -------------------- Despesas fixas ----------------------- */}
      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Despesas recorrentes
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Folha, assinaturas e impostos. Desligar tira do próximo mês sem
            apagar o histórico.
          </p>
        </div>

        <RecurringExpensesPanel expenses={expenses} />
      </section>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function Resumo({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <article className="surface-card p-5">
      <h3 className="eyebrow">{label}</h3>
      <p
        data-slot="metric-value"
        className={`mt-3 text-[1.6rem] font-semibold leading-none tracking-[-0.025em] ${
          tone === "negative" ? "text-negative" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-2.5 text-xs text-muted-foreground">{hint}</p>
    </article>
  );
}
