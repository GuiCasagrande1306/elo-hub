import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { ReportPayload } from "@/lib/reports/payload";
import { payloadHeadline } from "@/lib/reports/payload";
import {
  formatCurrency,
  formatDate,
  formatDelta,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   Documento PDF — apresentação executiva
   ---------------------------------------------------------------------
   Notas de implementação:

   • Tipografia: Helvetica (embutida no react-pdf). Para usar Inter ou
     Satoshi, registrar o .ttf no bundle:
        Font.register({ family: "Inter", src: path.join(process.cwd(),
          "src/assets/fonts/Inter-Regular.ttf") })
     Evitamos baixar fonte por URL em tempo de render: uma falha de rede
     derrubaria a geração do relatório inteiro.

   • Gráficos: desenhados com <View> posicionado. O react-pdf não executa
     Recharts (não há DOM), e rasterizar gráfico como imagem perderia a
     nitidez na impressão. Retângulos vetoriais imprimem perfeito.

   • Imagens: apenas raster. O payload já marcou `imageIsRaster`; quando
     falso, entra um bloco na cor da marca no lugar — uma imagem inválida
     aqui aborta a geração inteira, e um criativo sem thumb não pode
     custar o relatório do cliente.
   ===================================================================== */

const INK = "#141413";
const INK_SOFT = "#5C5C57";
const HAIRLINE = "#E4E2DD";
const SURFACE = "#F7F6F3";
const POSITIVE = "#1F7A4D";
const NEGATIVE = "#B03A2E";

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: INK,
    backgroundColor: "#FFFFFF",
  },

  /* ---------------------------- Capa ---------------------------- */
  cover: { padding: 0, fontFamily: "Helvetica", color: INK },
  coverBand: { height: 300, paddingTop: 56, paddingHorizontal: 48 },
  coverEyebrow: {
    fontSize: 8,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#FFFFFF",
    opacity: 0.75,
  },
  coverTitle: {
    fontSize: 34,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    marginTop: 14,
    lineHeight: 1.1,
  },
  coverPeriod: { fontSize: 11, color: "#FFFFFF", opacity: 0.9, marginTop: 12 },
  coverBody: { paddingHorizontal: 48, paddingTop: 36 },

  /* -------------------------- Estrutura ------------------------- */
  eyebrow: {
    fontSize: 7.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  sub: { fontSize: 9, color: INK_SOFT, marginBottom: 16 },
  section: { marginBottom: 26 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  headerName: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  headerMeta: { fontSize: 8, color: INK_SOFT },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: INK_SOFT,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },

  /* ---------------------------- KPIs ---------------------------- */
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  kpiLabel: {
    fontSize: 7,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  kpiValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 7 },
  kpiDelta: { fontSize: 8, marginTop: 6 },
  kpiPrev: { fontSize: 7.5, color: INK_SOFT, marginTop: 2 },

  /* --------------------------- Gráfico -------------------------- */
  chartFrame: {
    height: 130,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1.5,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 1,
  },
  chartAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    fontSize: 7,
    color: INK_SOFT,
  },

  /* --------------------------- Canais --------------------------- */
  /* --------------------- Página por plataforma -------------------- */
  platformBadge: {
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  platformShare: { fontSize: 9, color: INK_SOFT, marginBottom: 14 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  td: { fontSize: 8.5 },

  splitRow: { marginBottom: 12 },
  splitHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  splitName: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  splitTrack: {
    height: 5,
    backgroundColor: HAIRLINE,
    borderRadius: 3,
    overflow: "hidden",
  },
  splitMeta: { fontSize: 7.5, color: INK_SOFT, marginTop: 4 },

  /* -------------------------- Criativos ------------------------- */
  adCard: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  adThumb: { width: 92, height: 92, borderRadius: 6, objectFit: "cover" },
  adPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  adPlatform: {
    fontSize: 6.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adHeadline: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 3 },
  adCopy: { fontSize: 8, color: INK_SOFT, marginTop: 4, lineHeight: 1.45 },
  adMetrics: {
    flexDirection: "row",
    gap: 18,
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  adMetricLabel: {
    fontSize: 6.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adMetricValue: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 2 },

  /* --------------------------- Textos --------------------------- */
  paragraph: { fontSize: 9.5, lineHeight: 1.6, color: INK },
  stepRow: { flexDirection: "row", gap: 8, marginBottom: 7 },
  stepIndex: { fontSize: 9, fontFamily: "Helvetica-Bold", width: 14 },
  stepText: { fontSize: 9.5, lineHeight: 1.5, flex: 1 },

  emptyNote: {
    fontSize: 8.5,
    color: INK_SOFT,
    fontStyle: "italic",
    paddingVertical: 8,
  },
});

export function ReportDocument({ payload }: { payload: ReportPayload }) {
  const accent = payload.meta.accent;
  const brand = payload.client.brandPrimary ?? INK;
  const chartColor = payload.client.brandPrimary ?? accent;
  const period = formatPeriod(payload.meta.periodStart, payload.meta.periodEnd);

  // A capa é sempre a primeira página; as demais seções seguem a ordem
  // definida no template do segmento.
  const bodySections = payload.sections.filter((s) => s.type !== "cover");
  const cover = payload.sections.find((s) => s.type === "cover");

  return (
    <Document
      title={`${payload.client.name} — ${period}`}
      /* METADADO TAMBÉM É MARCA. Tirar o nome impresso e deixar
         author="Elo Marketing" no arquivo só esconde: quem recebe abre
         as Propriedades do PDF e lê o nome de outra agência. `author` é
         quem assina; `creator` some, porque o nome do sistema interno
         não diz nada a quem recebe e denuncia a ferramenta. */
      author={payload.agency?.name ?? payload.client.name}
      /* `templateName` é nomenclatura INTERNA de operação ("E-commerce
         — Receita & ROAS"). Não denuncia agência, mas expõe como a casa
         organiza o trabalho para quem abrir as propriedades. */
      subject={`Relatório de performance — ${period}`}
    >
      {/* ============================= CAPA ============================= */}
      <Page size="A4" style={styles.cover}>
        <View style={[styles.coverBand, { backgroundColor: brand }]}>
          <Text style={styles.coverEyebrow}>
            {cover?.title ?? "Relatório de Mídia Paga"}
          </Text>
          <Text style={styles.coverTitle}>{payload.client.name}</Text>
          <Text style={styles.coverPeriod}>{period}</Text>

          {/* ASSINATURA DA AGÊNCIA na capa: logo quando existe, barra de
              acento quando não. As duas ocupam o mesmo lugar e o mesmo
              respiro, então a capa não muda de composição conforme a
              agência tenha ou não enviado o arquivo.

              O logo é RASTER por contrato (a migration 38 recusa SVG na
              entrada): o react-pdf não rasteriza vetor, e uma imagem que
              ele não consegue abrir ABORTA o documento inteiro. Um logo
              faltando não pode custar o relatório do cliente. */}
          {payload.agency?.logoUrl ? (
            // Mesmo falso positivo do thumb de criativo: este `Image` é
            // do @react-pdf/renderer e não existe `alt` no PDF.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={payload.agency.logoUrl}
              style={{ height: 26, marginTop: 22, objectFit: "contain" }}
            />
          ) : (
            <View
              style={{
                width: 64,
                height: 4,
                backgroundColor: accent,
                marginTop: 22,
                borderRadius: 2,
              }}
            />
          )}
        </View>

        <View style={styles.coverBody}>
          <CoverSummary payload={payload} />
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {payload.agency
              ? `${payload.agency.name} · Relatório de performance`
              : "Relatório de performance"}
          </Text>
          <Text>
            Gerado em {formatDate(payload.meta.generatedAt)}
          </Text>
        </View>
      </Page>

      {/* =========================== CONTEÚDO =========================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.headerName}>{payload.client.name}</Text>
          <Text style={styles.headerMeta}>{period}</Text>
        </View>

        {bodySections.map((section, index) => {
          /* `platform_detail` sai do molde das outras seções: ele rende
             UMA PÁGINA POR PLATAFORMA, e o invólucro comum tem
             `wrap={false}` — que tentaria segurar onze KPIs mais a
             tabela de campanhas de dois canais na mesma folha e
             estouraria a margem. */
          if (section.type === "platform_detail") {
            return (
              <PlatformPages
                key={`${section.type}-${index}`}
                payload={payload}
                title={section.title}
                accent={chartColor}
              />
            );
          }

          return (
            <View key={`${section.type}-${index}`} style={styles.section} wrap={false}>
              <Text style={styles.h2}>{section.title}</Text>
              {/* Gráficos usam a cor da marca DO CLIENTE, não o acento da
                  agência: o documento é lido por ele, e o neon do template
                  tem contraste ruim sobre papel branco. O acento fica
                  reservado à capa, onde marca a autoria da agência. */}
              <SectionBody
                section={section.type}
                payload={payload}
                accent={chartColor}
              />
            </View>
          );
        })}

        <View style={styles.footer} fixed>
          <Text>{payload.agency?.name ?? ""}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

function CoverSummary({ payload }: { payload: ReportPayload }) {
  const top = payload.kpis.slice(0, 3);

  return (
    <View>
      <Text style={styles.eyebrow}>Resumo do período</Text>
      <View style={[styles.kpiRow, { marginTop: 12 }]}>
        {top.map((kpi) => (
          <View key={kpi.key} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
            <Text style={styles.kpiValue}>{kpi.formatted}</Text>
            <DeltaText kpi={kpi} />
          </View>
        ))}
      </View>
      <Text style={[styles.sub, { marginTop: 14 }]}>
        Dados unificados de Google Ads e Meta Ads. A variação compara com
        os {payload.meta.days} dias imediatamente anteriores.
      </Text>
    </View>
  );
}

function DeltaText({ kpi }: { kpi: ReportPayload["kpis"][number] }) {
  if (kpi.deltaPercent === null) {
    return <Text style={styles.kpiPrev}>sem base de comparação</Text>;
  }

  // A cor segue o SENTIMENTO já resolvido pelo motor de KPI — CPA caindo
  // é verde, mesmo sendo variação negativa.
  const color =
    kpi.sentiment === "positive"
      ? POSITIVE
      : kpi.sentiment === "negative"
        ? NEGATIVE
        : INK_SOFT;

  // Sem glifo de seta: a Helvetica embutida no PDF usa codificação
  // WinAnsi, que não tem ▲/▼ — os caracteres saem substituídos por
  // lixo ("²", "¼"). O sinal explícito diz a direção e a cor diz se é
  // bom ou ruim, que é a informação que importa.
  // `formatDelta` já devolve "+5,0%" / "-0,8%" com hífen ASCII (U+002D),
  // que existe em WinAnsi. Evitar o sinal tipográfico U+2212, que não.
  return (
    <>
      <Text style={[styles.kpiDelta, { color }]}>
        {formatDelta(kpi.deltaPercent)}
      </Text>
      <Text style={styles.kpiPrev}>anterior: {kpi.previousFormatted}</Text>
    </>
  );
}

function SectionBody({
  section,
  payload,
  accent,
}: {
  section: string;
  payload: ReportPayload;
  accent: string;
}) {
  switch (section) {
    case "kpi_grid":
      return <KpiGrid payload={payload} />;
    case "trend_chart":
      return <TrendBars payload={payload} accent={accent} />;
    case "platform_split":
      return <PlatformBars payload={payload} accent={accent} />;
    case "campaign_table":
      return <PlatformBars payload={payload} accent={accent} />;
    case "ad_gallery":
      return <AdGallery payload={payload} />;
    case "insights":
      return payload.insights ? (
        <Text style={styles.paragraph}>{payload.insights}</Text>
      ) : (
        <Text style={styles.emptyNote}>
          Análise não preenchida para este período.
        </Text>
      );
    case "next_steps":
      return payload.nextSteps.length > 0 ? (
        <View>
          {payload.nextSteps.map((step, index) => (
            <View key={index} style={styles.stepRow}>
              <Text style={styles.stepIndex}>{index + 1}.</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyNote}>
          Próximos passos serão alinhados na reunião de resultados.
        </Text>
      );
    default:
      return null;
  }
}

/**
 * Uma página por plataforma: quadro completo de métricas + campanhas.
 *
 * `break` em TODAS, inclusive na primeira. O canal começa em folha
 * limpa porque é assim que o cliente lê — ele procura "a parte do Meta",
 * e uma seção que começa no meio da página anterior não é uma parte.
 *
 * Plataforma sem veiculação no período não aparece: `platformDetail` já
 * vem só com quem teve linha. Uma conta que só roda Meta não recebe uma
 * página de Google zerada.
 */
function PlatformPages({
  payload,
  title,
  accent,
}: {
  payload: ReportPayload;
  title: string;
  accent: string;
}) {
  if (payload.platformDetail.length === 0) {
    return (
      <View style={styles.section} wrap={false}>
        <Text style={styles.h2}>{title}</Text>
        <Text style={styles.emptyNote}>
          Nenhuma plataforma teve veiculação neste período.
        </Text>
      </View>
    );
  }

  return (
    <>
      {payload.platformDetail.map((p) => (
        <View key={p.platform} style={styles.section} break>
          <Text style={[styles.platformBadge, { backgroundColor: accent }]}>
            {p.label}
          </Text>

          <Text style={styles.h2}>{title}</Text>
          <Text style={styles.platformShare}>
            {formatPercent(p.spendShare, 0)} do investimento do período · variação
            contra o período anterior deste mesmo canal
          </Text>

          <KpiCards kpis={p.kpis} />

          {p.campaigns.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.eyebrow, { marginBottom: 8 }]}>
                Campanhas
              </Text>

              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 3 }]}>Campanha</Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Investido
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Result.
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Custo
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  Cliques
                </Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>
                  CTR
                </Text>
              </View>

              {/* SEIS, e o número foi medido, não escolhido.
                  Com onze KPIs (quatro linhas de cartões, ~415pt) mais
                  cabeçalho de tabela e a nota do rodapé, oito linhas
                  somam ~735pt contra ~697pt úteis da folha — cada
                  plataforma estourava para uma segunda página que saía
                  quase vazia. Seis cabe; sete já não. */}
              {p.campaigns.slice(0, 6).map((c) => (
                <View key={c.name} style={styles.tableRow}>
                  <Text style={[styles.td, { flex: 3 }]}>{c.name}</Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatCurrency(c.spendCents)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatNumber(c.results)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {c.results > 0 ? formatCurrency(c.cpaCents) : "—"}
                  </Text>
                  {/* Cliques existia só na folha HTML: a equipe conferia
                      uma tabela de seis colunas e o cliente recebia uma
                      de cinco. */}
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatNumber(c.clicks)}
                  </Text>
                  <Text style={[styles.td, { flex: 1, textAlign: "right" }]}>
                    {formatPercent(c.ctr, 2)}
                  </Text>
                </View>
              ))}

              {p.campaigns.length > 6 && (
                <Text style={[styles.emptyNote, { paddingVertical: 6 }]}>
                  Mais {p.campaigns.length - 6}{" "}
                  {p.campaigns.length - 6 === 1 ? "campanha" : "campanhas"} com
                  investimento menor.
                </Text>
              )}
            </View>
          )}
        </View>
      ))}
    </>
  );
}

