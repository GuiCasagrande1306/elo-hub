/* eslint-disable @next/next/no-img-element */
import { PrintWeeklyChart } from "./print-chart";
import type { PrintReportData } from "@/lib/reports/print-data";
import type { resolverAgencia } from "@/lib/reports/payload";
import { previousPeriod, type KpiResult } from "@/lib/metrics/kpi";
import {
  COLUNA_DO_FUNIL,
  ESPACO_ENTRE_COLUNAS,
  LARGURA_DA_FOLHA,
  LARGURA_DO_GRAFICO,
  etapasDoFunil,
} from "@/lib/reports/rolagem";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";

/* =====================================================================
   O relatório em folha contínua
   ---------------------------------------------------------------------
   ⚠️ UM RENDERIZADOR PARA TODAS AS SAÍDAS, e este arquivo existe para
   que continue assim. Hoje são três:

     • o PDF que vai ao cliente (Puppeteer fotografa a rota de render)
     • a folha que a equipe revisa antes de enviar
     • o link público, onde o cliente escolhe as datas

   Enquanto existiram dois desenhos, a revisão aprovava um documento e o
   cliente recebia outro — quatro vezes, com a lista em
   `lib/reports/serie-do-grafico.ts`. Com três saídas o risco triplica, e
   a única defesa barata é não haver segundo lugar onde desenhar.

   NÃO usa os tokens do design system (`bg-background`, `text-foreground`).
   O documento é sempre claro: herdando o tema, um gestor com o sistema
   no escuro geraria um PDF de fundo navy. Só a cor da MARCA DO CLIENTE
   é dinâmica.
   ===================================================================== */

