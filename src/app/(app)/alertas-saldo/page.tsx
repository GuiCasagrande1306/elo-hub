import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DIAS_DE_ALERTA, getBalanceAlerts } from "@/lib/ads/balances";
import { formatCurrency } from "@/lib/format";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BalanceAlert } from "@/lib/ads/balances";

export const metadata: Metadata = { title: "Alertas de saldo" };

/**
 * Alertas de saldo de mídia.
 *
 * Aberta a qualquer usuário autenticado — quem gerencia a conta precisa
 * ver antes de o anúncio cair, e isso não é dado financeiro da agência.
 *
 * Sem cache: um alerta de saldo desatualizado é pior que nenhum.
 */
export const dynamic = "force-dynamic";

const PLATAFORMA: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};

export default async function BalanceAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const alerts = await getBalanceAlerts();

  return (
    <PageContainer>
      <PageHeader
        title="⚠️ Alertas de saldo"
        description={`Contas pré-pagas com verba para ${DIAS_DE_ALERTA} dias ou menos, no ritmo de gasto da última semana.`}
      />

      {/* O aviso vem ANTES dos cards, não num rodapé: alguém precisa
          saber que o número é simulado antes de decidir recarregar uma
          conta com base nele. */}
      <div className="mt-6 rounded-xl border border-hairline bg-warning-muted/30 p-4">
        <p className="text-sm font-medium">Os saldos ainda são simulados</p>
        <p className="mt-1 text-xs text-muted-foreground">
          O <strong>gasto médio diário é real</strong> — vem da sincronização
          de mídia. O saldo é um valor de demonstração até plugarmos as APIs
          de faturamento. Não use esta tela para decidir recarga ainda.
        </p>
        <p className="mt-2 text-2xs text-muted-foreground">
          Só entram aqui as contas marcadas como pré-pagas na página do
          cliente. Conta pós-paga não tem crédito a esgotar e fica de fora.
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-hairline py-16 text-center">
          <CheckCircle2 className="mx-auto size-8 text-positive" />
          <p className="mt-3 text-sm font-medium">Nenhuma conta em risco</p>
          <p className="mt-1 text-xs text-muted-foreground">
            As contas pré-pagas têm folga para mais de {DIAS_DE_ALERTA} dias.
          </p>
          <p className="mt-2 text-2xs text-muted-foreground">
            Se você esperava ver alguma conta aqui, confirme que ela está
            marcada como pré-paga na página do cliente.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a) => (
            <AlertCard key={`${a.clientId}-${a.platform}`} alert={a} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function AlertCard({ alert }: { alert: BalanceAlert }) {
  const zerado = alert.severity === "zerado";

  /* Vermelho a partir de zero dia, não só com saldo zerado: no ritmo
     atual a conta cai HOJE, e a diferença entre "acabou" e "acaba em
     algumas horas" não muda a ação de quem lê. */
  const urgente = zerado || alert.daysLeft === 0;

  /* "0 dias restantes" com saldo na conta lê como erro. O que o número
     diz é "menos de um dia". */
  const estimativa =
    alert.daysLeft === 0
      ? "Estimativa: menos de 1 dia"
      : `Estimativa: ${alert.daysLeft} ${alert.daysLeft === 1 ? "dia restante" : "dias restantes"}`;

  return (
    <Card
      className={cn(
        "border-l-4",
        urgente
          ? "border-l-negative"
          : alert.severity === "critico"
            ? "border-l-negative/60"
            : "border-l-warning",
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              <Link
                href={`/clientes/${alert.clientSlug}`}
                className="hover:underline"
              >
                {alert.clientName}
              </Link>
            </CardTitle>
            <CardDescription>{PLATAFORMA[alert.platform]}</CardDescription>
          </div>

          <Badge variant={urgente ? "destructive" : "outline"}>
            {zerado ? "Zerado" : alert.daysLeft === 0 ? "Hoje" : `${alert.daysLeft}d`}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            urgente ? "text-negative" : "text-warning",
          )}
        >
          <TriangleAlert className="size-4 shrink-0" />
          {zerado
            ? "Sem saldo — anúncios podem estar fora do ar"
            : estimativa}
        </p>

        <dl className="mt-4 flex flex-col gap-2 border-t border-hairline pt-3 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Saldo atual</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(alert.balanceCents)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Gasto médio</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(alert.dailySpendCents)}/dia
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
