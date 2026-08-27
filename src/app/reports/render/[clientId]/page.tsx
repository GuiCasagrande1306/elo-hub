/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PrintWeeklyChart } from "./print-chart";
import { PrintToolbar } from "./print-toolbar";
import { getPrintReportData } from "@/lib/reports/print-data";
import { resolverAgencia } from "@/lib/reports/payload";
import { verifyPrintToken } from "@/lib/reports/print-token";
import { PLATFORM_LABELS } from "@/lib/metrics/kpi";
import { resolvePeriod } from "@/lib/date-br";
import {
  formatCurrency,
  formatDelta,
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

/**
 * `title.absolute` NÃO é detalhe de SEO — é vazamento de marca.
 *
 * Sem título próprio, esta rota herda o `default` do layout raiz, que é
 * "Elo Hub". Com `PDF_ENGINE=puppeteer`, o Chrome grava `document.title`
 * no campo /Title do PDF: o arquivo que chega ao cliente de uma agência
 * parceira sai chamado "Elo Hub" nas Propriedades. E não há a string
 * "Elo" em arquivo nenhum do relatório para denunciar isso.
 *
 * `absolute` é obrigatório: sem ele o template "%s · Elo Hub" do layout
 * recola a marca no fim.
 */
export const metadata: Metadata = {
  title: { absolute: "Relatório de performance" },
  robots: { index: false, follow: false },
};

const A4 = "w-[210mm] min-h-[297mm]";

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ token?: string; inicio?: string; fim?: string }>;
}) {
  const [{ clientId }, query] = await Promise.all([params, searchParams]);

  /* DOIS CAMINHOS DE ACESSO, e eles não são intercambiáveis.
     ---------------------------------------------------------------
     1. TOKEN — o Puppeteer. Chega sem cookie nenhum, então carrega um
        HMAC de vida curta com cliente e período assinados dentro.

     2. SESSÃO — uma pessoa da equipe abrindo para revisar e salvar em
        PDF pelo próprio navegador. Este caminho é novo e exigiu uma
        checagem explícita: `getPrintReportData` usa o cliente ADMIN e
        passa por cima do RLS — o que é correto para o Puppeteer e
        perigoso para um humano. Sem a verificação abaixo, qualquer
        colaborador logado abriria o relatório de qualquer conta
        sabendo o UUID.

     404 nos dois casos, nunca 403: um 403 confirmaria que aquele
     clientId existe. */
  const auth = verifyPrintToken(query.token ?? null);
  const porToken = auth.valid && auth.payload.clientId === clientId;

  if (!porToken && !(await equipePodeVer(clientId))) notFound();

  /* Com token, o período vem assinado — não dá para trocar por query e
     ver um intervalo que o gerador não autorizou. Sem token, quem manda
     é a URL, e o RLS já limitou a conta. */
  const { periodStart, periodEnd } = porToken
    ? auth.payload
    : periodoDaQuery(query.inicio, query.fim);
  const data = await getPrintReportData(clientId, periodStart, periodEnd);
  if (!data) notFound();

  const {
    client,
    kpis,
    platforms,
    platformDetail,
    creatives,
    weekly,
    totals,
    creativesDoPeriodo,
  } = data;
  const agency = await resolverAgencia(client.agency_partner);

  /* Fallback NEUTRO, não o navy da Elo que estava aqui: sem cor do
     cliente, o documento não deve herdar a marca de uma agência. */
  const brand = client.brand_primary ?? agency?.brandPrimary ?? "#4A5568";

  const assinatura = agency
    ? `${agency.name} · Relatório de performance`
    : "Relatório de performance";
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

      {/* Só para quem abriu a página no navegador. O Puppeteer chega com
          token e nunca chama `window.print()` — e mesmo que a barra
          existisse no HTML dele, `print:hidden` a tira do PDF. */}
      {!porToken && <PrintToolbar />}

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

            {/* Assinatura de quem ATENDE esta conta, não de quem
                escreveu o sistema. O monograma era um "E" desenhado no
                código — a marca da Elo no relatório de toda agência
                parceira. Agora sai do logo enviado, ou da inicial do
                nome quando ainda não há arquivo. */}
            <footer className="flex items-end justify-between">
              {agency && (
                <div className="flex items-center gap-2.5">
                  {agency.logoUrl ? (
                    <img
                      src={agency.logoUrl}
                      alt={agency.name}
                      className="h-7 max-w-[120px] object-contain"
                    />
                  ) : (
                    <span className="relative flex size-7 items-center justify-center rounded-md bg-white">
                      <span
                        className="text-[13px] font-bold leading-none"
                        style={{ color: agency.brandPrimary ?? brand }}
                      >
                        {agency.name.trim().charAt(0).toUpperCase()}
                      </span>
                    </span>
                  )}
                  <div className="leading-tight">
                    <p className="text-[13px] font-semibold">{agency.name}</p>
                  </div>
                </div>
              )}

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
                {/* De onde o número saiu. Custo por resultado e ROAS são
                    contados só nas campanhas de origem, então eles não
                    fecham com o investimento do card ao lado — sem esta
                    linha, quem divide na calculadora acha outro número e
                    conclui que o relatório está errado. */}
                {kpi.origem !== null && (
                  <p className="mt-1 text-[8px] text-[#8b95a1]">
                    de {kpi.origem} {kpi.origem === 1 ? "campanha" : "campanhas"}
                  </p>
                )}

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
                    {/* "—" e não "R$ 0,00" quando não houve conversão —
                        mesma régua do PDF e da grade de KPIs. */}
                    {p.cpaIndefinido ? "—" : formatCurrency(p.cpa)} por
                    resultado
                  </p>
                </div>
              ))}
            </div>
          </div>

          <PageFooter numero={2} assinatura={assinatura} />
        </section>

        {/* ================== UMA PÁGINA POR PLATAFORMA ==================
            Meta e Google separados, cada um com o quadro completo e as
            próprias campanhas. O bloco acima mostra a FATIA do orçamento;
            esta parte responde a pergunta que o cliente faz de verdade —
            "como foi o Meta, como foi o Google" —, que a participação
            esconde quando um canal entrega o dobro com metade da verba.

            Sai do mesmo `buildPlatformDetail` que alimenta o PDF: dois
            cálculos fariam a folha revisada aqui divergir do arquivo
            enviado. */}
        {platformDetail.map((p, i) => (
          <section
            key={p.platform}
            className={`page flex flex-col px-[18mm] py-[16mm] ${A4}`}
          >
            <PageHeader client={client.name} periodo={periodo} brand={brand} />

            <span
              className="mt-8 inline-flex w-fit rounded px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white"
              style={{ background: brand }}
            >
              {p.label}
            </span>

            <h2 className="mt-3 text-[26px] font-bold tracking-[-0.025em]">
              Desempenho no {p.label}
            </h2>
            <p className="mt-1 text-[12px] text-[#64707d]">
              {formatPercent(p.spendShare, 0)} do investimento do período. A
              variação compara este canal com ele mesmo no período anterior.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {p.kpis.map((kpi) => (
                <div
                  key={kpi.key}
                  className="rounded-xl border border-[#e6e8ec] bg-[#f8f9fb] p-4"
                >
                  <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[#8b95a1]">
                    {kpi.label}
                  </p>
                  <p className="mt-2 text-[20px] font-bold tracking-[-0.02em]">
                    {kpi.formatted}
                  </p>
                  {kpi.origem !== null && (
                    <p className="mt-1 text-[7.5px] text-[#8b95a1]">
                      de {kpi.origem} {kpi.origem === 1 ? "campanha" : "campanhas"}
                    </p>
                  )}
                  <p
                    className="mt-1 text-[9px] font-medium"
                    style={{ color: sentimentColor(kpi.sentiment) }}
                  >
                    {kpi.deltaPercent === null
                      ? "sem base anterior"
                      : `${formatDelta(kpi.deltaPercent)} · antes ${kpi.previousFormatted}`}
                  </p>
                </div>
              ))}
            </div>

            {p.campaigns.length > 0 && (
              <div className="mt-8">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#64707d]">
                  Campanhas
                </h3>

                <table className="mt-3 w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="border-b border-[#d8dce2] text-left text-[8px] uppercase tracking-[0.1em] text-[#8b95a1]">
                      <th className="py-2 font-semibold">Campanha</th>
                      <th className="py-2 text-right font-semibold">Investido</th>
                      <th className="py-2 text-right font-semibold">Result.</th>
                      <th className="py-2 text-right font-semibold">Custo</th>
                      <th className="py-2 text-right font-semibold">Cliques</th>
                      <th className="py-2 text-right font-semibold">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* SEIS, medido no Chrome: com onze KPIs e oito
                        linhas a seção media 306,6mm contra 297mm de
                        folha, partia em duas e a numeração estática do
                        rodapé (3 + i) passava a mentir. Seis cabe. */}
                    {p.campaigns.slice(0, 6).map((c) => (
                      <tr key={c.name} className="border-b border-[#f0f2f5]">
                        <td className="py-2 pr-3">{c.name}</td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCurrency(c.spendCents)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatNumber(c.results)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {c.results > 0 ? formatCurrency(c.cpaCents) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatNumber(c.clicks)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatPercent(c.ctr, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {p.campaigns.length > 6 && (
                  <p className="mt-2 text-[9px] italic text-[#8b95a1]">
                    Mais {p.campaigns.length - 6}{" "}
                    {p.campaigns.length - 6 === 1 ? "campanha" : "campanhas"} com
                    investimento menor.
                  </p>
                )}
              </div>
            )}

            <PageFooter numero={3 + i} assinatura={assinatura} />
          </section>
        ))}

        {/* ===================== CRIATIVOS ATIVOS ====================== */}
        <section className={`page flex flex-col px-[18mm] py-[16mm] ${A4}`}>
          <PageHeader client={client.name} periodo={periodo} brand={brand} />

          <h2 className="mt-8 text-[26px] font-bold tracking-[-0.025em]">
            Anúncios que rodaram
          </h2>
          {/* A frase anterior afirmava "criativos ativos NO PERÍODO, com o
              desempenho individual de cada um" — e os números vinham da
              última sincronização, não do período da capa. O texto agora
              descreve o que é: anúncios NO AR, cujo desempenho é apurado
              para a janela do relatório. A diferença importa porque a
              seleção continua sendo por status atual, então um anúncio
              que rodou no período e já foi pausado não aparece aqui. */}
          <p className="mt-1 text-[12px] text-[#64707d]">
            {creativesDoPeriodo
              ? "Anúncios no ar, com o desempenho de cada um apurado no período deste relatório."
              : "Anúncios no ar, com o desempenho da última sincronização — não foi possível apurar estes anúncios no período deste relatório."}
          </p>

          {creatives.length === 0 ? (
            <p className="mt-10 rounded-xl border border-dashed border-[#d8dce2] py-14 text-center text-[12px] text-[#8b95a1]">
              Nenhum anúncio no ar sincronizado para esta conta.
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

          {/* Depois das páginas por plataforma — a numeração acompanha. */}
          <PageFooter
            numero={3 + platformDetail.length}
            assinatura={assinatura}
          />
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

function PageFooter({
  numero,
  assinatura,
}: {
  numero: number;
  assinatura: string;
}) {
  return (
    <>
      {/* Empurra o rodapé para a base da folha. Sem isto ele fica logo
          abaixo do conteúdo, e uma página curta sai com a numeração
          boiando no meio do papel — parece relatório truncado.

          `flex-1` come a sobra; `min-h-6` garante respiro mesmo quando
          não sobra nada, que é o caso da página cheia de criativos. */}
      <div className="min-h-6 flex-1" />
      <footer className="flex items-center justify-between border-t border-[#e6e8ec] pt-3 text-[9px] text-[#8b95a1]">
        <span>{assinatura}</span>
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

/**
 * A pessoa logada enxerga esta conta?
 *
 * A consulta usa o cliente com a chave ANON e o JWT da sessão, então
 * quem decide é a policy do Postgres — não uma regra escrita aqui. Um
 * colaborador fora da carteira recebe zero linhas e cai no `notFound`.
 *
 * Existe porque `getPrintReportData` roda com o cliente ADMIN: aquele
 * caminho ignora RLS de propósito (o Puppeteer não tem sessão), e sem
 * esta porta o acesso humano herdaria o mesmo bypass.
 */
async function equipePodeVer(clientId: string): Promise<boolean> {
  const { getCurrentUser, createSupabaseServerClient } = await import(
    "@/lib/supabase/server"
  );

  const user = await getCurrentUser();
  if (!user) return false;

  const { isDemoMode } = await import("@/lib/env");
  if (isDemoMode) return true;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Período quando o acesso é humano.
 *
 * Data malformada cai nos últimos 30 dias em vez de derrubar a página:
 * quem abriu quer revisar um documento, e um erro aqui deixaria a aba
 * em branco sem dizer o motivo. O intervalo aparece impresso na capa,
 * então um padrão errado é visível, não silencioso.
 */
function periodoDaQuery(
  inicio?: string,
  fim?: string,
): { periodStart: string; periodEnd: string } {
  const DATA = /^\d{4}-\d{2}-\d{2}$/;

  if (inicio && fim && DATA.test(inicio) && DATA.test(fim) && inicio <= fim) {
    return { periodStart: inicio, periodEnd: fim };
  }

  const { start, end } = resolvePeriod("30d");
  return { periodStart: start, periodEnd: end };
}
