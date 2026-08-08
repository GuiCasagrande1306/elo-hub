import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Database } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ContractsTable } from "@/components/finance/contracts-table";
import type { LinhaDeContrato } from "@/components/finance/contracts-table";
import { MaterializeButton } from "@/components/finance/materialize-button";
import { RecurringExpensesPanel } from "@/components/finance/recurring-expenses-panel";
import {
  SchemaPendenteError,
  getAgencyContracts,
  getClientFinancials,
  getClients,
  getRecurringExpenses,
} from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { mesCorrente, proximoMes, rotuloMes } from "@/lib/finance/recurrence";
import { ehTerceirizado } from "@/lib/validation/client";
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

  /* O deploy sobe o código; a migration é rodada à mão no Supabase.
     Entre um e outro, esta tela pede colunas que ainda não existem — e
     um 500 numa página que o menu de Gestão já linka é pior que uma
     instrução. Ver `SchemaPendenteError`. */
  let clients: Awaited<ReturnType<typeof getClients>>;
  let financials: Awaited<ReturnType<typeof getClientFinancials>>;
  let expenses: Awaited<ReturnType<typeof getRecurringExpenses>>;
  let agencies: Awaited<ReturnType<typeof getAgencyContracts>>;

  try {
    [clients, financials, expenses, agencies] = await Promise.all([
      getClients(),
      getClientFinancials(),
      getRecurringExpenses(),
      getAgencyContracts(),
    ]);
  } catch (error) {
    if (error instanceof SchemaPendenteError) return <MigrationPendente />;
    throw error;
  }

  /* Só cliente ativo aparece: pausado e churn não geram cobrança, e
     deixá-los na lista faria alguém preencher um dia de vencimento que
     o job vai ignorar de qualquer forma. */
  const ativos = clients.filter((c) => c.status === "active");

  /* A carteira se parte em dois: quem a Elo fatura e quem a agência
     paga. `ehTerceirizado` é a mesma função que o job usa — a lista e o
     mês emitido não têm como divergir. */
  const diretos = ativos.filter((c) => !ehTerceirizado(c));
  const terceirizados = ativos.filter(ehTerceirizado);

  /* Toda agência que aparece na carteira, tenha contrato cadastrado ou
     não: a que não tem é justamente a que precisa aparecer, porque os
     clientes dela já não geram cobrança própria. */
  const clientesPorAgencia = new Map<string, number>();
  for (const c of terceirizados) {
    clientesPorAgencia.set(
      c.agency_partner,
      (clientesPorAgencia.get(c.agency_partner) ?? 0) + 1,
    );
  }

  const nomesDeAgencia = [
    ...new Set([
      ...clientesPorAgencia.keys(),
      ...agencies.map((a) => a.agency),
    ]),
  ].sort();

  const contratosDeAgencia = new Map(agencies.map((a) => [a.agency, a]));

  const linhas: LinhaDeContrato[] = [
    ...nomesDeAgencia.map<LinhaDeContrato>((nome) => {
      const contrato = contratosDeAgencia.get(nome);
      return {
        key: `agencia:${nome}`,
        tipo: "agencia",
        id: nome,
        nome,
        feeCents: contrato?.monthly_fee_cents ?? 0,
        billingDay: contrato?.billing_day ?? null,
        clientes: clientesPorAgencia.get(nome) ?? 0,
      };
    }),
    ...diretos.map<LinhaDeContrato>((c) => {
      const f = financials.get(c.id);
      return {
        key: `cliente:${c.id}`,
        tipo: "cliente",
        id: c.id,
        nome: c.name,
        feeCents: f?.monthly_fee_cents ?? 0,
        billingDay: f?.billing_day ?? null,
        logoUrl: c.logo_url,
        brandPrimary: c.brand_primary,
      };
    }),
  ];

  /* Previsto = o que o job CONSEGUE materializar hoje, não a soma dos
     honorários. Contrato sem dia de vencimento fica de fora da conta
     pela mesma razão que fica de fora do job — mostrar o total cheio
     aqui prometeria uma entrada que não vai ser gerada. */
  const entradasPrevistas = linhas.reduce(
    (acc, l) => (l.billingDay ? acc + l.feeCents : acc),
    0,
  );

  /* Cliente coberto por agência que ainda não tem honorário fechado. É
     receita que sumiu do previsto sem ninguém decidir isso — e o número
     precisa estar no resumo, não escondido numa linha da tabela. */
  const semCobertura = linhas
    .filter((l) => l.tipo === "agencia" && !(l.feeCents > 0 && l.billingDay))
    .reduce((acc, l) => acc + (l.clientes ?? 0), 0);

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
          hint={
            semCobertura > 0
              ? `Faltam ${semCobertura} clientes: a agência deles não tem honorário`
              : "Contratos com dia de cobrança definido"
          }
          tone={semCobertura > 0 ? "warning" : "neutral"}
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
            Honorário e dia de vencimento. Sem os dois preenchidos, o contrato
            fica fora do faturamento do mês. Cliente de agência não aparece
            aqui: quem paga é a agência, um valor só.
          </p>
        </div>

        <ContractsTable linhas={linhas} />
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
  tone?: "neutral" | "positive" | "negative" | "warning";
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
      <p
        className={`mt-2.5 text-xs ${
          tone === "warning" ? "font-medium text-warning" : "text-muted-foreground"
        }`}
      >
        {hint}
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A migration 29 ainda não foi aplicada.
 *
 * Estado transitório de propósito visível: some sozinho assim que o SQL
 * roda, e enquanto está aqui diz exatamente o que falta — em vez de
 * "column does not exist" no log da Vercel.
 */
function MigrationPendente() {
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
        description="O banco ainda não tem as tabelas desta tela."
      />

      <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
        <Database className="size-7 text-warning" strokeWidth={1.7} />

        <p className="text-sm font-medium">Falta rodar a migration</p>

        <p className="max-w-prose text-sm text-muted-foreground">
          O código desta tela já está no ar, mas as tabelas e colunas que
          ela usa (dia de cobrança, despesas recorrentes e contrato de
          agência) ainda não existem no banco.
        </p>

        <p className="max-w-prose text-xs text-muted-foreground">
          No Supabase, abra o <strong>SQL Editor</strong> e rode, nesta ordem,
          o conteúdo de{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5">
            supabase/migrations/20260807000029_financeiro_recorrente.sql
          </code>{" "}
          e{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5">
            supabase/migrations/20260808000031_contratos_de_agencia.sql
          </code>
          . Depois recarregue esta página.
        </p>

        <p className="max-w-prose text-2xs text-muted-foreground">
          Nada mais do sistema depende dessa migration — Gestão, Performance e
          os alertas de saldo seguem funcionando normalmente.
        </p>
      </div>
    </PageContainer>
  );
}
