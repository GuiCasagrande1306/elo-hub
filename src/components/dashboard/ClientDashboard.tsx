"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { FileDown, Globe, Radio } from "lucide-react";

import { KpiCard } from "./kpi-card";
import { TrendChart } from "./trend-chart";
import { PlatformSplitList } from "./platform-split";
import { AdGallery } from "./ad-gallery";
import { ClientSettingsCard } from "@/components/clients/client-settings-card";
import { IntegrationsCard } from "@/components/clients/integrations-card";
import { Button } from "@/components/ui/button";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { formatPeriod } from "@/lib/format";
import type { KpiResult, PlatformSplit, TrendPoint } from "@/lib/metrics/kpi";
import type { IntegrationStatus } from "@/lib/data";
import type { AdCreative, Client } from "@/types/database";

/* =====================================================================
   ClientDashboard
   ---------------------------------------------------------------------
   Painel principal da conta. Unifica Google Ads e Meta Ads numa única
   leitura de performance.

   Este componente é DE APRESENTAÇÃO: recebe tudo já calculado. Nenhuma
   agregação, nenhum acesso a banco, nenhuma regra de negócio aqui. Quem
   soma métricas é `src/lib/metrics/kpi.ts`; quem lê o banco é
   `src/lib/data.ts` (sempre sob RLS). Essa separação é o que permite ao
   renderizador de PDF reaproveitar exatamente os mesmos números — o
   relatório enviado ao cliente não pode divergir da tela.

   Hierarquia visual, do topo:
     1. Hero — identidade do cliente + os 3 KPIs que definem a conta.
     2. Evolução — a curva, para responder "está melhorando?".
     3. Canais — de onde veio o resultado.
     4. Criativos — o que exatamente está no ar.
   ===================================================================== */

export interface ClientDashboardProps {
  client: Client;
  /** Investimento, Resultados e Custo por Resultado — nesta ordem. */
  kpis: KpiResult[];
  /** Séries de sparkline por chave de métrica. */
  sparklines: Record<string, number[]>;
  trend: TrendPoint[];
  platforms: PlatformSplit[];
  creatives: AdCreative[];
  period: { start: string; end: string; days: number };
  /** Dias disponíveis no seletor. */
  presets?: number[];
  integrations: IntegrationStatus[];
  goal: { plannedBudgetCents: number; plannedResults: number } | null;
}

