/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PrintWeeklyChart } from "./print-chart";
import { getPrintReportData } from "@/lib/reports/print-data";
import { verifyPrintToken } from "@/lib/reports/print-token";
import { PLATFORM_LABELS } from "@/lib/metrics/kpi";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   Página de impressão do relatório — A4
   ---------------------------------------------------------------------
   Fotografada pelo Puppeteer, nunca navegada por um humano.

   NÃO usa os tokens do design system (`bg-background`, `text-foreground`).
   Papel é sempre claro: se a página herdasse o tema, um gestor com o
   sistema no escuro geraria um PDF de fundo navy que gasta meio
   cartucho e fica ilegível impresso. As cores aqui são fixas e
   pensadas para papel — só a cor da MARCA DO CLIENTE é dinâmica.

   `print-color-adjust: exact` é obrigatório: sem ele o Chrome descarta
   fundos e cores de impressão e a capa sai branca.
   ===================================================================== */

export const metadata: Metadata = { robots: { index: false, follow: false } };

const A4 = "w-[210mm] min-h-[297mm]";

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ token?: string; inicio?: string; fim?: string }>;
}) {
  const [{ clientId }, query] = await Promise.all([params, searchParams]);

  // Sem token válido a página nem existe. 404 em vez de 403 de
  // propósito: não confirma que aquele clientId é real.
  const auth = verifyPrintToken(query.token ?? null);
  if (!auth.valid || auth.payload.clientId !== clientId) notFound();

  const { periodStart, periodEnd } = auth.payload;
  const data = await getPrintReportData(clientId, periodStart, periodEnd);
  if (!data) notFound();

  const { client, kpis, platforms, creatives, weekly, totals } = data;
  const brand = client.brand_primary ?? "#16466e";
  const periodo = formatPeriod(periodStart, periodEnd);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { break-after: page; page-break-after: always; }
        .page:last-child { break-after: auto; page-break-after: auto; }
        @media print { .page { break-inside: avoid; } }
        /* O overlay de desenvolvimento do Next é um elemento fixo no
           canto da tela, e o Puppeteer fotografa o documento inteiro —
           ele sai impresso como uma bolha preta na capa. Escondido só
           aqui: nas outras rotas a ferramenta continua disponível. */
        nextjs-portal { display: none; }
      `}</style>

      <main className="bg-white font-sans text-[#111827] antialiased">
        {/* ============================ CAPA ============================ */}
        <section className={`page relative flex flex-col overflow-hidden ${A4}`}>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(155deg, ${brand} 0%, ${shade(brand)} 100%)`,
            }}
          />

          {/* Marca d'água geométrica: dá profundidade sem pesar na
              impressão, ao contrário de uma imagem de fundo. */}
          <div
            aria-hidden
            className="absolute -right-24 -top-24 size-[420px] rounded-full opacity-[0.07]"
            style={{ background: "#fff" }}
          />
          <div
            aria-hidden
            className="absolute -bottom-40 -left-32 size-[520px] rounded-full opacity-[0.05]"
            style={{ background: "#fff" }}
          />

          <div className="relative z-10 flex flex-1 flex-col px-[22mm] py-[26mm] text-white">
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] opacity-70">
              Relatório de Performance
            </p>

            <div className="flex flex-1 flex-col items-center justify-center text-center">
              {client.logo_url ? (
                <img
                  src={client.logo_url}
                  alt={client.name}
                  className="mb-8 max-h-[70px] max-w-[280px] object-contain"
                />
              ) : (
                <span className="mb-8 flex size-[76px] items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold ring-1 ring-inset ring-white/25">
                  {initials(client.name)}
                </span>
              )}

              <h1 className="text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
                {client.name}
              </h1>
              <p className="mt-4 text-[15px] opacity-85">{periodo}</p>

              <div className="mt-8 h-[3px] w-16 rounded-full bg-white/60" />
            </div>

            {/* Assinatura da agência no rodapé da capa. */}
            <footer className="flex items-end justify-between">
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-7 items-center justify-center rounded-md bg-white">
                  <span
                    className="text-[13px] font-bold leading-none"
                    style={{ color: brand }}
                  >
                    E
                  </span>
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-semibold">Elo Marketing</p>
                  <p className="text-[10px] opacity-70">Marketing de performance</p>
                </div>
              </div>

              <p className="text-[10px] opacity-60">
                Gerado em {new Date().toLocaleDateString("pt-BR")}
              </p>
            </footer>
          </div>
        </section>

        {/* ====================== RESUMO EXECUTIVO ====================== */}
        <section className={`page flex flex-col px-[18mm] py-[16mm] ${A4}`}>
          <PageHeader client={client.name} periodo={periodo} brand={brand} />

          <h2 className="mt-8 text-[26px] font-bold tracking-[-0.025em]">
            Resumo executivo
          </h2>
          <p className="mt-1 text-[12px] text-[#64707d]">
            Google Ads e Meta Ads consolidados. A variação compara com o período
            anterior de mesma duração.
          </p>

          {/* KPIs grandes */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            {kpis.map((kpi) => (
              <div
                key={kpi.key}
                className="rounded-xl border border-[#e6e8ec] bg-[#fafbfc] p-4"
                style={{ borderTopColor: brand, borderTopWidth: 3 }}
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#64707d]">
                  {kpi.label}
                </p>
                <p className="mt-2 text-[26px] font-bold leading-none tracking-[-0.03em]">
                  {kpi.formatted}
                </p>

                {kpi.deltaPercent === null ? (
                  <p className="mt-2.5 text-[10px] text-[#8b95a1]">
                    sem base de comparação
                  </p>
                ) : (
                  <p
                    className="mt-2.5 text-[11px] font-semibold"
                    style={{ color: sentimentColor(kpi.sentiment) }}
                  >
                    {kpi.deltaPercent > 0 ? "+" : ""}
                    {kpi.deltaPercent.toFixed(1).replace(".", ",")}%
                    <span className="ml-1.5 font-normal text-[#8b95a1]">
                      vs. {kpi.previousFormatted}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Evolução semanal */}
          <div className="mt-7 rounded-xl border border-[#e6e8ec] p-5">
            <h3 className="text-[13px] font-semibold">Evolução semanal</h3>
            <p className="mt-0.5 text-[11px] text-[#64707d]">
              Investimento por semana do período.
            </p>
            <div className="mt-3 flex justify-center">
              <PrintWeeklyChart data={weekly} color={brand} />
            </div>
          </div>

          {/* Canais */}
          <div className="mt-5 rounded-xl border border-[#e6e8ec] p-5">
            <h3 className="text-[13px] font-semibold">Distribuição por canal</h3>

            <div className="mt-4 flex flex-col gap-3.5">
              {platforms.map((p) => (
                <div key={p.platform}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-semibold">
                      {PLATFORM_LABELS[p.platform]}
                    </span>
                    <span className="text-[12px] tabular-nums">
                      {formatCurrency(p.totals.spendCents)}
                      <span className="ml-2 text-[10px] text-[#64707d]">
                        {formatPercent(p.spendShare, 0)}
                      </span>
                    </span>
                  </div>

                  <div className="mt-1.5 h-[6px] w-full overflow-hidden rounded-full bg-[#eef0f3]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(p.spendShare * 100, 1.5)}%`,
                        background: brand,
                      }}
                    />
                  </div>

                  <p className="mt-1.5 text-[10px] text-[#64707d] tabular-nums">
                    {formatNumber(Math.round(p.totals.conversions))} resultados ·{" "}
                    {formatCurrency(p.cpa)} por resultado
                  </p>
                </div>
              ))}
            </div>
          </div>

          <PageFooter numero={2} />
        </section>

        {/* ===================== CRIATIVOS ATIVOS ====================== */}
        <section className={`page flex flex-col px-[18mm] py-[16mm] ${A4}`}>
          <PageHeader client={client.name} periodo={periodo} brand={brand} />

          <h2 className="mt-8 text-[26px] font-bold tracking-[-0.025em]">
            Anúncios que rodaram
          </h2>
          <p className="mt-1 text-[12px] text-[#64707d]">
            Criativos ativos no período, com o desempenho individual de cada um.
          </p>

          {creatives.length === 0 ? (
            <p className="mt-10 rounded-xl border border-dashed border-[#d8dce2] py-14 text-center text-[12px] text-[#8b95a1]">
              Nenhum criativo sincronizado neste período.
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-3 gap-3">
              {creatives.slice(0, 6).map((ad) => {
                const cpa =
                  ad.conversions > 0 ? ad.spend_cents / ad.conversions : 0;
                const ctr = ad.impressions > 0 ? ad.clicks / ad.impressions : 0;

                return (
                  <article
                    key={ad.id}
                    className="overflow-hidden rounded-xl border border-[#e6e8ec]"
                  >
                    <div className="relative aspect-[4/3] bg-[#eef0f3]">
                      {ad.thumbnail_url ? (
                        <img
                          src={ad.thumbnail_url}
                          alt={ad.ad_name ?? "Criativo"}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div
                          className="flex size-full items-center justify-center text-[10px] font-medium text-white"
                          style={{ background: brand }}
                        >
                          {PLATFORM_LABELS[ad.platform]}
                        </div>
                      )}

                      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
                        {PLATFORM_LABELS[ad.platform]}
                      </span>
                    </div>

                    <div className="p-3">
                      <p className="truncate text-[9px] uppercase tracking-[0.1em] text-[#8b95a1]">
                        {ad.campaign_name}
                      </p>
                      <h4 className="mt-1 text-[11px] font-semibold leading-snug">
                        {ad.headline ?? ad.ad_name}
                      </h4>
                      {ad.primary_text && (
                        <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-[#64707d]">
                          {ad.primary_text}
                        </p>
                      )}

                      <dl className="mt-2.5 grid grid-cols-3 gap-1 border-t border-[#eef0f3] pt-2">
                        <Metric label="Investido" value={formatCurrency(ad.spend_cents)} />
                        <Metric label="CTR" value={formatPercent(ctr, 2)} />
                        <Metric
                          label="CPA"
                          value={cpa > 0 ? formatCurrency(cpa) : "—"}
                          color={brand}
                        />
                      </dl>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-6">
            <div
              className="rounded-xl p-5 text-white"
              style={{ background: brand }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">
                Consolidado do período
              </p>
              <div className="mt-2.5 flex items-baseline gap-6">
                <span className="text-[22px] font-bold tracking-[-0.02em]">
                  {formatCurrency(totals.spendCents)}
                </span>
                <span className="text-[13px] opacity-85">
                  {formatNumber(Math.round(totals.results))} resultados
                </span>
              </div>
            </div>
          </div>

          <PageFooter numero={3} />
        </section>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */

function PageHeader({
  client,
  periodo,
  brand,
}: {
  client: string;
  periodo: string;
  brand: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[#e6e8ec] pb-3">
      <div className="flex items-center gap-2">
        <span
          className="size-4 rounded"
          style={{ background: brand }}
          aria-hidden
        />
        <span className="text-[11px] font-semibold">{client}</span>
      </div>
      <span className="text-[10px] text-[#64707d]">{periodo}</span>
    </header>
  );
}

function PageFooter({ numero }: { numero: number }) {
  return (
    <>
      {/* Empurra o rodapé para a base da folha. Sem isto ele fica logo
          abaixo do conteúdo, e uma página curta sai com a numeração
          boiando no meio do papel — parece relatório truncado.

          `flex-1` come a sobra; `min-h-6` garante respiro mesmo quando
          não sobra nada, que é o caso da página cheia de criativos. */}
      <div className="min-h-6 flex-1" />
      <footer className="flex items-center justify-between border-t border-[#e6e8ec] pt-3 text-[9px] text-[#8b95a1]">
        <span>Elo Marketing · Relatório de performance</span>
        <span className="tabular-nums">{numero}</span>
      </footer>
    </>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[7.5px] font-medium uppercase tracking-[0.08em] text-[#8b95a1]">
        {label}
      </dt>
      <dd
        className="mt-0.5 truncate text-[10px] font-semibold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Escurece o hex da marca para o gradiente da capa. */
function shade(hex: string, amount = 0.45): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#0d1826";

  const mix = (c: number) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);

  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function sentimentColor(sentiment: string): string {
  if (sentiment === "positive") return "#1f7a4d";
  if (sentiment === "negative") return "#b03a2e";
  return "#64707d";
}
