import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Landmark, Target, Wallet } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { LancarTransacaoModal } from "@/components/financeiro/lancar-transacao-modal";
import { ExtratoAsaas } from "@/components/financeiro/extrato-asaas";
import { GraficoFluxo } from "@/components/financeiro/grafico-fluxo";
import { HistoricoDeMeses } from "@/components/financeiro/historico-de-meses";
import { PainelDeMetas } from "@/components/financeiro/painel-de-metas";
import { PainelAsaas } from "@/components/financeiro/painel-asaas";
import { getFinancialData } from "@/lib/data";
import { primeiroDiaDoMes } from "@/lib/financeiro/categorias";
import { metasDoMes } from "@/lib/financeiro/metas";
import { assinaturasAtivas, mrrCents } from "@/lib/asaas/assinaturas";
import { extratoAsaas } from "@/lib/asaas/extrato";
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

  /* Mês corrente: início e fim para o extrato do mês */
  const fimDoMesDate = new Date(`${mes}T12:00:00`);
  fimDoMesDate.setMonth(fimDoMesDate.getMonth() + 1);
  fimDoMesDate.setDate(0);
  const mesInicio = mes;
  const mesFim = fimDoMesDate.toISOString().slice(0, 10);

  /* Janela de 12 meses para o histórico — inicia no dia 1 de 12 meses atrás */
  const inicio12mDate = new Date(`${mes}T12:00:00`);
  inicio12mDate.setMonth(inicio12mDate.getMonth() - 11);
  const inicio12m = inicio12mDate.toISOString().slice(0, 10);

  const [{ monthly }, assinaturas, movimentacoes, movimentacoes12m] = await Promise.all([
    getFinancialData(12),
    isDemoMode ? Promise.resolve([]) : assinaturasAtivas().catch((e) => {
      console.error("[financeiro] asaas:", e.message);
      return [];
    }),
    isDemoMode ? Promise.resolve([]) : extratoAsaas(mesInicio, mesFim).catch((e) => {
      console.error("[financeiro] extrato asaas:", e.message);
      return [];
    }),
    isDemoMode ? Promise.resolve([]) : extratoAsaas(inicio12m, mesFim).catch((e) => {
      console.error("[financeiro] extrato 12m asaas:", e.message);
      return [];
    }),
  ]);

  /* Agrupa débitos do Asaas por mês ("YYYY-MM") para preencher expense_cents */
  const debitosPorMes: Record<string, number> = {};
  for (const m of movimentacoes12m) {
    if (m.value < 0) {
      const ym = m.date.slice(0, 7);
      debitosPorMes[ym] = (debitosPorMes[ym] ?? 0) + Math.abs(m.value);
    }
  }

  /* Converte para centavos e mescla Asaas + lançamentos manuais */
  const monthlyComSaidas = monthly.map((m) => {
    const ym = m.month.slice(0, 7);
    const asaasCents = Math.round((debitosPorMes[ym] ?? 0) * 100);
    const saidaCents = asaasCents + m.expense_cents; // m.expense_cents = lançamentos manuais do banco
    return {
      ...m,
      expense_cents: saidaCents,
      net_cents: m.income_cents - saidaCents,
    };
  });

  const doMes = monthlyComSaidas.find((m) => m.month.slice(0, 7) === mes.slice(0, 7));
  const incomeCents = doMes?.income_cents ?? 0;

  const metas = await metasDoMes(mes, incomeCents);

  /* O mês corrente sai do MESMO array do histórico — ver lógica acima. */

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

      {/* ── Cards de resumo ── */}
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

      {/* ── Gráfico de fluxo ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Fluxo dos últimos 6 meses
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Entradas e saídas liquidadas, mês a mês.
        </p>
        <div className="mt-4 surface-card p-4">
          <GraficoFluxo meses={monthlyComSaidas} />
        </div>
      </section>

      {/* ── Extrato Asaas ── */}
      <section className="mt-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.015em]">
              Extrato Asaas — {rotuloDoMes}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Movimentação da conta Asaas no mês. Para outros bancos, use o botão ao lado.
            </p>
          </div>
          <LancarTransacaoModal />
        </div>
        <div className="mt-4">
          <ExtratoAsaas
            movimentacoes={movimentacoes}
            saldoFinal={movimentacoes.length > 0 ? movimentacoes[0]!.balance : null}
          />
        </div>
      </section>

      {/* ── Meta de gasto ── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Meta de gasto por categoria
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quanto a agência pretende gastar em {rotuloDoMes}. Campo vazio
          remove a meta — é diferente de meta zero, que é uma decisão.
        </p>
        <div className="mt-4">
          <PainelDeMetas mes={mes} metas={metas} rotuloDoMes={rotuloDoMes} incomeCents={incomeCents} />
        </div>
      </section>

      {/* ── Assinaturas — gaveta ── */}
      {assinaturas.length > 0 && (
        <details className="group mt-8">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.015em]">
                Assinaturas ativas
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({assinaturas.length}) · MRR {formatCurrency(mrrCents(assinaturas))}
                </span>
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cobranças recorrentes no Asaas, ordenadas pelo próximo vencimento.
              </p>
            </div>
            <span className="ml-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-4">
            <PainelAsaas assinaturas={assinaturas} mrr={mrrCents(assinaturas)} />
          </div>
        </details>
      )}

      {/* ── Histórico — gaveta ── */}
      <details className="group mt-8">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.015em]">
              Histórico de meses
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Doze meses de fechamento, do mais recente para o mais antigo.
            </p>
          </div>
          <span className="ml-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-4">
          <HistoricoDeMeses meses={monthlyComSaidas} />
        </div>
      </details>
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
