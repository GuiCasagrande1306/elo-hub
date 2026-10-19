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

import {
  ALTURA,
  LARGURA_DA_FOLHA,
  LARGURA_UTIL,
  MARGEM_LATERAL,
  planoDoRelatorio,
  truncar,
  type Bloco,
  type BlocoCompilado,
  type BlocoPlataforma,
  graficoEmBlocoProprio,
} from "./plano";
import { escalaDoGrafico } from "../escala-do-grafico";
import { formatarSerie } from "../serie-do-grafico";
import { copyDoAnuncio, semEmoji } from "./texto-seguro";
import type { ReportPayload } from "@/lib/reports/payload";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   A folha contínua do relatório
   ---------------------------------------------------------------------
   UMA PÁGINA de 1080 de largura e altura calculada, no formato do
   Reportei (medido no PDF de referência: 1080 × 3081 pt, uma página).

   ⚠️ NÃO EXISTE PAGINAÇÃO AQUI, e é essa a diferença que resolve a
   queixa original. A versão A4 terminava cada página onde o conteúdo
   acabasse, deixando um palmo de branco no fim — porque a folha tinha
   tamanho fixo e o conteúdo não. Aqui a folha tem o tamanho do
   conteúdo: sobra zero por construção.

   ⚠️ A ALTURA VEM DO PLANO, NUNCA DAQUI. Cada bloco recebe `height`
   com o número que `plano.ts` somou. Desenhar mais alto que o planejado
   empurraria o resto para fora da página; desenhar mais baixo deixaria
   o branco de volta. Por isso nenhum bloco deste arquivo calcula a
   própria altura — ele a recebe.

   ⚠️ SEM PUPPETEER. O Chromium na função serverless falhou duas vezes
   e o plano B vinha carregando todos os relatórios em silêncio. Este
   arquivo entrega o mesmo formato sem navegador nenhum.
   ===================================================================== */

const DIR_FONTES = join(process.cwd(), "src/assets/fonts");

