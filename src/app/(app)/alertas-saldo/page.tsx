import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckCircle2,
  HelpCircle,
  /* Renomeado: `Infinity` sombrearia o global de mesmo nome no escopo
     do módulo, e um `Infinity` numérico aqui viraria um componente. */
  Infinity as InfinityIcon,
  TriangleAlert,
} from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DIAS_DE_ALERTA,
  DIAS_DE_ATENCAO,
  getBalanceAlerts,
} from "@/lib/ads/balances";
import { formatCurrency, formatDate } from "@/lib/format";
import { getCurrentUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BalanceAlert, BalanceStatus } from "@/lib/ads/balances";

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
        description={`Saldo disponível e quanto ele dura no ritmo dos últimos dias. Crítico abaixo de ${DIAS_DE_ALERTA} dias, atenção abaixo de ${DIAS_DE_ATENCAO}.`}
      />

      {/* O aviso vem ANTES dos cards porque muda como o número deve ser
          lido — depois deles já é tarde. */}
      <div className="mt-6 rounded-xl border border-hairline bg-surface-2/60 p-4">
        <p className="text-sm font-medium">
          O saldo vem de lugares diferentes em cada plataforma
        </p>

        <p className="mt-1.5 text-xs text-muted-foreground">
          <strong>Meta:</strong> saldo informado na recarga menos o gasto desde
          então. O desconto vem da sincronização diária, então o número se
          mantém sozinho — só a recarga precisa ser anotada, em Contas de
          mídia na página do cliente.
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          A Graph API não expõe a carteira: seu campo <code>balance</code> é o
          acumulado a pagar, que SOBE conforme veicula. Medido no Nuur, ele
          devolvia R$ 23,34 enquanto o painel mostrava R$ 341,77 — usá-lo
          inverteria o alerta.
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Google:</strong> lido direto da API, do orçamento da conta
          (limite ajustado menos o valor já servido). Não precisa ser anotado
          à mão.
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Usamos o limite <em>ajustado</em>, não o aprovado: o aprovado ignora
          créditos e estornos. Medido no Atacado de Pratas, ele devolvia
          −R$ 767,09 numa conta com R$ 750,43 de folga. Conta em faturamento
          sem teto aparece como &ldquo;sem teto&rdquo;, sem projeção.
        </p>
        <p className="mt-1 text-2xs text-warning">
          Ainda não conferimos o número do Google contra o painel do Google
          Ads. Antes de usá-lo para decidir recarga, compare uma conta.
        </p>

        <p className="mt-3 text-2xs text-muted-foreground">
          Só entram aqui as contas marcadas como pré-pagas na página do
          cliente. O ritmo é a média dos dias em que a conta gastou na última
          semana — não dos 7 dias corridos, que subestimaria conta nova.
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


/* =====================================================================
   O cartão
   ---------------------------------------------------------------------
   Os três números — saldo, ritmo e dias — ficam NA MESMA LINHA porque
   nenhum deles significa nada sozinho. "R$ 500" pode ser folga de um
   mês ou de meio dia; é o ritmo ao lado que decide. Separá-los em
   blocos obrigaria quem lê a fazer a divisão de cabeça, que é
   exatamente o trabalho que esta tela existe para poupar.
   ===================================================================== */

const ESTILO: Record<
  BalanceStatus,
  { texto: string; borda: string; Icone: typeof TriangleAlert }
> = {
  critical: {
    texto: "text-negative",
    borda: "border-l-negative",
    Icone: TriangleAlert,
  },
  warning: {
    texto: "text-warning",
    borda: "border-l-warning",
    Icone: TriangleAlert,
  },
  healthy: {
    texto: "text-positive",
    borda: "border-l-positive",
    Icone: CheckCircle2,
  },
  /* Cinza, não amarelo: não saber o saldo não é um alerta sobre a
     conta, é uma pendência de cadastro. Pintar de amarelo misturaria
     as duas coisas na varredura visual. */
  unknown: {
    texto: "text-muted-foreground",
    borda: "border-l-hairline",
    Icone: HelpCircle,
  },
  unlimited: {
    texto: "text-muted-foreground",
    borda: "border-l-hairline",
    Icone: InfinityIcon,
  },
};

