import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  CheckCircle2,
  HelpCircle,
  /* Renomeado: `Infinity` sombrearia o global de mesmo nome no escopo
     do módulo, e um `Infinity` numérico aqui viraria um componente. */
  Infinity as InfinityIcon,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  DestinoDoAviso,
  type GrupoDisponivel,
} from "@/components/clients/destino-do-aviso";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { RegistrarSaldo } from "@/components/clients/registrar-saldo";
import { FormaDeRecarga } from "@/components/clients/forma-de-recarga";
import { AvisarCliente } from "@/components/clients/avisar-cliente";
import {
  DIAS_PARA_AVISAR,
  linkDaCobranca,
} from "@/lib/ads/recharge-notice";
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

/**
 * A página fala com DUAS APIs externas — Graph API e Google Ads. Desde
 * que os cartões vivem num `Suspense`, ninguém fica olhando tela branca
 * por causa delas; a função, porém, continua de pé até a última
 * responder, e o padrão da Vercel é curto demais para isso.
 *
 * 60s é o teto do plano Hobby. Não é um orçamento a gastar: cada
 * requisição tem timeout próprio de 8s, e o lote da Meta que estourar
 * ainda é refeito conta a conta — 16s no pior caso, mais a repetição do
 * Google. O valor aqui existe para o teto da plataforma não cortar
 * antes disso.
 */
export const maxDuration = 60;

const PLATAFORMA: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};

