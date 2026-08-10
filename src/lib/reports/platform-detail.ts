import {
  computeKpi,
  deriveMetric,
  splitByPlatform,
  sumMetrics,
  type KpiResult,
} from "@/lib/metrics/kpi";
import type { AdCreative, DailyMetric, MetricKey } from "@/types/database";

/* =====================================================================
   Quadro completo por plataforma
   ---------------------------------------------------------------------
   Existe porque `PlatformSplit` responde "quanto do orçamento foi para
   cada canal" — e a pergunta que o cliente faz é outra: "como foi o
   Meta e como foi o Google". Uma linha de participação não responde
   isso; ela esconde que o Google entregou o dobro de resultados com
   metade do investimento.

   ⚠️ MÓDULO COMPARTILHADO, e essa é a razão de ele existir separado.
   Dois renderizadores desenham este relatório: o `react-pdf`
   (`pdf/document.tsx`, o motor padrão) e a página A4 em HTML
   (`/reports/render/[clientId]`, fotografada pelo Puppeteer e agora
   também aberta pela equipe para revisar). Se cada um calculasse o
   próprio quadro, a folha revisada na tela e o arquivo enviado ao
   cliente divergiriam — que é exatamente o defeito que a revisão pegou
   no botão de pré-visualização.

   SEM `server-only`: o cálculo é pura aritmética sobre linhas já
   carregadas, e marcar o módulo como servidor impediria os dois
   chamadores de compartilhá-lo sem cerimônia.
   ===================================================================== */

export interface PlatformCampaign {
  /** Já encurtado — ver `encurtar`. Altura de linha previsível no PDF. */
  name: string;
  spendCents: number;
  results: number;
  cpaCents: number;
  clicks: number;
  ctr: number;
  roas: number;
}

export interface PlatformDetail {
  platform: AdCreative["platform"];
  label: string;
  /** Fatia do investimento total do período. Contexto para o resto. */
  spendShare: number;
  /** Um KPI por métrica com número no período — ver `METRICAS_DA_PLATAFORMA`. */
  kpis: KpiResult[];
  /** Campanhas da plataforma, da que mais gastou para a que menos. */
  campaigns: PlatformCampaign[];
}

/**
 * O quadro completo, na ordem em que se lê um relatório de mídia:
 * quanto entrou, quanto apareceu, quanto engajou, quanto custou, quanto
 * voltou.
 *
 * Todas saem de `deriveMetric` sobre os mesmos totais do dashboard —
 * nenhuma conta nova mora aqui. `leads`/`cpl` ficam de fora por serem
 * apelidos de `results`/`cpa`: repetir o mesmo número com dois nomes no
 * mesmo quadro faz o cliente procurar a diferença que não existe.
 */
const METRICAS_DA_PLATAFORMA: MetricKey[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "results",
  "cpa",
  "revenue",
  "roas",
  "aov",
];

/**
 * Métricas que não valem espaço para esta plataforma neste período.
 *
 * Conta de geração de leads não tem receita: `revenue`, `roas` e `aov`
 * sairiam como "R$ 0,00" e "0,00x" — três cartões dizendo nada, num
 * documento que vai para o cliente. Some quando o número é zero NOS
 * DOIS períodos; se caiu para zero, isso é notícia e fica.
 */
function metricasComNumero(
  atual: ReturnType<typeof sumMetrics>,
  anterior: ReturnType<typeof sumMetrics>,
): MetricKey[] {
  return METRICAS_DA_PLATAFORMA.filter(
    (key) => deriveMetric(key, atual) !== 0 || deriveMetric(key, anterior) !== 0,
  );
}

/**
 * Detalhe por plataforma, com comparação contra o período anterior.
 *
 * A comparação é POR PLATAFORMA: o CPA consolidado pode cair enquanto o
 * do Meta sobe, se o Google ganhou participação. Comparar cada canal
 * contra ele mesmo é o que mostra isso.
 *
 * `rotulos` vem do template — se a conta chama conversão de "Pedidos",
 * o quadro do Meta diz "Pedidos". A página A4 não tem template e passa
 * um objeto vazio.
 */
export function buildPlatformDetail(
  atuais: DailyMetric[],
  anteriores: DailyMetric[],
  rotulos: Partial<Record<MetricKey, string>> = {},
): PlatformDetail[] {
  const porPlataformaAnterior = new Map(
    splitByPlatform(anteriores).map((p) => [p.platform, p.totals] as const),
  );

  const vazio = sumMetrics([]);

  return splitByPlatform(atuais).map((p) => {
    const anterior = porPlataformaAnterior.get(p.platform) ?? vazio;

    return {
      platform: p.platform,
      label: p.label,
      spendShare: p.spendShare,
      kpis: metricasComNumero(p.totals, anterior).map((key) => {
        const kpi = computeKpi(key, p.totals, anterior);
        const rotulo = rotulos[key];
        return rotulo ? { ...kpi, label: rotulo } : kpi;
      }),
      campaigns: campanhasDaPlataforma(atuais, p.platform),
    };
  });
}

/**
 * Encurta o nome da campanha para UMA linha na tabela do relatório.
 *
 * Não é cosmético: no `react-pdf` a linha da tabela cresce com o texto,
 * e um nome de agência — "[VENDAS] Kit Rotina — Advantage+ | LAL 1% |
 * Retargeting 30d" — quebra em duas ou três linhas. Com altura de linha
 * variável, NENHUM limite fixo de campanhas garante que a seção caiba na
 * folha: medido, seis linhas com nome curto cabiam e seis com nome longo
 * estouravam para uma página órfã no meio do PDF do cliente.
 *
 * 42 caracteres é o que a coluna comporta em A4 na largura `flex: 3`.
 * O corte é no fim porque o começo do nome é o que identifica a
 * campanha — a convenção de nomenclatura põe o objetivo na frente.
 */
const LIMITE_DO_NOME = 42;

function encurtar(nome: string): string {
  return nome.length <= LIMITE_DO_NOME
    ? nome
    : `${nome.slice(0, LIMITE_DO_NOME - 1).trimEnd()}…`;
}

/** Campanhas de uma plataforma, agregadas no período e ordenadas por gasto. */
function campanhasDaPlataforma(
  linhas: DailyMetric[],
  platform: AdCreative["platform"],
): PlatformCampaign[] {
  const porCampanha = new Map<string, DailyMetric[]>();

  for (const linha of linhas) {
    if (linha.platform !== platform) continue;
    /* Agrupa pelo NOME e não pelo id: o mesmo nome com dois ids é a
       campanha duplicada de teste, e o cliente lê os dois como um. O id
       não aparece no relatório, então separar por ele criaria duas
       linhas idênticas sem explicação. */
    const chave = linha.campaign_name ?? "Sem nome";
    const lista = porCampanha.get(chave);
    if (lista) lista.push(linha);
    else porCampanha.set(chave, [linha]);
  }

  return [...porCampanha.entries()]
    .map(([name, linhasDaCampanha]) => {
      const t = sumMetrics(linhasDaCampanha);
      return {
        name: encurtar(name),
        spendCents: t.spendCents,
        results: t.conversions,
        cpaCents: deriveMetric("cpa", t),
        clicks: t.clicks,
        ctr: deriveMetric("ctr", t),
        roas: deriveMetric("roas", t),
      };
    })
    .sort((a, b) => b.spendCents - a.spendCents);
}
