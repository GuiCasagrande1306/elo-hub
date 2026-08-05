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
        description="Contas pré-pagas, gasto diário real e o valor acumulado a pagar. O saldo disponível ainda precisa ser conferido no painel da Meta."
      />

      {/* O aviso vem ANTES dos cards porque muda como o número deve ser
          lido — depois deles já é tarde. */}
      <div className="mt-6 rounded-xl border border-hairline bg-surface-2/60 p-4">
        <p className="text-sm font-medium">
          A Meta não entrega o saldo disponível
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          O gasto médio é <strong>real</strong>. O valor ao lado é o{" "}
          <strong>acumulado a pagar</strong> — sobe conforme veicula e zera
          quando a Meta cobra. Não é quanto resta de verba.
        </p>
        <p className="mt-2 text-2xs text-muted-foreground">
          Medido na conta do Nuur: a API devolveu R$ 23,34 enquanto o painel
          mostrava R$ 341,77 de fundos. A carteira não existe em nenhum campo
          da Graph API. Por isso <strong>não há projeção de dias</strong> —
          calculá-la a partir do acumulado inverteria o alerta.
        </p>
        <p className="mt-2 text-2xs text-muted-foreground">
          Só entram aqui as contas marcadas como pré-pagas na página do
          cliente. Google Ads ainda não devolve saldo.
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
  const saudavel = alert.severity === "ok";

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
        saudavel
          ? "border-l-positive"
          : urgente
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
            {saudavel
              ? (alert.daysLeft === null ? "Sem ritmo" : `${alert.daysLeft}d`)
              : zerado
                ? "Zerado"
                : alert.daysLeft === 0
                  ? "Hoje"
                  : `${alert.daysLeft}d`}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            saudavel ? "text-positive" : urgente ? "text-negative" : "text-warning",
          )}
        >
          {saudavel ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <TriangleAlert className="size-4 shrink-0" />
          )}
          {saudavel
            ? alert.daysLeft === null
              ? "Sem gasto recente — não dá para projetar"
              : estimativa
            : zerado
              ? "Sem saldo — anúncios podem estar fora do ar"
              : estimativa}
        </p>

        <dl className="mt-4 flex flex-col gap-2 border-t border-hairline pt-3 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Acumulado a pagar</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(alert.balanceCents)}
            </dd>
          </div>
          {/* A fonte fica ao lado do saldo de propósito: em conta paga
              por cartão, `balance` na Meta é dívida acumulada e não
              crédito restante — quem lê precisa poder julgar. */}
          {alert.fundingLabel && (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Pagamento</dt>
              <dd className="font-medium">{alert.fundingLabel}</dd>
            </div>
          )}
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