/** Grade de KPIs de três colunas, reaproveitada pelas duas seções. */
function KpiCards({ kpis }: { kpis: ReportPayload["kpis"] }) {
  const rows: ReportPayload["kpis"][] = [];
  for (let i = 0; i < kpis.length; i += 3) rows.push(kpis.slice(i, i + 3));

  return (
    <View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.kpiRow}>
          {row.map((kpi) => (
            <View key={kpi.key} style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
              <Text style={styles.kpiValue}>{kpi.formatted}</Text>
              <DeltaText kpi={kpi} />
            </View>
          ))}
          {/* Preenche a linha incompleta para os cards não esticarem. */}
          {row.length < 3 &&
            Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={{ flex: 1 }} />
            ))}
        </View>
      ))}
    </View>
  );
}

function KpiGrid({ payload }: { payload: ReportPayload }) {
  // Delega para `KpiCards`: a grade é a mesma da página por plataforma,
  // e duas cópias divergiriam na primeira mudança de espaçamento.
  return <KpiCards kpis={payload.kpis} />;
}

/**
 * Barras de investimento diário.
 * Cada barra é um <View> com altura proporcional — vetor puro, imprime
 * nítido em qualquer resolução.
 */
function TrendBars({
  payload,
  accent,
}: {
  payload: ReportPayload;
  accent: string;
}) {
  const data = payload.trend;
  if (data.length === 0) {
    return <Text style={styles.emptyNote}>Sem dados no período.</Text>;
  }

  const max = Math.max(...data.map((p) => p.spend), 1);

  return (
    <View>
      <View style={styles.chartFrame}>
        {data.map((point) => (
          <View
            key={point.date}
            style={{
              flex: 1,
              // Mínimo de 2pt: dia com investimento quase zero ainda
              // precisa aparecer como barra, senão parece dado faltando.
              height: Math.max((point.spend / max) * 124, 2),
              backgroundColor: accent,
              borderTopLeftRadius: 1.5,
              borderTopRightRadius: 1.5,
            }}
          />
        ))}
      </View>

      <View style={styles.chartAxis}>
        <Text>{formatDate(`${data[0].date}T12:00:00`)}</Text>
        <Text>
          pico {formatCurrency(Math.round(max * 100))}
        </Text>
        <Text>{formatDate(`${data[data.length - 1].date}T12:00:00`)}</Text>
      </View>
    </View>
  );
}