function AlertCard({ alert }: { alert: BalanceAlert }) {
  const { texto, borda, Icone } = ESTILO[alert.status];

  return (
    <Card className={cn("border-l-4", borda)}>
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

          <Badge variant={alert.status === "critical" ? "destructive" : "outline"}>
            {rotuloCurto(alert)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <p className={cn("flex items-start gap-1.5 text-sm font-semibold", texto)}>
          <Icone className="mt-px size-4 shrink-0" />
          <span>{diagnostico(alert)}</span>
        </p>

        {/* A linha dos três números. Só aparece quando há projeção: com
            saldo desconhecido, "Ritmo: R$ 100/dia | Restam: —" ocuparia
            espaço para não dizer nada. */}
        {alert.currentBalance !== null && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline pt-3 text-xs tabular-nums">
            {/* Cada par rótulo+valor é um `nowrap` só. Solto, o wrap
                quebrava entre "Ritmo:" e o número, deixando o rótulo no
                fim de uma linha e o valor no começo da outra — que é
                exatamente o tipo de leitura errada que juntar os três
                números pretendia evitar. */}
            <span className="whitespace-nowrap">
              <span className="text-muted-foreground">Saldo atual: </span>
              <strong className={cn("font-semibold", texto)}>
                {formatCurrency(alert.currentBalance)}
              </strong>
            </span>

            <span aria-hidden className="text-hairline">|</span>

            <span className="whitespace-nowrap">
              <span className="text-muted-foreground">Ritmo: </span>
              <strong className="font-medium">
                {formatCurrency(alert.burnRate)}/dia
              </strong>
            </span>

            <span aria-hidden className="text-hairline">|</span>

            <span className="whitespace-nowrap">
              <span className="text-muted-foreground">Restam: </span>
              <strong className={cn("font-semibold", texto)}>
                {alert.daysLeft === null
                  ? "indefinido"
                  : alert.daysLeft === 1
                    ? "1 dia"
                    : `${alert.daysLeft} dias`}
              </strong>
            </span>
          </p>
        )}

        <dl className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3 text-2xs text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <dt>Origem do saldo</dt>
            <dd className="text-right font-medium">{ORIGEM[alert.balanceSource]}</dd>
          </div>

          {/* O divisor do ritmo fica visível: "R$ 100/dia" calculado
              sobre 2 dias merece menos confiança que sobre 7, e quem lê
              precisa poder descontar isso. */}
          {alert.burnRate > 0 && (
            <div className="flex items-center justify-between gap-2">
              <dt>Base do ritmo</dt>
              <dd className="text-right font-medium tabular-nums">
                {alert.diasDeRitmo}{" "}
                {alert.diasDeRitmo === 1 ? "dia com gasto" : "dias com gasto"}
              </dd>
            </div>
          )}

          {/* A forma de pagamento fica ao lado do saldo de propósito: em
              conta paga por cartão, `balance` na Meta é dívida acumulada
              e não crédito restante — quem lê precisa poder julgar. */}
          {alert.fundingLabel && (
            <div className="flex items-center justify-between gap-2">
              <dt>Pagamento</dt>
              <dd className="text-right font-medium">{alert.fundingLabel}</dd>
            </div>
          )}

          {alert.fundsRecordedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt>Saldo informado em</dt>
              <dd className="text-right font-medium tabular-nums">
                {formatDate(`${alert.fundsRecordedAt}T12:00:00`)}
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const ORIGEM: Record<BalanceAlert["balanceSource"], string> = {
  manual: "Informado na recarga",
  google_api: "API do Google Ads",
  indisponivel: "Não disponível",
};

/** O texto do badge: curto o bastante para caber ao lado do nome. */
function rotuloCurto(alert: BalanceAlert): string {
  switch (alert.status) {
    case "unknown":
      return "Sem saldo";
    case "unlimited":
      return "Sem teto";
    default:
      return alert.daysLeft === null ? "Sem ritmo" : `${alert.daysLeft}d`;
  }
}

/** A frase que diz o que fazer, não só o que é. */
function diagnostico(alert: BalanceAlert): string {
  if (alert.status === "unknown") {
    return alert.platform === "meta_ads"
      ? "Informe o saldo em Contas de mídia para acompanhar"
      : "Saldo não localizado na API — confira o faturamento da conta";
  }

  if (alert.status === "unlimited") {
    return "Faturamento sem teto — não há saldo a esgotar";
  }

  if (alert.currentBalance === 0) {
    return "Sem saldo — anúncios podem estar fora do ar";
  }

  if (alert.daysLeft === null) {
    return "Sem gasto recente — não dá para projetar";
  }

  /* "0 dias restantes" com saldo na conta lê como erro. O que o número
     diz é "menos de um dia". */
  if (alert.daysLeft === 0) return "Acaba hoje no ritmo atual";

  return alert.daysLeft === 1
    ? "Resta 1 dia no ritmo atual"
    : `Restam ${alert.daysLeft} dias no ritmo atual`;
}