Font.register({
  family: "Geist",
  fonts: [
    { src: join(DIR_FONTES, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: join(DIR_FONTES, "Geist-Bold.ttf"), fontWeight: 700 },
  ],
});

/* O hifenizador do react-pdf quebra palavra no meio sem hífen visível,
   e em português produz "investi mento". Desligado. */
Font.registerHyphenationCallback((palavra) => [palavra]);

const TINTA = "#16181D";
const TINTA_FRACA = "#6B7280";
const FIO = "#E8E6E1";
/* ⚠️ O FUNDO NÃO É BRANCO PURO, e é o único "enfeite" da folha. Um
   creme quase imperceptível atrás de cartões brancos cria profundidade
   sem pôr nenhum elemento decorativo disputando atenção com o número —
   que era exatamente o pedido. É o mesmo recurso do Reportei. */
const FUNDO = "#F6F5F2";
const BRANCO = "#FFFFFF";
const POSITIVO = "#15803D";
const POSITIVO_FUNDO = "#DCFCE7";
/* ⚠️ NÃO EXISTE COR DE NEGATIVO AQUI, e a ausência é decisão de
   05/10/2026 — ver `Selo`. Havia um vinho `#9F1239` sobre `#FFE4E6`.
   Acrescentar um vermelho de volta devolve o problema inteiro. */

const s = StyleSheet.create({
  pagina: { backgroundColor: FUNDO, fontFamily: "Geist", color: TINTA },

  cartao: {
    marginHorizontal: MARGEM_LATERAL,
    backgroundColor: BRANCO,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FIO,
    overflow: "hidden",
  },
  filete: { height: ALTURA.filete, width: "100%" },
  recheio: { paddingHorizontal: 32, paddingVertical: 32 },

  tituloDeBloco: {
    height: ALTURA.tituloDeBloco,
    textAlign: "center",
    fontSize: 13,
    fontWeight: 700,
    paddingTop: 18,
  },

  compiladoRotulo: {
    fontSize: 10,
    fontWeight: 700,
    color: TINTA_FRACA,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  compiladoValor: { fontSize: 29, fontWeight: 700 },
  compiladoApoio: { fontSize: 8.5, color: TINTA_FRACA, marginTop: 6 },

  kpiRotulo: { fontSize: 10, color: TINTA, textAlign: "center", fontWeight: 700 },
  kpiValor: { fontSize: 22, fontWeight: 700, textAlign: "center" },
  kpiAnterior: { fontSize: 8.5, color: TINTA_FRACA, textAlign: "center", marginTop: 4 },

  selo: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    fontSize: 8,
    fontWeight: 700,
  },

  celula: { fontSize: 8.5, paddingHorizontal: 8, paddingVertical: 6 },
  rotuloDoEixo: { fontSize: 7.5, color: TINTA_FRACA },
  celulaCabecalho: {
    fontSize: 8,
    fontWeight: 700,
    color: TINTA_FRACA,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});

/* ------------------------------------------------------------------ */

export function FolhaDoRelatorio({ payload }: { payload: ReportPayload }) {
  const plano = planoDoRelatorio(payload);
  const acento = payload.meta.accent;

  return (
    <Document
      title={`Relatório · ${payload.client.name}`}
      author={payload.agency?.name ?? "Elo Marketing"}
    >
      {/* A ALTURA SAI DO PLANO. Ver o cabeçalho deste arquivo. */}
      <Page size={[LARGURA_DA_FOLHA, plano.altura]} style={s.pagina}>
        {plano.blocos.map((bloco, i) => (
          <View
            key={`${bloco.tipo}-${i}`}
            style={{
              height: bloco.altura,
              marginBottom: i < plano.blocos.length - 1 ? ALTURA.respiro : 0,
            }}
          >
            <Desenho bloco={bloco} payload={payload} acento={acento} />
          </View>
        ))}
      </Page>
    </Document>
  );
}

function Desenho({
  bloco,
  payload,
  acento,
}: {
  bloco: Bloco;
  payload: ReportPayload;
  acento: string;
}) {
  if (bloco.tipo === "capa") return <Capa payload={payload} />;
  if (bloco.tipo === "compilado")
    return <CartaoDoCompilado bloco={bloco} acento={acento} />;
  if (bloco.tipo === "anuncios")
    return <CartaoDeAnuncios bloco={bloco} acento={acento} />;
  return <CartaoDePlataforma bloco={bloco} payload={payload} acento={acento} />;
}

/* ============================== CAPA ============================== */

/**
 * Centrada, como a do Reportei.
 *
 * ⚠️ SEM KPI NENHUM AQUI. A versão anterior abria com "LEADS 22" e três
 * cartões, um deles o CTR — e CTR na abertura diz ao cliente que taxa
 * de clique é o resultado do trabalho, quando é diagnóstico interno. A
 * capa apresenta o documento; os números vivem no cartão da plataforma
 * a que pertencem.
 */
function Capa({ payload }: { payload: ReportPayload }) {
  const { client, meta } = payload;
  const periodo = formatPeriod(meta.periodStart, meta.periodEnd);

  return (
    <View style={{ height: ALTURA.capa, justifyContent: "center", alignItems: "center", paddingHorizontal: 120 }}>
      {client.logoUrl ? (
        // `Image` é do react-pdf, não do HTML: não aceita `alt`.
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image
          src={client.logoUrl}
          style={{ width: 96, height: 96, borderRadius: 48, objectFit: "contain" }}
        />
      ) : (
        <View
          style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: meta.accent,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 34, fontWeight: 700, color: BRANCO }}>
            {client.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}

      <Text style={{ fontSize: 30, fontWeight: 700, marginTop: 26, textAlign: "center" }}>
        Relatório de {semEmoji(client.name)}
      </Text>
      <Text style={{ fontSize: 15, color: TINTA_FRACA, marginTop: 8 }}>
        Análise de desempenho
      </Text>

      <Text style={{ fontSize: 10.5, textAlign: "center", marginTop: 26, lineHeight: 1.5 }}>
        Relatório gerado dos dados analisados em {periodo}
        {meta.days > 0 && `, comparado com os ${meta.days} dias imediatamente anteriores`}.
      </Text>
    </View>
  );
}

/* ========================== COMPILADO ============================= */

/**
 * O primeiro cartão: três números e a origem de cada um.
 *
 * ⚠️ ALINHADO À ESQUERDA, ao contrário dos KPIs do cartão de
 * plataforma, que são centrados. Não é inconsistência: aqui cada
 * coluna tem um terço da folha e carrega uma linha de procedência
 * embaixo do valor. Centrado, o texto miúdo flutua longe do número a
 * que pertence e a coluna deixa de ler como uma coisa só.
 */
function CartaoDoCompilado({
  bloco,
  acento,
}: {
  bloco: BlocoCompilado;
  acento: string;
}) {
  const colunas = bloco.itens.length;

  return (
    <View style={[s.cartao, { height: bloco.altura }]}>
      <View style={[s.filete, { backgroundColor: acento }]} />

      <View style={s.recheio}>
        <View style={{ height: ALTURA.cabecalhoDoCompilado }}>
          <Text style={{ fontSize: 15, fontWeight: 700 }}>Resumo do período</Text>
        </View>

        <View
          style={{
            height: ALTURA.fileiraDoCompilado,
            flexDirection: "row",
            alignItems: "flex-start",
          }}
        >
          {bloco.itens.map(({ kpi, fonte }) => (
            <View key={kpi.key} style={{ width: LARGURA_UTIL / colunas - 12 }}>
              <Text style={s.compiladoRotulo}>{kpi.label}</Text>

              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 11 }}>
                <Text style={s.compiladoValor}>{kpi.formatted}</Text>
                <Selo kpi={kpi} />
              </View>

              {kpi.previousFormatted !== "" && (
                <Text style={s.compiladoApoio}>
                  {kpi.previousFormatted} no período anterior
                </Text>
              )}

              {/* A PROCEDÊNCIA DO NÚMERO, quando existe mais de uma
                  resposta possível. Ver `ItemDoCompilado.fonte`. */}
              {fonte !== null && (
                <Text style={[s.compiladoApoio, { color: acento }]}>{fonte}</Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ========================= PLATAFORMA ============================= */

function CartaoDePlataforma({
  bloco,
  payload,
  acento,
}: {
  bloco: BlocoPlataforma;
  payload: ReportPayload;
  acento: string;
}) {
  const detalhe = payload.platformDetail[bloco.indice];
  const cor = corDaPlataforma(detalhe.platform, acento);

  return (
    <View style={[s.cartao, { height: bloco.altura }]}>
      <View style={[s.filete, { backgroundColor: cor }]} />

      <View style={s.recheio}>
        {/* ---- cabeçalho ---- */}
        <View style={{ height: ALTURA.cabecalhoDaPlataforma - 32 }}>
          <Text style={{ fontSize: 15, fontWeight: 700 }}>{detalhe.label}</Text>
          <Text style={{ fontSize: 9, color: TINTA_FRACA, marginTop: 3 }}>
            {semEmoji(payload.client.name)} · {formatPercent(detalhe.spendShare)} do investimento
          </Text>
        </View>

        {/* ---- fileiras de KPI ---- */}
        {bloco.fileiras.map((fileira, i) => (
          <View
            key={i}
            style={{ height: ALTURA.fileiraDeKpi, flexDirection: "row", alignItems: "flex-start" }}
          >
            {fileira.map((k) => (
              <View key={k.key} style={{ width: LARGURA_UTIL / 4 - 16, paddingTop: 16 }}>
                <Text style={s.kpiRotulo}>{k.label}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8 }}>
                  <Text style={s.kpiValor}>{k.formatted}</Text>
                  <Selo kpi={k} />
                </View>
                {k.previousFormatted && (
                  <Text style={s.kpiAnterior}>
                    {k.previousFormatted} no período anterior
                  </Text>
                )}
              </View>
            ))}

            {/* ⚠️ O GRÁFICO ENTRA NO VAZIO DA SEGUNDA FILEIRA, e é por
                isso que ele não soma altura quando ela existe — ver
                `alturaDaPlataforma` em plano.ts. Sem isto, o espaço à
                direita de dois ou três KPIs ficaria em branco, que é a
                queixa que originou este trabalho. */}
            {bloco.temGrafico && !graficoEmBlocoProprio(bloco.fileiras) && i === bloco.fileiras.length - 1 && (
              <View style={{ flex: 1, paddingLeft: 16 }}>
                <GraficoDeLinha payload={payload} cor={cor} altura={ALTURA.fileiraDeKpi - 16} />
              </View>
            )}
          </View>
        ))}

        {/* Gráfico em bloco próprio só quando há uma fileira cheia. */}
        {bloco.temGrafico && graficoEmBlocoProprio(bloco.fileiras) && (
          <View style={{ height: ALTURA.grafico }}>
            <Text style={s.tituloDeBloco}>Investimento por dia</Text>
            <GraficoDeLinha payload={payload} cor={cor} altura={ALTURA.grafico - ALTURA.tituloDeBloco} />
          </View>
        )}

        {/* ---- funil ---- */}
        {bloco.funil.length > 0 && (
          <>
            <Text style={s.tituloDeBloco}>Funil</Text>
            {bloco.funil.map((d, i) => {
              /* Largura decrescente: é o funil. Trapézio de verdade
                 exigiria recorte, que o react-pdf não tem — degraus
                 centralizados comunicam a mesma queda sem fingir uma
                 forma que o motor não desenha. */
              const largura = 92 - (i * 56) / Math.max(1, bloco.funil.length);
              return (
                <View
                  key={d.rotulo}
                  style={{
                    height: ALTURA.degrauDoFunil,
                    width: `${largura}%`,
                    alignSelf: "center",
                    backgroundColor: mistura(cor, 0.12 + (i * 0.8) / bloco.funil.length),
                    borderRadius: 6,
                    marginBottom: 6,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 9.5, fontWeight: 700, color: i > 2 ? BRANCO : TINTA }}>
                    {d.rotulo}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: 700, color: i > 2 ? BRANCO : TINTA, marginTop: 2 }}>
                    {d.valor}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        {/* ---- campanhas ---- */}
        {bloco.campanhas.length > 0 && (
          <>
            <Text style={s.tituloDeBloco}>Campanhas em destaque</Text>
            {/* ⚠️ A COLUNA "OBJETIVO" E O SUFIXO DO CUSTO SÃO
                OBRIGATÓRIOS, e esta folha nasceu sem os dois — em
                02/10/2026, quando substituiu a versão A4. Reposto em
                12/10/2026, e vale registrar o que a ausência causava:

                1. SEM OBJETIVO, a coluna de resultado empilha unidades
                   diferentes sem dizer. No demo: 146 (conversões),
                   2.173 (visitas) e 28.435 (impressões) na mesma
                   coluna, com o mesmo título "Resultados". O cliente
                   compara a campanha de reconhecimento com a de venda e
                   conclui que a de venda é 200 vezes pior.

                2. SEM O "/mil", o custo da campanha de alcance MENTE
                   POR MIL. Ali o número é CPM — custo de mil
                   impressões —, porque custo de UMA impressão é fração
                   de centavo e sairia "R$ 0,00". No demo, a linha de
                   reconhecimento imprimia "R$ 27,25" como se fosse o
                   preço de uma impressão. `custoSufixo` existe há
                   meses em `PlatformCampaign` exatamente para isso, e a
                   folha nova simplesmente não o lia. */}
            <Tabela
              colunas={["Campanha", "Objetivo", "Investido", "Resultados", "Custo"]}
              pesos={[2.6, 1.4, 1, 1, 1.3]}
              linhas={bloco.campanhas.slice(0, 6).map((c) => [
                truncar(c.name, 46),
                truncar(c.objetivo, 24),
                formatCurrency(c.spendCents),
                c.results === null ? "—" : formatNumber(c.results),
                /* `custoIndefinido` e não `cpaCents > 0`: a própria
                   linha já decidiu que não há denominador, e refazer a
                   pergunta aqui é como as duas respostas divergem. */
                c.custoIndefinido
                  ? "—"
                  : `${formatCurrency(c.cpaCents)}${c.custoSufixo}`,
              ])}
            />
          </>
        )}
      </View>
    </View>
  );
}

/* ========================== ANÚNCIOS ============================== */

function CartaoDeAnuncios({
  bloco,
  acento,
}: {
  bloco: Extract<Bloco, { tipo: "anuncios" }>;
  acento: string;
}) {
  return (
    <View style={[s.cartao, { height: bloco.altura }]}>
      <View style={[s.filete, { backgroundColor: acento }]} />
      <View style={s.recheio}>
        <Text style={s.tituloDeBloco}>Anúncios em destaque</Text>

        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: FIO, height: ALTURA.cabecalhoDeTabela, alignItems: "center" }}>
          <Text style={[s.celulaCabecalho, { width: 96 }]} />
          <Text style={[s.celulaCabecalho, { flex: 3 }]}>Anúncio</Text>
          <Text style={[s.celulaCabecalho, { flex: 1, textAlign: "right" }]}>Investido</Text>
          <Text style={[s.celulaCabecalho, { flex: 1, textAlign: "right" }]}>Resultados</Text>
          <Text style={[s.celulaCabecalho, { flex: 1.2, textAlign: "right" }]}>Custo</Text>
        </View>

        {bloco.anuncios.map((a) => (
          <View
            key={a.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              height: ALTURA.linhaDeTabelaComFoto,
              borderBottomWidth: 1,
              borderBottomColor: FIO,
            }}
          >
            <View style={{ width: 96, paddingLeft: 8 }}>
              {/* ⚠️ SÓ RASTER. SVG aborta o react-pdf e o relatório
                  inteiro deixa de sair — ver a migration 38. */}
              {a.imageUrl && a.imageIsRaster ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={a.imageUrl} style={{ width: 64, height: 64, borderRadius: 6, objectFit: "cover" }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 6, backgroundColor: FUNDO }} />
              )}
            </View>
            <Text style={[s.celula, { flex: 3 }]}>
              {truncar(copyDoAnuncio(a.primaryText, 90) ?? a.adName ?? "Anúncio", 72)}
            </Text>
            <Text style={[s.celula, { flex: 1, textAlign: "right" }]}>{formatCurrency(a.spendCents)}</Text>
            <Text style={[s.celula, { flex: 1, textAlign: "right" }]}>{formatNumber(a.results)}</Text>
            <Text style={[s.celula, { flex: 1.2, textAlign: "right" }]}>
              {a.cpaCents > 0 ? formatCurrency(a.cpaCents) : "—"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ========================== AUXILIARES ============================= */

/**
 * O selo de variação.
 *
 * ⚠️ QUEDA É CINZA, NÃO VERMELHA. Decisão do Guilherme em 05/10/2026,
 * para o relatório de todas as contas.
 *
 * O vermelho não informava: ele julgava. Numa folha que o cliente abre
 * sozinho, sem ninguém do lado para contextualizar, uma pílula vinho
 * sobre rosa é a primeira coisa que o olho encontra — e ela grita
 * "problema" antes que a pessoa leia de qual métrica se trata. Mês com
 * investimento menor de propósito virava alarme.
 *
 * A INFORMAÇÃO NÃO SE PERDE: continuam o ▼ e o número. O que sai é o
 * peso visual, não o dado. Quem procura a queda acha; quem está
 * passando o olho não é parado por ela.
 *
 * O verde FICA, e a assimetria é o ponto. Vitória se comemora; queda se
 * informa e se explica na conversa, não num aviso vermelho dentro de um
 * PDF que a agência não está presente para acompanhar.
 *
 * CUSTO ACEITO: queda e estabilidade passam a ter o mesmo cinza. O que
 * as separa é a seta e o valor — ▼ 8,58% não se confunde com • 0,00%.
 */
function Selo({ kpi }: { kpi: ReportPayload["kpis"][number] }) {
  if (kpi.indefinido || kpi.deltaPercent === null) return null;

  const sobe = kpi.deltaPercent >= 0;
  const bom = kpi.sentiment === "positive";
  const cor = bom ? POSITIVO : TINTA_FRACA;
  const fundo = bom ? POSITIVO_FUNDO : FUNDO;

  return (
    <Text style={[s.selo, { color: cor, backgroundColor: fundo, marginLeft: 6 }]}>
      {sobe ? "▲" : "▼"} {Math.abs(kpi.deltaPercent).toFixed(2).replace(".", ",")}%
    </Text>
  );
}

/**
 * Linha do investimento diário.
 *
 * Desenhada com barras finas, não com curva: o react-pdf não tem path,
 * e aproximar curva com retângulos rotacionados sai pior do que uma
 * série de barras honesta.
 */
const LARGURA_DO_EIXO = 34;
const ALTURA_DAS_DATAS = 14;

function GraficoDeLinha({
  payload,
  cor,
  altura,
}: {
  payload: ReportPayload;
  cor: string;
  altura: number;
}) {
  const pontos = payload.trend;
  if (pontos.length < 2) return null;

  const valores = pontos.map((p) => p.spend ?? 0);
  const escala = escalaDoGrafico(Math.max(...valores, 1), "dinheiro");
  const alturaDoDesenho = altura - 26 - ALTURA_DAS_DATAS;

  /* As datas não cabem todas: trinta rótulos viram uma tarja cinza, e no
     gráfico encaixado ao lado dos KPIs nem sete cabem. Mesma ideia do
     `interval="preserveStartEnd"` da folha HTML. */
  const passo = Math.ceil(pontos.length / (altura > 150 ? 8 : 4));
  const nivel = (v: number) => alturaDoDesenho * (1 - v / escala.topo);

  return (
    <View style={{ height: altura }}>
      <View style={{ flexDirection: "row", height: alturaDoDesenho }}>
        {/* EIXO DE VALORES, com as mesmas três marcas da folha HTML
            (`escalaDoGrafico`). Sem ele o cliente via a altura das
            colunas e não tinha como saber quanto cada uma valia. */}
        <View style={{ width: LARGURA_DO_EIXO }}>
          {escala.marcas.map((m) => (
            <Text
              key={m}
              style={[s.rotuloDoEixo, { position: "absolute", right: 6, top: nivel(m) - 4.5 }]}
            >
              {formatCurrencyCompact(Math.round(m * 100))}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          {escala.marcas.map((m) => (
            <View
              key={m}
              style={{ position: "absolute", left: 0, right: 0, top: nivel(m), borderTopWidth: 0.5, borderTopColor: FIO }}
            />
          ))}
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: alturaDoDesenho, gap: 1.5 }}>
            {valores.map((v, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: Math.max(2, (v / escala.topo) * alturaDoDesenho),
                  backgroundColor: cor,
                  opacity: 0.85,
                  borderRadius: 1,
                }}
              />
            ))}
          </View>
        </View>
      </View>
      {/* Datas em posição absoluta, centradas na coluna: dentro de uma
          célula do tamanho da barra, "12/10" quebraria em duas linhas. */}
      <View style={{ height: ALTURA_DAS_DATAS, marginLeft: LARGURA_DO_EIXO }}>
        {pontos.map((p, i) =>
          i % passo === 0 ? (
            <Text
              key={p.date}
              style={[
                s.rotuloDoEixo,
                { position: "absolute", top: 4, width: 40, marginLeft: -20, textAlign: "center", left: `${((i + 0.5) / pontos.length) * 100}%` },
              ]}
            >
              {p.date.slice(8, 10)}/{p.date.slice(5, 7)}
            </Text>
          ) : null,
        )}
      </View>
      {/* ⚠️ `formatarSerie`, NÃO `formatCurrency`. `TrendPoint.spend`
          chega em REAIS (`spendCents / 100` em `buildTrend`), e passá-lo
          para `formatCurrency`, que espera centavos, divide por cem de
          novo: o pico de R$ 2.618,05 saía impresso como R$ 26,18. Erro
          silencioso, plausível e dentro do relatório do cliente. */}
      <Text style={{ fontSize: 7.5, color: TINTA_FRACA, marginTop: 8, textAlign: "center" }}>
        Investimento diário · pico de {formatarSerie(Math.max(...valores), "spend")}
      </Text>
    </View>
  );
}

function Tabela({
  colunas,
  pesos,
  linhas,
}: {
  colunas: string[];
  pesos: number[];
  linhas: string[][];
}) {
  return (
    <View>
      <View style={{ flexDirection: "row", height: ALTURA.cabecalhoDeTabela, alignItems: "center", borderBottomWidth: 1, borderBottomColor: FIO }}>
        {colunas.map((c, i) => (
          <Text
            key={c}
            style={[s.celulaCabecalho, { flex: pesos[i], textAlign: i === 0 ? "left" : "right" }]}
          >
            {c}
          </Text>
        ))}
      </View>
      {linhas.map((linha, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", height: ALTURA.linhaDeTabela, alignItems: "center", borderBottomWidth: 1, borderBottomColor: FIO }}
        >
          {linha.map((celula, j) => (
            <Text key={j} style={[s.celula, { flex: pesos[j], textAlign: j === 0 ? "left" : "right" }]}>
              {celula}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Azul no Meta, verde no Google, acento da agência no resto. */
function corDaPlataforma(plataforma: string, acento: string): string {
  if (plataforma === "meta_ads") return "#1877F2";
  if (plataforma === "google_ads") return "#34A853";
  return acento;
}

/** Clareia a cor misturando com branco. `0` = branco, `1` = a cor. */
function mistura(hex: string, peso: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const c = (v: number) => Math.round(255 - (255 - v) * Math.min(1, Math.max(0, peso)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
