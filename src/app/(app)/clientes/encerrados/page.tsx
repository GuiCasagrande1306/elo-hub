import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Archive } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ChurnedList } from "@/components/clients/churned-list";
import { Button } from "@/components/ui/button";
import { getClientsWithGoals } from "@/lib/data";

export const metadata: Metadata = { title: "Contratos encerrados" };

/**
 * Contas cujo contrato acabou.
 *
 * Não é uma lixeira: nada aqui foi apagado. O status `churned` tira a
 * conta da carteira ativa — para que o painel do dia a dia mostre só
 * quem está sendo operado — e a deposita aqui com o histórico inteiro.
 *
 * Por isso a tela mostra o QUE A CONTA RENDEU, e não um cadastro morto:
 * a pergunta que se faz sobre cliente que saiu é "quanto investimos e o
 * que entregamos enquanto durou", seja para uma tentativa de retomada,
 * seja para entender o padrão de quem cancela.
 */
export default async function ChurnedClientsPage() {
  const rows = await getClientsWithGoals(undefined, undefined, {
    onlyChurned: true,
  });

  const totalInvestido = rows.reduce((a, r) => a + r.computedSpendCents, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Contratos encerrados"
        description={
          rows.length === 0
            ? "Nenhuma conta encerrada."
            : `${rows.length} ${rows.length === 1 ? "conta encerrada" : "contas encerradas"}. O histórico segue completo e a reabertura é imediata.`
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/clientes" />}
          >
            <ArrowLeft className="size-3.5" />
            Voltar à carteira
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-hairline px-6 py-14 text-center">
          <Archive className="mx-auto size-6 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Nenhum contrato encerrado</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Quando um cliente cancelar, use{" "}
            <strong className="text-foreground">Encerrar contrato</strong> nos
            ajustes da conta. Ela sai da carteira e aparece aqui, com tudo
            preservado.
          </p>
        </div>
      ) : (
        <ChurnedList
          rows={rows.map((r) => ({
            id: r.client.id,
            name: r.client.name,
            slug: r.client.slug,
            segment: r.client.segment,
            logoUrl: r.client.logo_url,
            brandPrimary: r.client.brand_primary,
            spendCents: r.computedSpendCents,
            goalValue: r.computedGoalValue,
            metricLabel: r.metric.label,
            metricIsCurrency: r.metric.isCurrency,
          }))}
          totalInvestido={totalInvestido}
        />
      )}
    </PageContainer>
  );
}
