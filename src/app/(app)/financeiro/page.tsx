import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Landmark, Target, Wallet } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { HistoricoDeMeses } from "@/components/financeiro/historico-de-meses";
import { PainelDeMetas } from "@/components/financeiro/painel-de-metas";
import { PainelAsaas } from "@/components/financeiro/painel-asaas";
import { getFinancialData } from "@/lib/data";
import { primeiroDiaDoMes } from "@/lib/financeiro/categorias";
import { metasDoMes } from "@/lib/financeiro/metas";
import { assinaturasAtivas, mrrCents } from "@/lib/asaas/assinaturas";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Financeiro" };

/* =====================================================================
   Financeiro da agência
   ---------------------------------------------------------------------
   Substitui `/gestao` como lugar do dinheiro da Elo. Decidido com o
   Guilherme em 11/10/2026: telas novas, dado preservado — as 79
   receitas lançadas à mão desde agosto continuam valendo e são o
   histórico dos três primeiros meses.

   PROTEÇÃO EM DUAS CAMADAS, como em `/gestao`, e elas não são
   redundantes:

   1. Aqui, `redirect("/painel")` para quem não é admin. É NAVEGAÇÃO:
      evita que um colaborador que digite a URL veja esqueleto vazio.

   2. No banco, as policies `financial_admin_only` e
      `expense_budgets_admin_only`. É a SEGURANÇA — mesmo contornando o
      redirect, a consulta volta negada.

   Fora do `proxy.ts` de propósito: exigiria consulta ao banco a cada
   requisição do matcher, e a documentação do Next desaconselha usar o
   proxy como camada de autorização.

   ⚠️ O QUE AINDA NÃO ESTÁ AQUI: recebimentos recorrentes preenchidos
   pela API do Asaas e o extrato. Dependem da `ASAAS_API_KEY` no
   ambiente e entram em seguida — o resto da tela não espera por eles.
   ===================================================================== */

export default async function FinanceiroPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/painel");

  const mes = primeiroDiaDoMes();

  const [{ monthly }, metas, assinaturas] = await Promise.all([
    getFinancialData(12),
    metasDoMes(mes),
    isDemoMode ? Promise.resolve([]) : assinaturasAtivas().catch((e) => {
      console.error("[financeiro] asaas:", e.message);
      return [];
    }),
  ]);

  /* O mês corrente sai do MESMO array do histórico, e não de uma
     segunda consulta: duas leituras do mesmo número é como nasce a
     tela que discorda de si mesma. */
  const doMes = monthly.find((m) => m.month.slice(0, 7) === mes.slice(0, 7));

  const orcado = metas.reduce((a, m) => a + (m.temMeta ? m.limiteCents : 0), 0);
  const comprometido = metas.reduce(
    (a, m) => a + m.pagoCents + m.previstoCents,
    0,
  );
  const comMeta = metas.filter((m) => m.temMeta).length;

  const rotuloDoMes = new Date(`${mes}T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
  });

  return (
    <PageContainer>
      <PageHeader
        title="Financeiro"
        description="O dinheiro da agência: o que entrou, o que saiu e quanto podia sair."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Resumo
          icone={<Wallet className="size-4" />}
          rotulo={`Entrou em ${rotuloDoMes}`}
          valor={formatCurrency(doMes?.income_cents ?? 0)}
          nota="Só o que já foi liquidado."
        />
        <Resumo
          icone={<Landmark className="size-4" />}
          rotulo="Saiu no mês"
          valor={formatCurrency(doMes?.expense_cents ?? 0)}
          /* A nota muda com o estado: zero despesa é o normal de hoje,
             e chamá-lo de "nenhuma saída" seria afirmar algo que o
             sistema não sabe. */
          nota={
            (doMes?.expense_cents ?? 0) === 0
              ? "Nenhuma despesa lançada ainda."
              : "Só o que já foi liquidado."
          }
        />
        <Resumo
          icone={<Target className="size-4" />}
          rotulo="Orçado no mês"
          valor={orcado === 0 ? "—" : formatCurrency(orcado)}
          nota={
            comMeta === 0
              ? "Nenhuma categoria com meta."
              : `${comMeta} de ${metas.length} categorias · ${formatCurrency(comprometido)} comprometidos.`
          }
        />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Meta de gasto por categoria
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quanto a agência pretende gastar em {rotuloDoMes}. Campo vazio
          remove a meta — é diferente de meta zero, que é uma decisão.
        </p>
        <div className="mt-4">
          <PainelDeMetas mes={mes} metas={metas} rotuloDoMes={rotuloDoMes} />
        </div>
      </section>

      {assinaturas.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Assinaturas ativas
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cobranças recorrentes no Asaas, ordenadas pelo próximo vencimento.
          </p>
          <div className="mt-4">
            <PainelAsaas assinaturas={assinaturas} mrr={mrrCents(assinaturas)} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Histórico de meses
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Doze meses de fechamento, do mais recente para o mais antigo.
        </p>
        <div className="mt-4">
          <HistoricoDeMeses meses={monthly} />
        </div>
      </section>
    </PageContainer>
  );
}

function Resumo({
  icone,
  rotulo,
  valor,
  nota,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  nota: string;
}) {
  return (
    <div className="surface-card p-4">
      <p className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.08em] text-muted-foreground">
        {icone}
        {rotulo}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{valor}</p>
      <p className="mt-1 text-2xs text-muted-foreground">{nota}</p>
    </div>
  );
}