export function FolhaDeRolagem({
  data,
  agency,
}: {
  data: PrintReportData;
  agency: Awaited<ReturnType<typeof resolverAgencia>>;
}) {
  const periodStart = data.period.start;
  const periodEnd = data.period.end;

  const {
    client,
    kpis,
    platformDetail,
    creatives,
    trend,
    grafico,
    totals,
    creativesDoPeriodo,
    totaisMeta,
    totaisMetaAnterior,
    cobertura,
    loja,
  } = data;

  /* Fallback NEUTRO: sem cor do cliente, o documento não deve herdar a
     marca de uma agência. */
  const brand = client.brand_primary ?? agency?.brandPrimary ?? "#4A5568";

  const assinatura = agency
    ? `${agency.name} · Relatório de performance`
    : "Relatório de performance";

  const periodo = formatPeriod(periodStart, periodEnd);
  const anterior = janelaAnterior(periodStart, periodEnd);

  const funil = etapasDoFunil({
    spendCents: totals.spendCents,
    resultados: totals.results,
    totais: totaisMeta,
    impressoes: somaDeKpi(kpis, platformDetail, "impressions"),
    cliques: somaDeKpi(kpis, platformDetail, "clicks"),
  });

  return (
    <>
      <style>{`
        /* A altura é decidida pelo conteúdo e medida pelo Puppeteer —
           ver \`renderWithPuppeteer\`. Declarar \`size\` fixo aqui
           brigaria com a medição e produziria uma segunda página em
           branco no fim. */
        @page { margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* O overlay de desenvolvimento do Next é um elemento fixo no
           canto da tela, e o Puppeteer fotografa o documento inteiro —
           ele sai impresso como uma bolha escura. Escondido só aqui. */
        nextjs-portal { display: none; }
      `}</style>

      <main
        className="mx-auto bg-white font-sans text-[#111827] antialiased"
        style={{ width: LARGURA_DA_FOLHA }}
      >
        {/* ======================= CABEÇALHO ======================= */}
        <header
          className="relative overflow-hidden px-16 pb-14 pt-16 text-white"
          style={{
            background: `linear-gradient(135deg, ${brand} 0%, ${shade(brand, 0.55)} 100%)`,
          }}
        >
          {/* Dois círculos translúcidos: dão profundidade ao bloco sem
              depender de imagem externa, que o Puppeteer teria de
              esperar carregar. */}
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full"
            style={{ background: "rgba(255,255,255,0.10)" }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-32 right-32 size-64 rounded-full"
            style={{ background: "rgba(255,255,255,0.06)" }}
            aria-hidden
          />

          <div className="relative flex items-center gap-5">
            {client.logo_url ? (
              <img
                src={client.logo_url}
                alt=""
                className="size-[68px] shrink-0 rounded-2xl bg-white object-contain p-1.5"
              />
            ) : (
              <span
                className="flex size-[68px] shrink-0 items-center justify-center rounded-2xl text-[22px] font-bold"
                style={{ background: "rgba(255,255,255,0.18)" }}
              >
                {initials(client.name)}
              </span>
            )}

            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] opacity-70">
                Relatório de performance
              </p>
              <h1 className="mt-1 text-[40px] font-bold leading-[1.1] tracking-[-0.025em]">
                {client.name}
              </h1>
            </div>
          </div>

          <p className="relative mt-8 max-w-[760px] text-[15px] leading-relaxed opacity-85">
            Resultados de <strong className="font-semibold">{periodo}</strong>
            {anterior && (
              <>
                , comparados com{" "}
                <strong className="font-semibold">{anterior}</strong>
              </>
            )}
            .
          </p>
        </header>

        <TarjaDaJanela cobertura={cobertura} />

        {/* ========================= NÚMEROS ========================= */}
        <Secao titulo="Os números do período" brand={brand}>
          <div className="grid grid-cols-4 gap-4">
            {kpis.map((k) => (
              <Cartao
                key={k.key}
                rotulo={k.label}
                valor={k.formatted}
                anterior={k.previousFormatted}
                /* `deltaPercent` vem em PONTOS PERCENTUAIS do
                   `computeKpi`; o cartão trabalha em fração. Dividir
                   aqui, no ponto de encontro das duas convenções. */
                delta={
                  k.indefinido || k.deltaPercent === null
                    ? null
                    : k.deltaPercent / 100
                }
                sentimento={k.sentiment}
              />
            ))}

            {/* ⚠️ SÓ APARECEM QUANDO FORAM APURADOS. `totaisMeta` é nulo
                quando a Graph API não respondeu — e imprimir "Alcance 0"
                nesse caso seria repetir o acidente que esta base já
                cometeu, quando o alcance era `impressões × 0,62`. Ver
                `lib/reports/totais-do-periodo.ts`. */}
            {totaisMeta && (
              <>
                <Cartao
                  rotulo="Alcance"
                  valor={formatNumber(totaisMeta.reach)}
                  anterior={
                    totaisMetaAnterior
                      ? formatNumber(totaisMetaAnterior.reach)
                      : null
                  }
                  delta={variacao(
                    totaisMeta.reach,
                    totaisMetaAnterior?.reach,
                  )}
                  sentimento="positive"
                />
                <Cartao
                  rotulo="Frequência"
                  valor={totaisMeta.frequency.toFixed(2).replace(".", ",")}
                  anterior={
                    totaisMetaAnterior
                      ? totaisMetaAnterior.frequency
                          .toFixed(2)
                          .replace(".", ",")
                      : null
                  }
                  delta={variacao(
                    totaisMeta.frequency,
                    totaisMetaAnterior?.frequency,
                  )}
                  /* NEUTRO de propósito: frequência que sobe não é boa
                     nem má sozinha — pode ser fidelização ou saturação,
                     e só o contexto da conta decide. Pintar de verde ou
                     vermelho afirmaria o que o número não diz. */
                  sentimento="neutral"
                />
                <Cartao
                  rotulo="Cliques no link"
                  valor={formatNumber(totaisMeta.linkClicks)}
                  anterior={
                    totaisMetaAnterior
                      ? formatNumber(totaisMetaAnterior.linkClicks)
                      : null
                  }
                  delta={variacao(
                    totaisMeta.linkClicks,
                    totaisMetaAnterior?.linkClicks,
                  )}
                  sentimento="positive"
                />
                <Cartao
                  rotulo="Engajamento"
                  valor={formatNumber(totaisMeta.pageEngagement)}
                  anterior={
                    totaisMetaAnterior
                      ? formatNumber(totaisMetaAnterior.pageEngagement)
                      : null
                  }
                  delta={variacao(
                    totaisMeta.pageEngagement,
                    totaisMetaAnterior?.pageEngagement,
                  )}
                  sentimento="positive"
                />
              </>
            )}
          </div>
        </Secao>

        {/* ====================== LOJA (MAGAZORD) ====================== */}
        {/* ⚠️ SÓ APARECE PARA QUEM TEM LOJA CADASTRADA. `loja` é nulo
            para o resto da carteira, e a seção some inteira — nenhum
            cliente sem integração vê diferença nenhuma no documento. */}
        {loja && (
          <Secao titulo="A loja no período" brand={brand}>
            {/* ⚠️ O FATURAMENTO MORA AQUI, e não nos cartões do topo.
                `HERO_METRICS` do relatório é investimento, resultados e
                custo por resultado — receita nunca esteve lá. Uma
                tentativa de enxugar esta seção "porque o número já
                aparece acima" deixou o documento SEM faturamento
                nenhum, com a nota de rodapé falando de um valor que
                não existia na página. */}
            <div className="grid grid-cols-4 gap-4">
              <Cartao
                rotulo="Faturamento da loja"
                valor={formatCurrency(loja.receitaCents)}
                anterior={null}
                delta={null}
                sentimento="positive"
              />
              <Cartao
                rotulo="Pedidos pagos"
                valor={formatNumber(loja.pedidosPagos)}
                anterior={null}
                delta={null}
                sentimento="positive"
              />
              <Cartao
                rotulo="Ticket médio"
                /* `null` sem pedido — um traço, nunca "R$ 0,00", que
                   afirmaria que cada venda saiu de graça. */
                valor={
                  loja.ticketMedioCents === null
                    ? "—"
                    : formatCurrency(loja.ticketMedioCents)
                }
                anterior={null}
                delta={null}
                sentimento="positive"
              />
              <Cartao
                /* ⚠️ "RETORNO SOBRE A LOJA", NUNCA "ROAS". ROAS divide a
                   receita ATRIBUÍDA pelo gasto da campanha de origem —
                   mede o anúncio. Este divide a loja INTEIRA pelo
                   investimento total, e inclui orgânico, direto e
                   recorrente. Medido em 22–28/09 no Atacado de Pratas:
                   6,71x aqui contra 16,39x que o pixel reportava. */
                rotulo="Retorno sobre a loja"
                valor={
                  totals.spendCents > 0
                    ? `${(loja.receitaCents / totals.spendCents)
                        .toFixed(1)
                        .replace(".", ",")}x`
                    : "—"
                }
                anterior={null}
                delta={null}
                sentimento="positive"
              />
            </div>

            <p className="mt-4 text-[12px] leading-relaxed text-[#64707d]">
              Faturamento de <strong>todos os canais</strong> da loja — não
              apenas do que veio pelos anúncios. Considera pedidos pagos;
              cancelados e pedidos aguardando pagamento ficam de fora
              {loja.pedidosDescartados > 0 &&
                ` (${formatNumber(loja.pedidosDescartados)} no período)`}
              .
            </p>
          </Secao>
        )}

        {/* ==================== FUNIL + EVOLUÇÃO ==================== */}
        <Secao
          titulo={grafico.titulo ?? "Do investimento ao resultado"}
          brand={brand}
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: `${COLUNA_DO_FUNIL}px ${LARGURA_DO_GRAFICO}px`,
              gap: ESPACO_ENTRE_COLUNAS,
            }}
          >
            <Funil etapas={funil} brand={brand} />

            <div>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8b95a1]">
                Dia a dia
              </p>
              <PrintWeeklyChart
                data={trend}
                color={brand}
                series={grafico.series}
                largura={LARGURA_DO_GRAFICO}
              />
            </div>
          </div>
        </Secao>

        {/* ======================== CAMPANHAS ======================== */}
        {platformDetail.map((p) =>
          p.campaigns.length === 0 ? null : (
            <Secao
              key={p.platform}
              titulo={`Campanhas · ${p.label}`}
              brand={brand}
            >
              <Tabela
                cabecalho={[
                  "Campanha",
                  "Resultado",
                  "Custo por resultado",
                  "Investido",
                ]}
                alinhamento={["left", "right", "right", "right"]}
              >
                {p.campaigns.map((c, i) => (
                  <tr
                    key={`${c.name}-${i}`}
                    className={i % 2 === 1 ? "bg-[#fafbfc]" : undefined}
                  >
                    <Td>
                      <span className="font-medium">{c.name}</span>
                    </Td>
                    <Td alinhar="right">
                      {/* O NÚMERO E A UNIDADE JUNTOS. Sem a unidade, "131"
                          de visita ao perfil e "4" de conversa moram na
                          mesma coluna e o cliente compara coisas
                          diferentes. */}
                      {c.results === null ? (
                        <span className="text-[#8b95a1]">—</span>
                      ) : (
                        <>
                          <span className="font-semibold tabular-nums">
                            {formatNumber(c.results)}
                          </span>
                          <span className="ml-1.5 text-[11px] text-[#8b95a1]">
                            {c.objetivo}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td alinhar="right">
                      {c.results === null || c.results === 0 ? (
                        <span className="text-[#8b95a1]">—</span>
                      ) : (
                        formatCurrency(c.cpaCents)
                      )}
                    </Td>
                    <Td alinhar="right">{formatCurrency(c.spendCents)}</Td>
                  </tr>
                ))}
              </Tabela>
            </Secao>
          ),
        )}

        {/* ========================= ANÚNCIOS ========================= */}
        {creatives.length > 0 && (
          <Secao titulo="Anúncios em destaque" brand={brand}>
            {!creativesDoPeriodo && (
              <p className="mb-4 rounded-lg bg-[#fff8e6] px-4 py-2.5 text-[12px] text-[#7a5c00]">
                Os números abaixo são da última sincronização, não da janela
                deste relatório — não foi possível apurar o período anúncio a
                anúncio.
              </p>
            )}

            <Tabela
              cabecalho={[
                "Anúncio",
                "Resultados",
                "Investido",
                "CTR",
                "CPC",
                "CPM",
                "Impressões",
                "Cliques",
              ]}
              alinhamento={[
                "left",
                "right",
                "right",
                "right",
                "right",
                "right",
                "right",
                "right",
              ]}
            >
              {creatives.map((c, i) => {
                const d = derivadas(c);
                return (
                  <tr
                    key={c.id}
                    className={i % 2 === 1 ? "bg-[#fafbfc]" : undefined}
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        {/* ⚠️ A MINIATURA PODE FALHAR, e o desenho não pode
                            depender dela. `thumbnail_url` aponta para um
                            endereço da Meta que EXPIRA — medido em
                            26/09/2026, 951 de 951 criativos ainda sem
                            cópia no Storage. O quadrado cinza abaixo é o
                            que aparece quando a imagem morre, e mantém a
                            altura da linha estável. */}
                        <span className="flex size-[46px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#eef1f4]">
                          {c.storage_path || c.thumbnail_url ? (
                            <img
                              src={c.storage_path ?? c.thumbnail_url ?? ""}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {c.ad_name ?? "Anúncio"}
                          </span>
                          {c.campaign_name && (
                            <span className="block truncate text-[11px] text-[#8b95a1]">
                              {c.campaign_name}
                            </span>
                          )}
                        </span>
                      </div>
                    </Td>
                    <Td alinhar="right">
                      <span className="font-semibold tabular-nums">
                        {formatNumber(c.conversions)}
                      </span>
                    </Td>
                    <Td alinhar="right">{formatCurrency(c.spend_cents)}</Td>
                    <Td alinhar="right">{d.ctr}</Td>
                    <Td alinhar="right">{d.cpc}</Td>
                    <Td alinhar="right">{d.cpm}</Td>
                    <Td alinhar="right">{formatNumber(c.impressions)}</Td>
                    <Td alinhar="right">{formatNumber(c.clicks)}</Td>
                  </tr>
                );
              })}
            </Tabela>
          </Secao>
        )}

        {/* ========================== RODAPÉ ========================== */}
        <footer className="mt-4 flex items-center justify-between border-t border-[#e6e8ec] px-16 py-8 text-[12px] text-[#8b95a1]">
          <span>{assinatura}</span>
          <span>{periodo}</span>
        </footer>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

/**
 * O aviso de que a janela não está coberta pelo dado.
 *
 * ⚠️ ANTES DOS NÚMEROS, não no rodapé: quem lê decide o que achar da
 * conta nos primeiros segundos, e uma ressalva que chega depois disso
 * chega tarde.
 *
 * TRÊS CASOS E UM SILÊNCIO, e o silêncio é a parte importante:
 *
 *   sem dado + coleta atrasada   "não foi possível apurar"
 *   sem dado + coleta em dia     "não houve veiculação" — é verdade
 *   buraco + coleta atrasada     "incompleto, medimos até tal dia"
 *   buraco + coleta EM DIA       nada
 *
 * O último é o que não pode virar tarja. Buraco com a coleta em dia
 * significa que a conta não anunciou naqueles dias — conta pausada no
 * fim de semana é o caso comum. Avisar ali seria alarme falso semanal,
 * e alarme falso repetido é exatamente como um aviso de verdade passa
 * a ser ignorado. A mesma regra está em `janela-coberta.ts`, que
 * escolheu não barrar o envio nesse caso pelo mesmo motivo.
 *
 * O TOM MUDA COM A CULPA. "Não houve veiculação" é fato da conta e sai
 * em cinza; "não foi possível apurar" é falha nossa e sai em âmbar —
 * pintar as duas de alerta faria o cliente cobrar explicação por uma
 * semana em que ele mesmo pediu para pausar.
 */
function TarjaDaJanela({ cobertura }: { cobertura: PrintReportData["cobertura"] }) {
  const { semDado, naoApurada, coletaAtrasada, ultimoDiaComDado } = cobertura;

  if (semDado) {
    return coletaAtrasada ? (
      <Tarja tom="atencao">
        Não foi possível apurar este período. Os dados ainda não chegaram
        até aqui — assim que a medição for retomada, este relatório passa
        a mostrá-los.
      </Tarja>
    ) : (
      <Tarja tom="neutro">
        Não houve veiculação de anúncios neste período.
      </Tarja>
    );
  }

  if (naoApurada) {
    return (
      <Tarja tom="atencao">
        Os números abaixo estão incompletos
        {ultimoDiaComDado
          ? `: a medição vai até ${diaCurto(ultimoDiaComDado)}`
          : ""}
        . Os dias seguintes ainda não foram apurados, então o período
        cobre menos dias do que o intervalo escolhido.
      </Tarja>
    );
  }

  return null;
}

function Tarja({
  tom,
  children,
}: {
  tom: "atencao" | "neutro";
  children: React.ReactNode;
}) {
  const cor =
    tom === "atencao"
      ? { fundo: "#fff8e6", texto: "#7a5c00", borda: "#f0dfae" }
      : { fundo: "#f4f6f8", texto: "#64707d", borda: "#e6e8ec" };

  return (
    <div className="px-16 pt-10">
      <p
        className="rounded-xl border px-5 py-3.5 text-[13px] leading-relaxed"
        style={{
          background: cor.fundo,
          color: cor.texto,
          borderColor: cor.borda,
        }}
      >
        {children}
      </p>
    </div>
  );
}

/** "18/09" a partir de YYYY-MM-DD. */
function diaCurto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function Secao({
  titulo,
  brand,
  children,
}: {
  titulo: string;
  brand: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-16 pt-12">
      <div className="mb-6 flex items-center gap-3">
        {/* Barrinha na cor da marca: separa as seções sem uma linha
            horizontal atravessando a folha inteira a cada bloco. */}
        <span
          className="h-5 w-1 rounded-full"
          style={{ background: brand }}
          aria-hidden
        />
        <h2 className="text-[21px] font-bold tracking-[-0.02em]">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Cartao({
  rotulo,
  valor,
  anterior,
  delta,
  sentimento,
}: {
  rotulo: string;
  valor: string;
  anterior: string | null;
  /** `null` = sem base de comparação. Mostra o número sem seta. */
  delta: number | null;
  sentimento: "positive" | "negative" | "neutral";
}) {
  /* A COR SAI DO SENTIDO, não do sinal. Custo por resultado que CAI é
     notícia boa e sobe em verde se a gente pintar pelo sinal — por isso
     quem decide é `sentiment`, já resolvido por `betterWhen`. */
  const subiu = (delta ?? 0) > 0;
  const bom =
    sentimento === "neutral"
      ? null
      : (sentimento === "positive") === subiu || delta === 0;

  /* ⚠️ QUEDA É CINZA, igual ao PDF — ver `Selo` em `pdf/folha.tsx`, que
     carrega o porquê. Esta folha é a que o CLIENTE abre pelo link
     público, então aqui o vermelho fazia ainda mais estrago: ninguém
     da agência está junto para explicar. Queda e estabilidade dividem
     o mesmo cinza; a seta e o número é que as separam.

     As duas superfícies mudam no mesmo commit de propósito. Pintar
     diferente o mesmo relatório em dois lugares é como nasce o "mas no
     PDF estava vermelho". */
  const cor = bom === true ? "#1f7a4d" : "#64707d";
  const fundo = bom === true ? "#e8f5ee" : "#f1f3f5";

  return (
    <div className="rounded-xl border border-[#e6e8ec] bg-white p-4">
      <p className="truncate text-[12px] font-medium text-[#64707d]">
        {rotulo}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums">
          {valor}
        </span>
        {delta !== null && delta !== undefined && (
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ color: cor, background: fundo }}
          >
            {subiu ? "▲" : delta < 0 ? "▼" : "•"}{" "}
            {formatPercent(Math.abs(delta))}
          </span>
        )}
      </div>
      {anterior && (
        <p className="mt-1.5 text-[11px] text-[#8b95a1]">
          <span className="tabular-nums">{anterior}</span> no período anterior
        </p>
      )}
    </div>
  );
}

/**
 * O funil.
 *
 * Cada faixa é um trapézio desenhado por `clip-path`, e a largura cai
 * proporcionalmente à posição — NÃO ao valor. Proporcional ao valor, um
 * funil com 43 mil impressões e 9 conversas faria a última faixa medir
 * meio pixel e sumir, que é justamente a etapa que interessa.
 *
 * A porcentagem à direita é a passagem de uma etapa para a seguinte, e
 * só aparece entre etapas que se comparam: de impressão para clique faz
 * sentido, de reais para impressão não.
 */
function Funil({
  etapas,
  brand,
}: {
  etapas: { rotulo: string; valor: string; taxa: number | null }[];
  brand: string;
}) {
  const total = etapas.length;

  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8b95a1]">
        Funil
      </p>

      <div className="flex flex-col items-center gap-1.5">
        {etapas.map((e, i) => {
          /* De 100% a 52% da largura, em passos iguais. O corte do
             trapézio é de 22px de cada lado — constante, para as faixas
             ficarem paralelas em vez de abrir conforme estreitam. */
          const largura = 100 - (i / Math.max(total - 1, 1)) * 48;

          return (
            <div key={e.rotulo} className="w-full">
              <div
                className="relative mx-auto flex h-[58px] items-center justify-center text-center"
                style={{
                  width: `${largura}%`,
                  background: `linear-gradient(135deg, ${brand} 0%, ${shade(brand, 0.35)} 100%)`,
                  /* Opacidade crescente: as etapas de baixo são as que
                     importam, e ficam mais sólidas. */
                  opacity: 0.45 + (i / Math.max(total - 1, 1)) * 0.55,
                  clipPath:
                    "polygon(0 0, 100% 0, calc(100% - 22px) 100%, 22px 100%)",
                }}
              >
                <div className="px-6 text-white">
                  <p className="text-[11px] font-medium leading-none opacity-90">
                    {e.rotulo}
                  </p>
                  <p className="mt-1 text-[17px] font-bold leading-none tabular-nums">
                    {e.valor}
                  </p>
                </div>
              </div>

              {e.taxa !== null && i < total - 1 && (
                <p className="mt-1 text-center text-[10px] font-medium text-[#8b95a1] tabular-nums">
                  {formatPercent(e.taxa)} seguem para a próxima etapa
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tabela({
  cabecalho,
  alinhamento,
  children,
}: {
  cabecalho: string[];
  alinhamento: ("left" | "right")[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6e8ec]">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#f7f8fa]">
            {cabecalho.map((h, i) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64707d]"
                style={{ textAlign: alinhamento[i] ?? "left" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  alinhar = "left",
}: {
  children: React.ReactNode;
  alinhar?: "left" | "right";
}) {
  return (
    <td
      className="border-t border-[#eef1f4] px-4 py-3 align-middle tabular-nums"
      style={{ textAlign: alinhar }}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

/**
 * CTR, CPC e CPM de um anúncio.
 *
 * Derivadas aqui porque `ad_creatives` guarda os quatro números brutos e
 * não as razões. Todas as divisões são guardadas: um anúncio sem clique
 * produziria `Infinity` no CPC, e `formatCurrency(Infinity)` imprime
 * "R$ NaN" no documento do cliente.
 */
function derivadas(c: {
  spend_cents: number;
  impressions: number;
  clicks: number;
}): { ctr: string; cpc: string; cpm: string } {
  return {
    // Fração, não porcentagem: `formatPercent` multiplica por 100.
    ctr: c.impressions > 0 ? formatPercent(c.clicks / c.impressions) : "—",
    cpc: c.clicks > 0 ? formatCurrency(Math.round(c.spend_cents / c.clicks)) : "—",
    cpm:
      c.impressions > 0
        ? formatCurrency(Math.round((c.spend_cents / c.impressions) * 1000))
        : "—",
  };
}

/**
 * Variação entre dois números, como FRAÇÃO (0,12 = +12%).
 *
 * Fração porque é o que `formatPercent` espera — ver a nota em
 * `EtapaDoFunil.taxa`, onde a confusão de unidade já imprimiu um número
 * cem vezes maior.
 *
 * `null` quando não há base — e não zero. Sem período anterior, "0%"
 * afirmaria estabilidade onde não há comparação nenhuma.
 */
function variacao(atual: number, anterior: number | undefined): number | null {
  if (anterior === undefined || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

/**
 * O total de uma métrica somando as plataformas.
 *
 * O funil precisa de impressões e cliques, que não estão entre os KPIs
 * do topo (aqueles são investimento, resultado e custo). Sai de
 * `platformDetail`, que é a MESMA apuração — em vez de somar
 * `daily_metrics` de novo aqui e arriscar um número que diverge do
 * quadro logo acima.
 */
function somaDeKpi(
  kpis: KpiResult[],
  detalhe: { kpis: KpiResult[] }[],
  chave: string,
): number {
  const noTopo = kpis.find((k) => k.key === chave);
  if (noTopo) return noTopo.value;

  return detalhe.reduce(
    (acc, p) => acc + (p.kpis.find((k) => k.key === chave)?.value ?? 0),
    0,
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

/** Escurece o hex da marca para o gradiente. */
function shade(hex: string, amount = 0.45): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#0d1826";

  const mix = (c: number) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);

  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A janela anterior por extenso, para a frase do cabeçalho.
 *
 * Usa `previousPeriod`, a MESMA função que calculou os números de
 * comparação — escrever "os 7 dias anteriores" à mão diria uma coisa
 * enquanto as setas comparariam outra.
 */
function janelaAnterior(inicio: string, fim: string): string | null {
  const p = previousPeriod(inicio, fim);
  return p ? formatPeriod(p.start, p.end) : null;
}