export default async function BalanceAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  /* NADA DE `await` DEPOIS DAQUI, e é esse o conserto.
     -------------------------------------------------------------------
     A tela levava 3,2s para aparecer, e as duas esperas eram em série:
     `getBalanceAlerts()` primeiro, `carregarDestinoDoAviso()` depois.
     Medido em 26/08/2026, o tempo estava quase todo num lugar só — 49
     leituras de saldo na Graph API, ~2,9s. Foi encurtado pela metade
     (ver `POR_LOTE` em `meta-balance.ts`), mas a cauda da Meta continua
     existindo e não é nossa para consertar: 6s numa rodada em cada seis.

     Então a página deixa de esperar. Cabeçalho e a explicação de como o
     saldo é lido não dependem de dado nenhum e vão embora na hora; o
     seletor de destino e os cartões chegam cada um no seu tempo, dentro
     do próprio `Suspense`. Como são IRMÃOS, as duas buscas partem
     juntas — a segunda não espera mais a primeira terminar. */
  return (
    <PageContainer>
      <PageHeader
        title="⚠️ Alertas de saldo"
        description={`Saldo disponível e quanto ele dura no ritmo dos últimos dias. Crítico abaixo de ${DIAS_DE_ALERTA} dias, atenção abaixo de ${DIAS_DE_ATENCAO}.`}
      />

      {/* O DESTINO VEM ANTES DE TUDO. Quem abre esta página quer saber
          se precisa abri-la de novo amanhã — e a resposta é "não, se o
          aviso estiver ligado". */}
      <Suspense fallback={<DestinoCarregando />}>
        <Destino podeEditar={user.role === "admin"} />
      </Suspense>

      {/* O aviso vem ANTES dos cards porque muda como o número deve ser
          lido — depois deles já é tarde. E não depende de consulta
          nenhuma: é ele que dá o que ler enquanto os saldos chegam. */}
      <ComoOSaldoEhLido />

      <Suspense fallback={<ContasCarregando />}>
        <Contas />
      </Suspense>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Os dois blocos que esperam                                          */
/* ------------------------------------------------------------------ */

async function Destino({ podeEditar }: { podeEditar: boolean }) {
  const aviso = await medir("destino", carregarDestinoDoAviso);

  return (
    <DestinoDoAviso
      grupos={aviso.grupos}
      jidAtual={aviso.jid}
      nomeAtual={aviso.nome}
      podeEditar={podeEditar}
    />
  );
}

async function Contas() {
  const alerts = await medir("getBalanceAlerts", getBalanceAlerts);

  if (alerts.length === 0) {
    return (
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
    );
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {agruparPorCliente(alerts).map((conta) => (
        <AlertCard key={conta.clientId} conta={conta} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O que aparece enquanto eles não chegam                              */
/* ------------------------------------------------------------------ */

/**
 * O esqueleto do seletor, com a mesma casca do componente real.
 *
 * Mesma borda, mesmo `p-4`, mesmo `mt-6`: sem isso a explicação logo
 * abaixo salta de lugar quando o dado chega, e a página inteira pisca
 * no momento em que a pessoa começou a ler.
 */
function DestinoCarregando() {
  return (
    <div
      aria-busy="true"
      className="mt-6 flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2/60 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <Skeleton className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-52" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-lg sm:w-56" />
      <span className="sr-only">Carregando o destino do aviso…</span>
    </div>
  );
}

/**
 * O esqueleto dos cartões.
 *
 * DIZ O QUE ESTÁ ACONTECENDO, e não é enfeite: a espera é de segundos e
 * vem de fora — o saldo de cada conta é lido ao vivo na Meta e no
 * Google a cada carregamento, e nem a metade de lote consertou a cauda
 * deles. Um bloco cinza mudo faz a pessoa clicar de novo; a frase
 * explica por que vale esperar e que o número não é de ontem.
 *
 * Seis cartões porque é o que preenche a grade de três colunas em duas
 * fileiras — o bastante para a página não encolher quando o dado chega.
 */
function ContasCarregando() {
  return (
    <div className="mt-6" aria-busy="true">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        Lendo o saldo de cada conta direto na Meta e no Google…
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * De onde vem o número de cada plataforma.
 *
 * Estático de propósito: é o único conteúdo da tela que não espera
 * consulta nenhuma, e é ele que ocupa a página enquanto os saldos não
 * chegam.
 */
function ComoOSaldoEhLido() {
  return (
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
        <strong>Google:</strong> igual à Meta — saldo informado na recarga
        menos o gasto desde então, anotado em Contas de mídia.
      </p>
      <p className="mt-1 text-2xs text-muted-foreground">
        A API do Google <strong>não expõe o saldo</strong> de conta
        pré-paga: o dado não existe nela, e o próprio Google recomenda
        desde 2015 registrar a recarga e descontar o gasto. O que a API
        devolve é a <em>verba de faturamento mensal</em>, que só existe em
        conta faturada e mede outra coisa — quanto ainda cabe no teto
        contratado. Onde não há recarga anotada e a conta é faturada, esse
        número aparece rotulado como &ldquo;verba de fatura&rdquo;, nunca
        como saldo.
      </p>

      <p className="mt-3 text-2xs text-muted-foreground">
        Só entram aqui as contas marcadas como pré-pagas na página do
        cliente. O ritmo olha os <strong>7 dias completos até ontem</strong>{" "}
        — o dia de hoje ainda está sendo veiculado e entraria pela metade,
        fazendo o saldo parecer durar mais. Dentro dessa janela, a média é
        dos dias em que a conta <em>gastou</em>, não dos 7 corridos: conta
        nova, ligada há dois dias, queima no ritmo desses dois.
      </p>
    </div>
  );
}



/* =====================================================================
   Uma conta, um cartão
   ---------------------------------------------------------------------
   Meta e Google da MESMA conta ficam juntos. Em cartões separados, a
   carteira aparecia duas vezes na lista e a mesma marca surgia em dois
   lugares com estados diferentes — "Blue Wave crítico" perto de
   "Blue Wave sem saldo" —, e quem varria a tela precisava lembrar que
   eram a mesma empresa.

   O CARTÃO HERDA O PIOR ESTADO das plataformas. Uma conta com Google
   zerado e Meta folgado é uma conta com problema: mostrar o cartão em
   verde porque metade está bem esconderia exatamente o que a tela
   existe para achar.
   ===================================================================== */

export interface ContaAgrupada {
  clientId: string;
  clientName: string;
  clientSlug: string;
  /** Ordenadas: a mais urgente primeiro. */
  plataformas: BalanceAlert[];
  pior: BalanceStatus;
}

/** Urgência de cada estado. Menor = mais urgente. */
const PESO_STATUS: Record<BalanceStatus, number> = {
  critical: 0,
  warning: 1,
  stale: 2,
  unknown: 3,
  healthy: 4,
  unlimited: 5,
};

function agruparPorCliente(alerts: BalanceAlert[]): ContaAgrupada[] {
  const porCliente = new Map<string, ContaAgrupada>();

  for (const a of alerts) {
    const atual = porCliente.get(a.clientId);

    if (!atual) {
      porCliente.set(a.clientId, {
        clientId: a.clientId,
        clientName: a.clientName,
        clientSlug: a.clientSlug,
        plataformas: [a],
        pior: a.status,
      });
      continue;
    }

    atual.plataformas.push(a);
    if (PESO_STATUS[a.status] < PESO_STATUS[atual.pior]) atual.pior = a.status;
  }

  /* `alerts` já chega ordenado por urgência, então a ordem das
     plataformas dentro do cartão sai de graça. Falta ordenar os cartões
     entre si — e o critério é o pior estado, com desempate pelos dias da
     plataforma mais apertada. */
  const menorDias = (c: ContaAgrupada) =>
    Math.min(
      ...c.plataformas.map((p) => p.daysLeft ?? Number.MAX_SAFE_INTEGER),
    );

  return [...porCliente.values()].sort(
    (a, b) =>
      PESO_STATUS[a.pior] - PESO_STATUS[b.pior] || menorDias(a) - menorDias(b),
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
  /* Âmbar como o de atenção, e não vermelho: a conta está no ar. O que
     está errado é o NÚMERO na tela, e o pedido é de releitura, não de
     recarga. Vermelho aqui reproduziria o alarme falso que este estado
     existe para acabar. */
  stale: {
    texto: "text-warning",
    borda: "border-l-warning",
    Icone: RefreshCw,
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

function AlertCard({ conta }: { conta: ContaAgrupada }) {
  const { borda } = ESTILO[conta.pior];

  return (
    <Card className={cn("border-l-4", borda)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              <Link
                href={`/clientes/${conta.clientSlug}`}
                className="hover:underline"
              >
                {conta.clientName}
              </Link>
            </CardTitle>
            <CardDescription>
              {conta.plataformas.map((p) => PLATAFORMA[p.platform]).join(" · ")}
            </CardDescription>
          </div>

          <Badge variant={conta.pior === "critical" ? "destructive" : "outline"}>
            {rotuloCurto(pioresPrimeiro(conta)[0])}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {conta.plataformas.map((alert, i) => (
          <BlocoPlataforma
            key={alert.platform}
            alert={alert}
            /* Separador só entre blocos. O primeiro encosta no cabeçalho,
               que já é a divisória dele. */
            comSeparador={i > 0}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/** A plataforma mais urgente primeiro — é dela que sai o selo do topo. */
function pioresPrimeiro(conta: ContaAgrupada): BalanceAlert[] {
  return [...conta.plataformas].sort(
    (a, b) => PESO_STATUS[a.status] - PESO_STATUS[b.status],
  );
}

/**
 * Um bloco por plataforma dentro do cartão da conta.
 *
 * Repete o nome da plataforma em cima dos números porque, com dois
 * blocos, "R$ 146,48" sem etiqueta não diz de qual conta de anúncio é —
 * e recarregar a errada é o erro que esta tela deveria impedir.
 */
function BlocoPlataforma({
  alert,
  comSeparador,
}: {
  alert: BalanceAlert;
  comSeparador: boolean;
}) {
  const { texto, Icone } = ESTILO[alert.status];

  return (
    <section
      className={cn(comSeparador && "border-t border-hairline pt-4")}
    >
      <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {PLATAFORMA[alert.platform]}
      </p>

      <p className={cn("mt-1.5 flex items-start gap-1.5 text-sm font-semibold", texto)}>
        <Icone className="mt-px size-4 shrink-0" />
        <span>{diagnostico(alert)}</span>
      </p>

      {/* A linha dos três números. Só aparece quando há projeção: com
          saldo desconhecido, "Ritmo: R$ 100/dia | Restam: —" ocuparia
          espaço para não dizer nada. */}
      {alert.currentBalance !== null && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
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

      <dl className="mt-2.5 flex flex-col gap-1.5 text-2xs text-muted-foreground">
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
              {/* A IDADE, e não só a data. "05 de ago" não diz nada
                  sozinho; "há 14 dias" diz que o número embaixo é uma
                  estimativa de duas semanas atrás. Âmbar a partir de uma
                  semana, que é quando a deriva começa a pesar mais que a
                  leitura. */}
              {alert.diasDesdeLeitura !== null &&
                alert.diasDesdeLeitura > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 font-normal",
                      alert.diasDesdeLeitura >= 7
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  >
                    há {alert.diasDesdeLeitura}{" "}
                    {alert.diasDesdeLeitura === 1 ? "dia" : "dias"}
                  </span>
                )}
            </dd>
          </div>
        )}
      </dl>

      {/* O CAMPO FICA NA LINHA, ao lado do número que ele corrige.
          Antes só existia no diálogo de configuração de cada cliente, e
          o resultado medido foi 23 de 24 contas sem saldo informado: o
          trabalho não cabia no fluxo de quem lê alertas.

          Só para conta pré-paga com âncora manual. Verba de fatura vem
          da API do Google e não se digita; conta sem teto não tem o que
          informar. */}
      {alert.status !== "unlimited" && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <span className="max-w-[52%] text-2xs text-muted-foreground">
            {alert.formaDeRecarga === null
              ? "Como esta conta é recarregada?"
              : alert.formaDeRecarga === "pix"
                ? "Recarga manual — alguém precisa fazer o Pix."
                : "Recarrega sozinha no cartão."}
          </span>
          <FormaDeRecarga
            clientId={alert.clientId}
            platform={alert.platform}
            atual={alert.formaDeRecarga}
          />
        </div>
      )}

      {/* A PARTIR DE CINCO DIAS, e só na Meta — o link da cobrança é do
          gerenciador dela. Fora dessa janela nada aparece: um botão
          sempre visível de "cobrar o cliente" convida a usá-lo fora de
          hora.

          O QUE APARECE DEPENDE DA FORMA DE RECARGA, porque a ação é
          outra. Pix: o cliente precisa pagar, então vai mensagem para o
          grupo dele. Cartão: a conta se recarrega sozinha, e pedir
          dinheiro seria cobrar duas vezes pela mesma verba — o que falta
          é alguém da casa conferir se a cobrança passou. */}
      {alert.platform === "meta_ads" &&
        alert.daysLeft !== null &&
        alert.daysLeft <= DIAS_PARA_AVISAR && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
            {alert.formaDeRecarga === "pix" ? (
              <>
                <span className="max-w-[50%] text-2xs text-muted-foreground">
                  {alert.destinoDoCliente
                    ? "O cliente precisa recarregar — mande o link."
                    : "Sem grupo cadastrado para este cliente."}
                </span>
                <AvisarCliente
                  clientId={alert.clientId}
                  clientName={alert.clientName}
                  platform={alert.platform}
                  temGrupo={Boolean(alert.destinoDoCliente)}
                  avisadoEm={alert.avisoEnviadoEm}
                />
              </>
            ) : alert.formaDeRecarga === "cartao" ? (
              <>
                <span className="max-w-[52%] text-2xs text-muted-foreground">
                  Recarrega no cartão — não avisamos o cliente. Confira se
                  a cobrança está passando.
                </span>
                {alert.externalAccountId && (
                  <a
                    href={linkDaCobranca(alert.externalAccountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg border border-hairline px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Abrir cobrança na Meta
                  </a>
                )}
              </>
            ) : (
              <span className="text-2xs text-warning">
                Marque acima se é Pix ou Cartão — é isso que decide se o
                cliente é avisado ou se alguém confere a cobrança.
              </span>
            )}
          </div>
        )}

      {(alert.balanceSource === "manual" ||
        alert.balanceSource === "indisponivel") &&
        alert.status !== "unlimited" && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
            <span className="text-2xs text-muted-foreground">
              {alert.currentBalance === null
                ? "Abra o gerenciador e informe o saldo:"
                : "Releu o saldo? Atualize:"}
            </span>
            <RegistrarSaldo
              clientId={alert.clientId}
              platform={alert.platform}
              valorAtual={null}
              compacto
            />
          </div>
        )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

const ORIGEM: Record<BalanceAlert["balanceSource"], string> = {
  saldo_meta: "Saldo da conta, lido da Meta",
  manual: "Informado na recarga",
  /* "Verba de fatura" e não "API do Google Ads": o rótulo antigo dizia
     de ONDE o número vinha e deixava o leitor supor O QUE ele era. A API
     não expõe saldo de conta pré-paga; `account_budget` é o teto
     contratado de faturamento mensal. */
  verba_fatura: "Verba de fatura (não é saldo)",
  moeda_nao_suportada: "Conta em moeda estrangeira",
  indisponivel: "Não disponível",
};

/** O texto do badge: curto o bastante para caber ao lado do nome. */
function rotuloCurto(alert: BalanceAlert): string {
  switch (alert.status) {
    case "unknown":
      return "Sem saldo";
    case "unlimited":
      return "Sem teto";
    case "stale":
      return "Releia";
    default:
      return alert.daysLeft === null ? "Sem ritmo" : `${alert.daysLeft}d`;
  }
}

/** A frase que diz o que fazer, não só o que é. */
function diagnostico(alert: BalanceAlert): string {
  if (alert.status === "unknown") {
    /* Para a Meta isto virou EXCEÇÃO: o saldo vem da própria conta. Se
       chegou aqui, a leitura falhou — rede, token ou moeda fora de BRL
       —, e o pedido é diferente de "cadastre o número". */
    return alert.platform === "meta_ads"
      ? "Não deu para ler o saldo na Meta agora — informe abaixo para não ficar sem alerta"
      : "Saldo não localizado na API — informe o saldo abaixo";
  }

  if (alert.status === "unlimited") {
    /* Duas causas, uma frase para cada: verba de fatura sem teto no
       Google, e cartão de crédito na Meta. Dizer "sem teto" para um
       cartão soaria a erro de leitura. */
    return alert.platform === "meta_ads"
      ? `Pago por cartão${alert.fundingLabel ? ` (${alert.fundingLabel})` : ""} — não há saldo a esgotar`
      : "Faturamento sem teto — não há saldo a esgotar";
  }

  /* A FRASE PRECISA EXPLICAR A CONTRADIÇÃO, não só pedir a releitura.
     Quem abre a tela vê "saldo R$ 0,00" e uma conta que gastou ontem —
     sem a explicação, a conclusão natural é que a tela está quebrada. */
  if (alert.status === "stale") {
    const quando =
      alert.diasDesdeLeitura === null
        ? "a leitura"
        : alert.diasDesdeLeitura === 1
          ? "a leitura de ontem"
          : `a leitura de ${alert.diasDesdeLeitura} dias atrás`;

    return `A conta segue veiculando, então ${quando} já não vale — informe o saldo atual`;
  }

  if (alert.currentBalance === 0) {
    if (alert.formaDeRecarga === "cartao") {
      /* Saldo zerado numa conta de cartão é a assinatura da recarga
         automática falhando: ela deveria ter reposto antes de chegar
         aqui. Foi o que a tela da Meta mostrou na Looka Modas —
         "Falha no pagamento da recarga automática". */
      return "Sem saldo e a recarga automática não repôs — confira a forma de pagamento na Meta";
    }
    return alert.formaDeRecarga === "pix"
      ? "Sem saldo — recarregue por Pix, os anúncios podem estar fora do ar"
      : "Sem saldo — anúncios podem estar fora do ar";
  }

  if (alert.daysLeft === null) {
    return "Sem gasto recente — não dá para projetar";
  }

  /* "0 dias restantes" com saldo na conta lê como erro. O que o número
     diz é "menos de um dia". */
  const prazo =
    alert.daysLeft === 0
      ? "Acaba hoje no ritmo atual"
      : alert.daysLeft === 1
        ? "Resta 1 dia no ritmo atual"
        : `Restam ${alert.daysLeft} dias no ritmo atual`;

  /* A FORMA DE RECARGA MUDA O QUE FAZER, e é por isso que ela existe.
     Em Pix ninguém recarrega sozinho; em cartão, a conta se vira — e o
     que interessa saber é se a cobrança falhou. */
  if (alert.status === "critical" || alert.status === "warning") {
    if (alert.formaDeRecarga === "pix") return `${prazo} — recarregue por Pix`;
    if (alert.formaDeRecarga === "cartao") {
      return `${prazo} — se a recarga automática falhar, os anúncios param`;
    }
  }

  return prazo;
}


/**
 * Configuração do aviso e os grupos entre os quais escolher.
 *
 * `whatsapp_groups` tem 512 linhas de várias sincronizações; a lista é
 * ordenada por nome e cortada — um seletor de 512 itens não é um
 * seletor, é uma busca. Quem não achar o grupo aqui sincroniza de novo
 * no EloZap, que é onde essa lista nasce.
 */
async function carregarDestinoDoAviso(): Promise<{
  grupos: GrupoDisponivel[];
  jid: string | null;
  nome: string | null;
}> {
  if (isDemoMode) {
    return {
      grupos: [{ jid: "120363000000000000@g.us", name: "Equipe — Mídia" }],
      jid: null,
      nome: null,
    };
  }

  try {
    const admin = createSupabaseAdminClient();

    const [{ data: config }, { data: grupos }] = await Promise.all([
      admin
        .from("balance_alert_settings")
        .select("group_jid, group_name")
        .eq("id", true)
        .maybeSingle(),
      admin
        .from("whatsapp_groups")
        .select("jid, name")
        .order("name")
        .limit(300),
    ]);

    return {
      grupos: (grupos ?? []) as GrupoDisponivel[],
      jid: config?.group_jid ?? null,
      nome: config?.group_name ?? null,
    };
  } catch {
    /* Migration 50 ainda não rodada: a página inteira não pode cair por
       causa do seletor. Sem grupos, ele aparece dizendo que ninguém está
       sendo avisado — que é a verdade. */
    return { grupos: [], jid: null, nome: null };
  }
}


/** Executa e registra quanto demorou. Vai para o log, não para a tela. */
async function medir<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  const inicio = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[alertas-saldo] ${nome}: ${Date.now() - inicio}ms`);
  }
}