export function ClientDashboard({
  client,
  kpis,
  sparklines,
  trend,
  platforms,
  creatives,
  period,
  presets = [7, 30, 90],
  integrations,
  goal,
}: ClientDashboardProps) {
  // Qualquer sync de métricas ou anúncio revalida esta página para todos
  // os usuários conectados que têm acesso a esta conta.
  useRealtimeRefresh("daily_metrics", { filter: `client_id=eq.${client.id}` });

  const secondarySeries =
    client.segment === "ecommerce" ? "revenue" : "results";

  return (
    <div className="flex flex-col">
      {/* ================= HERO ================= */}
      <section className="glow-signal relative overflow-hidden border-b border-hairline">
        <div className="grid-hairline pointer-events-none absolute inset-0 opacity-[0.35]" />

        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-8 pt-8 sm:px-6 lg:px-8">
          {/* Identidade + ações ------------------------------------- */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <ClientMark client={client} />

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">
                    {client.name}
                  </h1>
                  <StatusPill status={client.status} />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>{SEGMENT_LABELS[client.segment]}</span>
                  <span aria-hidden className="text-hairline">
                    •
                  </span>
                  <span className="tabular-nums">
                    {formatPeriod(period.start, period.end)}
                  </span>
                  {client.website && (
                    <>
                      <span aria-hidden className="text-hairline">
                        •
                      </span>
                      <a
                        href={client.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        <Globe className="size-3.5" />
                        site
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PeriodSelector
                slug={client.slug}
                presets={presets}
                current={period.days}
              />
              {/* `nativeButton={false}` é obrigatório ao renderizar como
                  <a>: sem ele, o Base UI assume semântica de <button> e
                  aplica ARIA que não corresponde ao elemento real. */}
              <Button
                size="sm"
                className="h-9"
                nativeButton={false}
                render={<Link href={`/relatorios/novo?cliente=${client.slug}`} />}
              >
                <FileDown className="size-4" />
                Gerar relatório
              </Button>
            </div>
          </div>

          {/* ---------------- CARDS DE KPI ----------------
              Grid de 3 no desktop; no mobile viram uma coluna, com o
              Investimento em destaque. Ordem fixa: Investimento →
              Resultados → Custo por Resultado, que é a sequência da
              leitura de mídia paga (quanto entrou, o que gerou, a que
              preço). */}
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {kpis.map((kpi, index) => (
              <KpiCard
                key={kpi.key}
                kpi={kpi}
                index={index}
                trend={sparklines[kpi.key]}
                emphasis={index === 0}
              />
            ))}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Radio className="size-3 text-signal" />
            Google Ads + Meta Ads unificados · comparação com os{" "}
            {period.days} dias anteriores
          </p>
        </div>
      </section>

      {/* ================= CORPO ================= */}
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Evolução no período"
            description="Investimento diário contra o retorno gerado."
          >
            <TrendChart data={trend} secondary={secondarySeries} />
          </Panel>

          <Panel
            title="Canais"
            description="Onde o orçamento foi alocado."
          >
            <PlatformSplitList data={platforms} />
          </Panel>
        </div>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.015em]">
                Anúncios ativos
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Criativos no ar agora, com o desempenho individual de cada um.
              </p>
            </div>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {creatives.length} criativos
            </span>
          </div>

          <AdGallery creatives={creatives} />
        </section>

        {/* Configuração por último: é ajuste, não leitura do período.
            Integrações antes dos ajustes porque sem conta de mídia
            vinculada não há número nenhum para relatar. */}
        <div id="ajustes" className="scroll-mt-20" />
        <IntegrationsCard
          clientId={client.id}
          clientSlug={client.slug}
          integrations={integrations}
        />
        <ClientSettingsCard client={client} goal={goal} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Marca do cliente: logo quando existe, senão um monograma na cor
 * primária da marca. Evita o buraco cinza que todo CRM tem quando o
 * cliente ainda não subiu logo.
 */
function ClientMark({ client }: { client: Client }) {
  const letters = client.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (client.logo_url) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável. */}
        <img
          src={client.logo_url}
          alt={client.name}
          className="size-full object-contain p-1.5"
        />
      </span>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
      style={{
        background: client.brand_primary
          ? `linear-gradient(140deg, ${client.brand_primary}, color-mix(in oklab, ${client.brand_primary} 68%, black))`
          : "var(--surface-2)",
      }}
    >
      {letters}
    </motion.div>
  );
}

const STATUS_STYLES: Record<Client["status"], { label: string; className: string }> =
  {
    active: { label: "Ativo", className: "bg-positive-muted text-positive" },
    onboarding: { label: "Onboarding", className: "bg-warning-muted text-warning" },
    paused: { label: "Pausado", className: "bg-muted text-muted-foreground" },
    lead: { label: "Lead", className: "bg-muted text-muted-foreground" },
    churned: { label: "Encerrado", className: "bg-negative-muted text-negative" },
  };

function StatusPill({ status }: { status: Client["status"] }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-2xs font-medium",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}

const SEGMENT_LABELS: Record<Client["segment"], string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

/**
 * Seletor de período por LINK, não por estado.
 * O período vive na URL: a tela fica compartilhável, o botão voltar
 * funciona, e o Server Component refaz a query já com a nova janela —
 * sem cascata de loading no cliente.
 */
function PeriodSelector({
  slug,
  presets,
  current,
}: {
  slug: string;
  presets: number[];
  current: number;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline"
      role="group"
      aria-label="Período"
    >
      {presets.map((days) => {
        const active = days === current;
        return (
          <Link
            key={days}
            href={`/clientes/${slug}?periodo=${days}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "relative rounded-[7px] px-2.5 py-1.5 text-xs font-medium tabular-nums transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="period-pill"
                className="absolute inset-0 rounded-[7px] bg-background ring-1 ring-hairline"
                transition={{ type: "spring", stiffness: 480, damping: 40 }}
              />
            )}
            <span className="relative">{days}d</span>
          </Link>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card p-5 sm:p-6", className)}>
      <header className="mb-5">
        <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}
