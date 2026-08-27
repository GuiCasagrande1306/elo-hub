import { join } from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { ReportPayload } from "@/lib/reports/payload";
import { copyDoAnuncio, semEmoji } from "./texto-seguro";
import { payloadHeadline } from "@/lib/reports/payload";
import {
  formatCurrency,
  formatDate,
  formatDelta,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   Documento PDF — apresentação executiva
   ---------------------------------------------------------------------
   Notas de implementação:

   • Tipografia: GEIST, EMBUTIDA no arquivo.

     ⚠️ CORREÇÃO DE UMA AFIRMAÇÃO QUE ESTAVA AQUI. Este comentário dizia
     "Helvetica (embutida no react-pdf)". É falso, e custou caro: as
     quatorze fontes padrão do PDF — Helvetica entre elas — NÃO são
     embutidas por definição. O arquivo só escreve "use Helvetica" e
     transfere o problema para quem abre.

     Medido: o relatório saía com 15KB e ZERO fontes embutidas. Em
     desktop passa despercebido, porque Preview, Acrobat e Chrome
     substituem por Arial, que tem métrica idêntica. No celular — que é
     onde o cliente abre o PDF que chega por WhatsApp — não existe
     Helvetica nem Arial: o visualizador troca por Roboto ou pior, as
     larguras deixam de bater com as posições que o react-pdf calculou,
     e o resultado é texto sobreposto e valor que some da página.

     Geist porque é a mesma família da interface, é OFL (redistribuível,
     e a licença acompanha em src/assets/fonts/OFL.txt) e cobre o
     português inteiro. Os arquivos são lidos do disco no bundle, nunca
     por URL: uma falha de rede em tempo de render derrubaria a geração
     do relatório inteiro.

   • Gráficos: desenhados com <View> posicionado. O react-pdf não executa
     Recharts (não há DOM), e rasterizar gráfico como imagem perderia a
     nitidez na impressão. Retângulos vetoriais imprimem perfeito.

   • Imagens: apenas raster. O payload já marcou `imageIsRaster`; quando
     falso, entra um bloco na cor da marca no lugar — uma imagem inválida
     aqui aborta a geração inteira, e um criativo sem thumb não pode
     custar o relatório do cliente.
   ===================================================================== */

/* Registrado no MÓDULO, não dentro do componente: o react-pdf guarda as
   fontes num registro global e registrar a cada render recarregaria o
   arquivo do disco a cada relatório do cron.

   `join(process.cwd(), ...)` e não `import` do .ttf: o Turbopack trataria
   o import como asset e devolveria uma URL, que é exatamente o caminho
   por rede que este documento não pode depender. Na Vercel o
   `outputFileTracingIncludes` do next.config garante que os dois arquivos
   viajem junto com a função. */
const DIR_FONTES = join(process.cwd(), "src/assets/fonts");

/* AS QUATRO ENTRADAS SÃO OBRIGATÓRIAS, e as duas de baixo não são
   decoração.

   O react-pdf resolve fonte por (família, peso, estilo) e LANÇA ERRO
   quando a combinação não existe — não cai para a mais próxima. Como
   Helvetica era usada antes, e Helvetica-Oblique é uma das quatorze
   fontes padrão do PDF, todo `fontStyle: "italic"` resolvia sozinho.
   Ao trocar para Geist esse chão sumiu: uma nota em itálico numa seção
   vazia derrubava a geração INTEIRA com

     Error: Could not resolve font for Geist, fontWeight 400, fontStyle italic

   e o cliente recebia um 500 no lugar do relatório. Não era hipótese —
   foi o que aconteceu em produção nos dois cliques em "Visualizar PDF".

   Geist não tem itálico: a família publicada pela Vercel é só vertical.
   Então as entradas `italic` apontam para os MESMOS arquivos verticais.
   O texto sai sem inclinação, e essa é a escolha consciente: perder a
   inclinação de uma nota secundária custa quase nada, perder o
   relatório custa o envio ao cliente. Os estilos deste arquivo já não
   pedem itálico — isto existe para que um `fontStyle: "italic"` escrito
   daqui a seis meses degrade em vez de derrubar. */
Font.register({
  family: "Geist",
  fonts: [
    { src: join(DIR_FONTES, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: join(DIR_FONTES, "Geist-Bold.ttf"), fontWeight: 700 },
    {
      src: join(DIR_FONTES, "Geist-Regular.ttf"),
      fontWeight: 400,
      fontStyle: "italic",
    },
    {
      src: join(DIR_FONTES, "Geist-Bold.ttf"),
      fontWeight: 700,
      fontStyle: "italic",
    },
  ],
});

/* O hifenizador padrão do react-pdf quebra palavra no meio sem hífen
   visível, e em português isso produz coisas como "investi mento" no
   meio de um cartão estreito. Desligado: preferimos a palavra inteira
   passando para a linha seguinte. */
Font.registerHyphenationCallback((palavra) => [palavra]);

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
    fontFamily: "Geist",
    color: INK,
    backgroundColor: "#FFFFFF",
  },

  /* ---------------------------- Capa ---------------------------- */
  cover: { padding: 0, fontFamily: "Geist", color: INK },
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
    fontFamily: "Geist", fontWeight: 700,
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
  h2: { fontSize: 15, fontFamily: "Geist", fontWeight: 700, marginBottom: 3 },
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
  headerName: { fontSize: 10, fontFamily: "Geist", fontWeight: 700 },
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
  kpiValue: { fontSize: 20, fontFamily: "Geist", fontWeight: 700, marginTop: 7 },

  /* ------------------------- Destaque da capa ------------------------ */
  /* Sem moldura e sem fundo, ao contrário dos cartões de apoio: o
     destaque não compete com eles, ele os PRECEDE. Caixa dentro de caixa
     achataria a hierarquia que o tamanho da fonte já estabelece. */
  destaque: { marginTop: 14, marginBottom: 4 },
  destaqueLabel: {
    fontSize: 8,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  destaqueValor: {
    fontSize: 40,
    fontFamily: "Geist",
    fontWeight: 700,
    marginTop: 4,
    lineHeight: 1.1,
  },
  destaqueNota: {
    fontSize: 8,
    color: INK_SOFT,
    marginTop: 6,
    lineHeight: 1.4,
    maxWidth: 330,
  },
  kpiDelta: { fontSize: 8, marginTop: 6 },
  kpiPrev: { fontSize: 7.5, color: INK_SOFT, marginTop: 2 },
  /* O selo da campanha de origem. Fica ACIMA do delta e abaixo do
     número, porque é qualificação do número, não da variação. */
  kpiOrigem: { fontSize: 6.5, color: INK_SOFT, marginTop: 1 },

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
  chartLegend: {
    flexDirection: "row",
    gap: 12,
    marginTop: 5,
    fontSize: 7,
    color: INK_SOFT,
  },
  chartLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3.5,
  },

  /* --------------------------- Canais --------------------------- */
  /* --------------------- Página por plataforma -------------------- */
  platformBadge: {
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: "Geist", fontWeight: 700,
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
    fontFamily: "Geist", fontWeight: 700,
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
  splitName: { fontSize: 9.5, fontFamily: "Geist", fontWeight: 700 },
  splitTrack: {
    height: 5,
    backgroundColor: HAIRLINE,
    borderRadius: 3,
    overflow: "hidden",
  },
  splitMeta: { fontSize: 7.5, color: INK_SOFT, marginTop: 4 },

  /* -------------------------- Criativos ------------------------- */
  /* CARTÃO COMPACTO — metade da altura do anterior.
     ------------------------------------------------------------------
     A galeria pedia 92px de miniatura e 12 de respiro por card: seis
     criativos ocupavam quase duas páginas, e o cliente rolava três
     telas para ver quatro anúncios. Nada de informação saiu; o que
     encolheu foi o espaço em volta dela. A miniatura em 46 continua
     reconhecível — é o quadro do vídeo, não a peça inteira, e quem lê
     reconhece o anúncio pelo rosto e pela cor. */
  adCard: {
    flexDirection: "row",
    gap: 8,
    padding: 8,
    marginBottom: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  adThumb: { width: 46, height: 46, borderRadius: 4, objectFit: "cover" },
  adPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  /* Linha do topo: plataforma à esquerda, selo do objetivo à direita. */
  adTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  /* O SELO DO OBJETIVO. Fundo sólido e não só texto colorido: o card é
     denso, e o cliente precisa achar "Vendas" varrendo a página, sem
     ler linha por linha. */
  adObjetivo: {
    fontSize: 6,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#FFFFFF",
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 3,
  },
  adPlatform: {
    fontSize: 6,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adHeadline: { fontSize: 8.5, fontFamily: "Geist", fontWeight: 700, marginTop: 2 },
  adCopy: { fontSize: 7, color: INK_SOFT, marginTop: 2, lineHeight: 1.35 },
  adMetrics: {
    flexDirection: "row",
    gap: 14,
    marginTop: 5,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  adMetricLabel: {
    fontSize: 5.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: INK_SOFT,
  },
  adMetricValue: { fontSize: 8, fontFamily: "Geist", fontWeight: 700, marginTop: 1 },

  /* --------------------------- Textos --------------------------- */
  paragraph: { fontSize: 9.5, lineHeight: 1.6, color: INK },
  stepRow: { flexDirection: "row", gap: 8, marginBottom: 7 },
  stepIndex: { fontSize: 9, fontFamily: "Geist", fontWeight: 700, width: 14 },
  stepText: { fontSize: 9.5, lineHeight: 1.5, flex: 1 },

  /* SEM `fontStyle: "italic"` — ver a nota no Font.register. A distinção
     visual já vinha do tamanho menor e do cinza; a inclinação era o
     terceiro sinal para a mesma coisa, e era o único que quebrava. */
  emptyNote: {
    fontSize: 8.5,
    color: INK_SOFT,
    paddingVertical: 8,
  },
  /* Ressalva sob o título da galeria. Compacta de propósito: a seção
     com seis cartões já ocupa quase a folha inteira, e cada ponto
     gasto aqui aproxima o corte do último cartão. */
  ressalva: {
    fontSize: 7.5,
    color: INK_SOFT,
    marginBottom: 4,
  },
});

export function ReportDocument({ payload }: { payload: ReportPayload }) {
  const accent = payload.meta.accent;
  const brand = payload.client.brandPrimary ?? INK;
  const chartColor = payload.client.brandPrimary ?? accent;
  const period = formatPeriod(payload.meta.periodStart, payload.meta.periodEnd);

  /* A capa é sempre a primeira página; as demais seguem a ordem definida
     no template do segmento.

     ⚠️ SEÇÃO DE TEXTO SEM TEXTO É REMOVIDA, não impressa vazia. O
     documento trazia "Análise não preenchida para este período" sob um
     título — uma seção inteira dedicada a avisar que não há nada ali.
     Desde que a escrita saiu do fluxo de envio, isso apareceria em TODO
     relatório, e um espaço em branco pedindo desculpa é pior do que a
     ausência: chama atenção para uma falta que o cliente não sentiria.

     Vale só para as duas seções que dependem de alguém escrever. As de
     dado (KPI, gráfico, galeria) continuam aparecendo mesmo vazias,
     porque ali o vazio é INFORMAÇÃO — "nenhum criativo veiculou" é um
     fato sobre o período, não uma lacuna de preenchimento. */
  const bodySections = payload.sections.filter((s) => {
    if (s.type === "cover") return false;
    if (s.type === "insights") return payload.insights.trim().length > 0;
    if (s.type === "next_steps") return payload.nextSteps.length > 0;
    return true;
  });
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
              entrada), porque o react-pdf não rasteriza vetor.

              ⚠️ CORREÇÃO DE UMA PREMISSA QUE ESTAVA ESCRITA AQUI: dizia-se
              que uma imagem ilegível ABORTA o documento inteiro. Isso é
              falso na versão instalada (@react-pdf/renderer 4.5.1) — o
              `fetchImage` engole o erro e simplesmente pula o desenho.
              O risco real é o oposto e mais traiçoeiro: o documento sai
              CALADO e incompleto, sem logo e sem nenhum sinal de que
              algo faltou. Por isso o formato é restringido na ENTRADA,
              onde ainda dá para avisar quem enviou. */}
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
          {/* O LOGO DO CLIENTE. Ele era montado no payload
              (`payload.client.logoUrl`) e nunca lido pelo documento — o
              relatório saía com a marca de quem assina e sem a marca de
              quem recebe.

              Fica no CORPO da capa, não na faixa: a faixa é a assinatura
              da agência, e as duas marcas juntas ali competiriam. Aqui
              ele abre a página como o cabeçalho de quem o documento é. */}
          {payload.client.logoUrl && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={payload.client.logoUrl}
              style={{
                height: 34,
                marginBottom: 26,
                objectFit: "contain",
                alignSelf: "flex-start",
              }}
            />
          )}
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

          /* A GALERIA PRECISA PODER QUEBRAR ENTRE PÁGINAS.
             `wrap={false}` diz ao react-pdf "não parta este nó", e ele
             obedece mesmo quando o nó é maior que a folha: empurra o
             bloco inteiro e segue desenhando por cima da margem, com um
             `console.warn` que ninguém lê em produção. Com os SEIS
             criativos que todos os templates pedem por padrão, o rodapé
             fixo (nome da agência e numeração) era empurrado para fora
             da página; com sete ou oito os cartões passavam a colidir
             com a linha de métricas.

             Cada CARTÃO continua com `wrap={false}` mais abaixo — partir
             um anúncio ao meio é que ficaria feio. O que muda é a
             seção, que agora deixa os cartões transbordarem para a folha
             seguinte, como a `platform_detail` já fazia. */
          const galeria = section.type === "ad_gallery";

          return (
            <View
              key={`${section.type}-${index}`}
              style={styles.section}
              wrap={galeria}
            >
              {/* ⚠️ O TÍTULO DA GALERIA PODE FICAR ÓRFÃO NO PÉ DA
                  PÁGINA, e isso é aceito de propósito.

                  `minPresenceAhead` não resolve: no `<Text>` ela é
                  ignorada porque `shouldBreak` exige elementos ANTES do
                  nó na mesma caixa, e o título é o primeiro filho; na
                  seção também, porque para um nó que PODE quebrar o ramo
                  do `minPresenceAhead` nunca chega a ser avaliado
                  (node_modules/@react-pdf/layout, `shouldBreak`).

                  Agrupar título e primeiro cartão num bloco
                  `wrap={false}` foi tentado e MEDIDO: o bloco passa a
                  não caber no que resta da folha, o react-pdf desenha
                  por cima da margem, e os três anúncios saem sobrepostos
                  uns aos outros — o defeito real no lugar do cosmético.
                  Um título sozinho no pé da página é o preço mais barato
                  dos dois. */}
              <Text style={styles.h2}>{section.title}</Text>

              {/* RESSALVA SÓ QUANDO É EXCEÇÃO. Quando os números foram
                  apurados para o período, nada é impresso. Aqui a linha
                  só aparece quando o documento estaria mentindo sem ela:
                  a apuração falhou e os valores são da última
                  sincronização, não do período da capa. */}
              {section.type === "ad_gallery" && !payload.creativesDoPeriodo && (
                <Text style={styles.ressalva}>
                  Desempenho da última sincronização — não foi possível
                  apurar estes anúncios no período do relatório.
                </Text>
              )}
              {/* Gráficos usam a cor da marca DO CLIENTE, não o acento da
                  agência: o documento é lido por ele, e o neon do template
                  tem contraste ruim sobre papel branco. O acento fica
                  reservado à capa, onde marca a autoria da agência. */}
              <SectionBody
                section={section.type}
                options={section.options}
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
  const destaque = payload.highlight;

  /* Os três de apoio saem da lista SEM o destaque — repetir o mesmo
     número grande e pequeno na mesma capa faz o leitor procurar a
     diferença que não existe. */
  const apoio = payload.kpis
    .filter((k) => k.key !== destaque?.key)
    .slice(0, 3);

  return (
    <View>
      <Text style={styles.eyebrow}>Resumo do período</Text>

      {destaque && (
        <View style={styles.destaque}>
          <Text style={styles.destaqueLabel}>{destaque.label}</Text>
          <Text style={styles.destaqueValor}>{destaque.formatted}</Text>

          {/* ⚠️ ZERO NO DESTAQUE É CASO PREVISTO, não exceção rara.
              Medido em produção: 5 das 16 contas de delivery e 1 das 4 de
              e-commerce não registram compra nenhuma pelo pixel. Nelas o
              faturamento é honestamente zero — mas um "R$ 0,00" em corpo
              32 no alto da capa não informa nada, só constrange. A frase
              diz o que o número sozinho não diz: que o problema é de
              rastreamento, não de venda. */}
          {destaque.value === 0 ? (
            <Text style={styles.destaqueNota}>
              Nada registrado pelo rastreamento neste período — o número
              acima mede o que o pixel conseguiu atribuir, não o total do
              negócio.
            </Text>
          ) : (
            <>
              <SeloDeOrigem kpi={destaque} />
              <DeltaText kpi={destaque} />
            </>
          )}
        </View>
      )}

      <View style={[styles.kpiRow, { marginTop: destaque ? 14 : 12 }]}>
        {apoio.map((kpi) => (
          <View key={kpi.key} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
            <Text style={styles.kpiValue}>{kpi.formatted}</Text>
            <SeloDeOrigem kpi={kpi} />
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

/**
 * "de 1 campanha" — o recorte que o número usou.
 *
 * SEM ISTO O NÚMERO NÃO FECHA, e é o tipo de discrepância que destrói a
 * confiança no relatório inteiro: a capa diz R$550,29 investidos e 22
 * compras, e o card diz R$16,75 por compra. Quem divide na calculadora
 * acha R$25,01. O selo é a diferença entre "o relatório está errado" e
 * "o custo é da campanha que vende".
 *
 * Só aparece quando houve recorte — numa conta em que toda campanha é de
 * venda, `origem` é nulo e dizer "de 3 campanhas" sugeriria um corte que
 * não houve.
 */
function SeloDeOrigem({ kpi }: { kpi: ReportPayload["kpis"][number] }) {
  if (kpi.origem === null) return null;
  return (
    <Text style={styles.kpiOrigem}>
      de {kpi.origem} {kpi.origem === 1 ? "campanha" : "campanhas"}
    </Text>
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
  options,
  payload,
  accent,
}: {
  section: string;
  /** `sections[].options` do template. Hoje só `trend_chart` usa. */
  options?: Record<string, unknown>;
  payload: ReportPayload;
  accent: string;
}) {
  switch (section) {
    case "kpi_grid":
      return <KpiGrid payload={payload} />;
    case "trend_chart":
      return (
        <TrendBars
          payload={payload}
          accent={accent}
          series={seriesDoTemplate(options)}
        />
      );
    case "platform_split":
      return <PlatformBars payload={payload} accent={accent} />;
    case "campaign_table":
      return <PlatformBars payload={payload} accent={accent} />;
    case "ad_gallery":
      return <AdGallery payload={payload} />;
    case "insights":
      return payload.insights ? (
        <Text style={styles.paragraph}>{semEmoji(payload.insights)}</Text>
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
              <Text style={styles.stepText}>{semEmoji(step)}</Text>
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
                  <Text style={[styles.td, { flex: 3 }]}>{semEmoji(c.name)}</Text>
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
              <SeloDeOrigem kpi={kpi} />
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
  series,
}: {
  payload: ReportPayload;
  accent: string;
  series: SerieDoGrafico[];
}) {
  const data = payload.trend;
  if (data.length === 0) {
    return <Text style={styles.emptyNote}>Sem dados no período.</Text>;
  }

  /* UMA ESCALA SÓ para todas as séries. Escalas independentes fariam
     duas barras de alturas iguais significarem R$ 190 e R$ 2.539 — que
     é o oposto do que um gráfico de comparação existe para mostrar. Com
     escala compartilhada a barra de investimento fica baixa mesmo, e
     isso é o fato. */
  const max = Math.max(
    ...series.flatMap((s) => data.map((p) => valorDaSerie(p, s))),
    0,
  );

  /* ⚠️ SEM PISO ARTIFICIAL, e essa era uma regressão nova. O piso `1`
     existia de quando o gráfico só desenhava dinheiro, onde um período
     inteiro zerado só acontece sem linha nenhuma. Com `series:
     ["results"]` — o que três dos quatro templates pedem — zero no
     período é caso comum e documentado, e o piso fazia o eixo imprimir
     "pico 1" sob "Pedidos por dia" numa conta com zero pedidos. O card
     da página anterior dizia "Pedidos: 0"; o gráfico dizia 1.

     Sem nada para desenhar, a seção diz isso. */
  if (max <= 0) {
    return (
      <Text style={styles.emptyNote}>
        Sem {ROTULO_DA_SERIE[series[0]].toLowerCase()} no período.
      </Text>
    );
  }

  /* O pico é da série que REALMENTE tem o maior valor — com duas séries
     na mesma escala, rotulá-lo sempre pela primeira diria "pico" de
     investimento sobre a altura do faturamento. */
  const serieDoPico =
    series.find((s) => data.some((p) => valorDaSerie(p, s) === max)) ??
    series[0];

  return (
    <View>
      <View style={styles.chartFrame}>
        {data.map((point) => (
          <View
            key={point.date}
            style={{ flex: 1, flexDirection: "row", gap: 0.6, alignItems: "flex-end" }}
          >
            {series.map((s, i) => (
              <View
                key={s}
                style={{
                  flex: 1,
                  // Mínimo de 2pt: dia com valor quase zero ainda precisa
                  // aparecer como barra, senão parece dado faltando.
                  height: Math.max((valorDaSerie(point, s) / max) * 124, 2),
                  backgroundColor: i === 0 ? accent : INK_SOFT,
                  borderTopLeftRadius: 1.5,
                  borderTopRightRadius: 1.5,
                }}
              />
            ))}
          </View>
        ))}
      </View>

      <View style={styles.chartAxis}>
        <Text>{formatDate(`${data[0].date}T12:00:00`)}</Text>
        <Text>pico {formatarSerie(max, serieDoPico)}</Text>
        <Text>{formatDate(`${data[data.length - 1].date}T12:00:00`)}</Text>
      </View>

      {/* LEGENDA só quando há mais de uma série: com uma, a cor não
          distingue nada e a linha vira ruído. */}
      {series.length > 1 && (
        <View style={styles.chartLegend}>
          {series.map((s, i) => (
            <View key={s} style={styles.chartLegendItem}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 1,
                  backgroundColor: i === 0 ? accent : INK_SOFT,
                }}
              />
              <Text>{ROTULO_DA_SERIE[s]}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* A série do gráfico                                                  */
/* ------------------------------------------------------------------ */

/**
 * O que o gráfico desenha, lido de `sections[].options.series`.
 *
 * ⚠️ ISSO ERA IGNORADO, e o título ficava mentindo. `SectionBody`
 * recebia só `section.type` e `TrendBars` desenhava `spend` sempre — em
 * TODOS os templates. Os quatro em produção pedem outra coisa:
 *
 *     delivery        "Pedidos por dia"        series: results
 *     leads           "Leads por dia"          series: results
 *     local_business  "Contatos por dia"       series: results
 *     ecommerce       "Investimento x receita" series: spend + revenue
 *
 * Ou seja, o PDF de qualquer conta de delivery saía com o título
 * "Pedidos por dia" sobre trinta barras cuja altura era o GASTO do dia,
 * e o único sinal disso era o "pico R$ 191,72" no eixo. O cliente lia o
 * pico de investimento de uma terça como pico de pedidos.
 *
 * `spend` como padrão para o template que não declarar nada: é o que o
 * gráfico sempre desenhou, então a ausência de `options` mantém o
 * comportamento antigo em vez de esvaziar a seção.
 */
type SerieDoGrafico = "spend" | "results" | "revenue" | "cpa";

const SERIES_VALIDAS: SerieDoGrafico[] = ["spend", "results", "revenue", "cpa"];

const ROTULO_DA_SERIE: Record<SerieDoGrafico, string> = {
  spend: "Investimento",
  results: "Resultados",
  revenue: "Faturamento",
  cpa: "Custo por resultado",
};

function seriesDoTemplate(
  options: Record<string, unknown> | undefined,
): SerieDoGrafico[] {
  const bruto = options?.series;
  if (!Array.isArray(bruto)) return ["spend"];

  /* DUAS NO MÁXIMO: são barras agrupadas dentro de uma moldura de 124pt
     de altura e uma página A4 de largura. Com três, um período de trinta
     dias dá noventa barras e nenhuma delas é legível. */
  const validas = bruto.filter((s): s is SerieDoGrafico =>
    SERIES_VALIDAS.includes(s as SerieDoGrafico),
  );

  return validas.length > 0 ? validas.slice(0, 2) : ["spend"];
}

/** `TrendPoint` guarda dinheiro em REAIS, não centavos. */
function valorDaSerie(ponto: ReportPayload["trend"][number], s: SerieDoGrafico) {
  return s === "spend"
    ? ponto.spend
    : s === "revenue"
      ? ponto.revenue
      : s === "cpa"
        ? ponto.cpa
        : ponto.results;
}

function formatarSerie(valor: number, s: SerieDoGrafico): string {
  return s === "results"
    ? formatNumber(Math.round(valor))
    : formatCurrency(Math.round(valor * 100));
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
            {/* "—" e não "R$ 0,00": sem conversão não há custo por
                conversão, e zero aqui lê como "saiu de graça". Mesma
                régua da grade de KPIs, que já acertava. */}
            {row.cpaIndefinido ? "—" : formatCurrency(row.cpa)} por resultado
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
        <Cartao key={ad.id} ad={ad} payload={payload} />
      ))}
    </View>
  );
}

/**
 * As três colunas ao lado de "Investido", conforme o que a campanha compra.
 *
 * O card antigo era um só para tudo: Resultados, Custo/result. e CTR.
 * Numa campanha de venda isso esconde o que o cliente quer saber — se
 * voltou dinheiro —, e numa campanha de perfil "Resultados" é um número
 * sem nome, porque o que ela entrega é visita.
 *
 * ⚠️ SEGUIDORES E CUSTO POR SEGUIDOR NÃO ENTRAM, e não é omissão.
 * Medido em 19/08/2026 sobre 40 contas e 3.437 anúncios: nenhum dos 75
 * `action_type` e nenhum dos 20 `results[].indicator` menciona
 * seguidor, e a própria Graph API recusa `follows`,
 * `instagram_follows` e `profile_visits` como campo do Insights
 * (erro #100). Seguidor só existe na API ORGÂNICA do Instagram, no
 * nível da conta — não dá para atribuir a um anúncio, e portanto não
 * dá para dividir o investimento por ele. "Custo por visita ao perfil"
 * ocupa esse lugar: é a mesma pergunta sobre o dado que existe.
 */
function colunasDoCriativo(ad: ReportPayload["creatives"][number]) {
  if (ad.vitrine === "venda") {
    /* Ticket médio pela RECEITA sobre as vendas do próprio anúncio.
       Sem venda não há média: "—" em vez de divisão por zero. */
    const ticket = ad.results > 0 ? ad.revenueCents / ad.results : 0;
    const roas = ad.spendCents > 0 ? ad.revenueCents / ad.spendCents : 0;

    return [
      { rotulo: "Vendas", valor: formatNumber(ad.results) },
      {
        rotulo: "Ticket médio",
        valor: ticket > 0 ? formatCurrency(ticket) : "—",
      },
      /* `formatMultiplier`, não `toFixed`: o documento inteiro usa
         vírgula decimal, e "15.71x" no meio de "R$ 197,01" denuncia
         número montado à mão. */
      { rotulo: "ROAS", valor: roas > 0 ? formatMultiplier(roas) : "—" },
    ];
  }

  if (ad.vitrine === "perfil") {
    const custo =
      ad.profileVisits > 0 ? ad.spendCents / ad.profileVisits : 0;

    return [
      { rotulo: "Visitas ao perfil", valor: formatNumber(ad.profileVisits) },
      {
        rotulo: "Custo/visita",
        valor: custo > 0 ? formatCurrency(custo) : "—",
      },
      { rotulo: "CTR", valor: formatPercent(ad.ctr, 2) },
    ];
  }

  return [
    { rotulo: "Resultados", valor: formatNumber(ad.results) },
    {
      rotulo: "Custo/result.",
      valor: ad.cpaCents > 0 ? formatCurrency(ad.cpaCents) : "—",
    },
    { rotulo: "CTR", valor: formatPercent(ad.ctr, 2) },
  ];
}

function Cartao({
  ad,
  payload,
}: {
  ad: ReportPayload["creatives"][number];
  payload: ReportPayload;
}) {
  /* Limpa e ENTÃO corta. Cortar primeiro gastaria parte do limite com
     emoji que sairia — e o corte pode cair no meio de um par de
     substitutos, que é justamente o que produz lixo.

     110 e não 190: o cartão encolheu, e quatro linhas de copy sob uma
     miniatura de 46px desequilibram o bloco. O que o cliente precisa
     reconhecer é a ABERTURA do anúncio — ele já viu a peça. */
  const copy = copyDoAnuncio(ad.primaryText, 110);

  return (
    <View style={styles.adCard} wrap={false}>
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
            {/* O OBJETIVO SEMPRE À VISTA. Aqui havia
                `platformLabel · campaignName`, e o nome da campanha é
                nulo nos 461 criativos ativos do banco — medido em
                24/08/2026. Todo cartão dizia "META ADS · —".

                O objetivo responde o que o traço não respondia: por que
                este anúncio entregou visita e não venda. Quando o nome
                da campanha existir, ele volta a acompanhar. */}
            <View style={styles.adTopo}>
              <Text style={styles.adPlatform}>
                {ad.platformLabel}
                {ad.campaignName
                  ? ` · ${semEmoji(ad.campaignName)}`
                  : ""}
              </Text>

              {ad.objetivo && (
                <Text
                  style={[
                    styles.adObjetivo,
                    { backgroundColor: payload.meta.accent },
                  ]}
                >
                  {ad.objetivo}
                </Text>
              )}
            </View>
            <Text style={styles.adHeadline}>
              {semEmoji(ad.headline ?? ad.adName ?? "") || "—"}
            </Text>
            {copy && <Text style={styles.adCopy}>{copy}</Text>}

            <View style={styles.adMetrics}>
              <View>
                <Text style={styles.adMetricLabel}>Investido</Text>
                <Text style={styles.adMetricValue}>
                  {formatCurrency(ad.spendCents)}
                </Text>
              </View>
              {colunasDoCriativo(ad).map((coluna) => (
                <View key={coluna.rotulo}>
                  <Text style={styles.adMetricLabel}>{coluna.rotulo}</Text>
                  <Text style={styles.adMetricValue}>{coluna.valor}</Text>
                </View>
              ))}
            </View>
      </View>
    </View>
  );
}

/** Corta no limite de palavra — corte no meio da palavra parece defeito. */

export { payloadHeadline };