function PlatformBars({
  payload,
  accent,
}: {
  payload: ReportPayload;
  accent: string;
}) {
  if (payload.platforms.length === 0) {
    return <Text style={styles.emptyNote}>Nenhum canal ativo no período.</Text>;
  }

  return (
    <View>
      {payload.platforms.map((row) => (
        <View key={row.platform} style={styles.splitRow}>
          <View style={styles.splitHead}>
            <Text style={styles.splitName}>{row.label}</Text>
            <Text style={{ fontSize: 9.5 }}>
              {formatCurrency(row.totals.spendCents)}{" "}
              <Text style={{ color: INK_SOFT, fontSize: 8 }}>
                {formatPercent(row.spendShare, 0)}
              </Text>
            </Text>
          </View>

          <View style={styles.splitTrack}>
            <View
              style={{
                width: `${Math.max(row.spendShare * 100, 1.5)}%`,
                height: "100%",
                backgroundColor: accent,
              }}
            />
          </View>

          <Text style={styles.splitMeta}>
            {formatNumber(Math.round(row.totals.conversions))} resultados ·{" "}
            {formatCurrency(row.cpa)} por resultado
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Galeria de anúncios: miniatura, copy e as métricas daquele criativo.
 * É a seção que o cliente mais lê — ele reconhece o anúncio que viu.
 */
function AdGallery({ payload }: { payload: ReportPayload }) {
  if (payload.creatives.length === 0) {
    return (
      <Text style={styles.emptyNote}>
        Nenhum criativo ativo sincronizado neste período.
      </Text>
    );
  }

  return (
    <View>
      {payload.creatives.map((ad) => (
        <View key={ad.id} style={styles.adCard} wrap={false}>
          {ad.imageIsRaster && ad.imageUrl ? (
            // `Image` aqui é do @react-pdf/renderer, não <img> do DOM:
            // não existe `alt` no PDF. A regra de a11y é um falso
            // positivo por casar apenas pelo nome do componente.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={ad.imageUrl} style={styles.adThumb} />
          ) : (
            <View
              style={[
                styles.adPlaceholder,
                { backgroundColor: payload.client.brandPrimary ?? SURFACE },
              ]}
            >
              <Text style={{ fontSize: 7, color: "#FFFFFF", opacity: 0.85 }}>
                {ad.platformLabel}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={styles.adPlatform}>
              {ad.platformLabel} · {ad.campaignName ?? "—"}
            </Text>
            <Text style={styles.adHeadline}>{ad.headline ?? ad.adName ?? "—"}</Text>
            {ad.primaryText && (
              <Text style={styles.adCopy}>{truncate(ad.primaryText, 190)}</Text>
            )}

            <View style={styles.adMetrics}>
              <View>
                <Text style={styles.adMetricLabel}>Investido</Text>
                <Text style={styles.adMetricValue}>
                  {formatCurrency(ad.spendCents)}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>Resultados</Text>
                <Text style={styles.adMetricValue}>
                  {formatNumber(ad.results)}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>Custo/result.</Text>
                <Text style={styles.adMetricValue}>
                  {ad.cpaCents > 0 ? formatCurrency(ad.cpaCents) : "—"}
                </Text>
              </View>
              <View>
                <Text style={styles.adMetricLabel}>CTR</Text>
                <Text style={styles.adMetricValue}>
                  {formatPercent(ad.ctr, 2)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Corta no limite de palavra — corte no meio da palavra parece defeito. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

export { payloadHeadline };
