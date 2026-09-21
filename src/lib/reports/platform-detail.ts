import {
  computeKpi,
  deriveMetric,
  splitByPlatform,
  sumMetrics,
  type KpiResult,
} from "@/lib/metrics/kpi";
import type { AdCreative, DailyMetric, MetricKey } from "@/types/database";
import {
  ROTULO_DA_UNIDADE,
  unidadeDaCampanha,
} from "@/lib/ads/creative-goal";

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
  /**
   * O que ESTA campanha compra: "Visitas ao perfil", "Impressões",
   * "Cliques", ou o nome que a conta dá à conversão dela.
   *
   * Sem isto a coluna de resultado é ilegível depois que cada linha
   * passou a ter a sua unidade — "131" e "4" na mesma coluna, um de
   * visita e outro de conversa.
   */
  objetivo: string;
  /**
   * O resultado NA UNIDADE DE `objetivo`.
   *
   * `null` = não apurado, e só acontece com visita ao perfil em linha
   * sincronizada antes da migration 76. Zero diria que a campanha não
   * entregou nada, que é a afirmação errada.
   */
  results: number | null;
  /** Custo de UMA unidade do resultado — de uma visita, de um clique. */
  cpaCents: number;
  /**
   * Sufixo do custo, quando a unidade não é a do resultado.
   *
   * Só "impressões" precisa: custo por impressão é fração de centavo e
   * imprimiria "R$ 0,00". Ali o número é CPM, e sem o "/mil" ao lado
   * quem lê entende mil vezes mais caro do que é.
   */
  custoSufixo: string;
  /** Sem denominador não há custo — imprime "—", nunca "R$ 0,00". */
  custoIndefinido: boolean;
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
 * o quadro do Meta diz "Pedidos", e a coluna "Objetivo" da tabela de
 * campanhas também. A folha A4 passa os MESMOS rótulos, por
 * `print-data.ts`: é o que mantém a tabela que a equipe revisa igual à
 * que o cliente recebe. (Esta nota já disse que a A4 passava um objeto
 * vazio; era falso e induzia a erro ao ler a coluna nova.)
 *
 * ⚠️ `tiposDeConversao` NÃO É OPCIONAL NA PRÁTICA, mesmo tendo padrão.
 * É ele que faz custo por resultado e ROAS saírem da campanha de
 * origem, como na grade de KPIs da página anterior. Sem ele este quadro
 * divide pelo gasto inteiro da plataforma e o cliente lê dois números
 * diferentes para a mesma coisa no mesmo arquivo — ver a nota em
 * `splitByPlatform`. O padrão existe só para o chamador que legitimamente
 * não sabe (a página A4 antes de resolver a conta).
 */
export function buildPlatformDetail(
  atuais: DailyMetric[],
  anteriores: DailyMetric[],
  rotulos: Partial<Record<MetricKey, string>> = {},
  tiposDeConversao?: string[],
): PlatformDetail[] {
  const porPlataformaAnterior = new Map(
    splitByPlatform(anteriores, tiposDeConversao).map(
      (p) => [p.platform, p.totals] as const,
    ),
  );

  const vazio = sumMetrics([]);

  return splitByPlatform(atuais, tiposDeConversao).map((p) => {
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
      campaigns: campanhasDaPlataforma(atuais, p.platform, rotulos),
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
 * 32 caracteres é o que a coluna comporta em A4 na largura `flex: 2.6`
 * — eram 42 com `flex: 3`, até a coluna "Objetivo" entrar em
 * 21/09/2026. Mudar um sem o outro quebra o nome em duas linhas e a
 * seção estoura para uma página órfã: o limite e o `flex` do cabeçalho
 * em `document.tsx` andam casados.
 *
 * O corte é no fim porque o começo do nome é o que identifica a
 * campanha — a convenção de nomenclatura põe o objetivo na frente.
 */
const LIMITE_DO_NOME = 32;

function encurtar(nome: string): string {
  return nome.length <= LIMITE_DO_NOME
    ? nome
    : `${nome.slice(0, LIMITE_DO_NOME - 1).trimEnd()}…`;
}

/**
 * Inteiros que somam o mesmo que a soma arredondada — método do maior
 * resto (Hamilton).
 *
 * Exportada para teste: é aritmética com empate e com número negativo
 * de sobra, e o sintoma de um erro aqui é uma coluna que não fecha no
 * documento do cliente.
 */
export function distribuirArredondamento(valores: number[]): number[] {
  const alvo = Math.round(valores.reduce((s, v) => s + v, 0));
  const piso = valores.map((v) => Math.floor(v));
  let sobra = alvo - piso.reduce((s, v) => s + v, 0);

  /* Ordena pela parte fracionária, da maior para a menor. O índice
     desempata, para a saída não depender da ordem de iteração do Map. */
  const ordem = valores
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const saida = [...piso];
  /* `sobra` pode ser negativa quando os pisos já passam do alvo — não
     acontece com valores positivos, mas tirar de quem tem a MENOR parte
     fracionária é o simétrico correto e evita um laço infinito. */
  for (let k = 0; sobra !== 0 && k < ordem.length; k++) {
    const alvoIdx = sobra > 0 ? ordem[k].i : ordem[ordem.length - 1 - k].i;
    saida[alvoIdx] += sobra > 0 ? 1 : -1;
    sobra += sobra > 0 ? -1 : 1;
  }

  return saida;
}

/** Campanhas de uma plataforma, agregadas no período e ordenadas por gasto. */
function campanhasDaPlataforma(
  linhas: DailyMetric[],
  platform: AdCreative["platform"],
  rotulos: Partial<Record<MetricKey, string>> = {},
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

  /* ARREDONDAMENTO QUE FECHA COM O CARD, e não linha a linha.
     -----------------------------------------------------------------
     O Google Ads devolve conversão FRACIONÁRIA. Arredondando cada linha
     por conta própria, a soma da coluna não bate com o card
     "Resultados" da mesma página, que arredonda o TOTAL — somar os
     arredondados não é arredondar a soma.

     Medido no Atacado de Pratas, Google Ads, 18–24/08/2026:
     16,49 + 12,07 + 1,40 = 29,96. O card imprimia 30 e a coluna
     imprimia 16 + 12 + 1 = 29. No Dehon Store, 9,50 + 5,95 = 15,45:
     card 15, coluna 10 + 6 = 16. O cliente que soma a coluna acha um
     resultado a mais ou a menos que o título da seção.

     O método é o do maior resto: arredonda todo mundo para baixo,
     e distribui a diferença que falta para o total pelas campanhas com
     a maior parte fracionária. Determinístico e sem inventar valor —
     cada linha continua a uma unidade do seu número real.

     ⚠️ A COLUNA SÓ FECHA COM TODAS AS LINHAS VISÍVEIS. O PDF mostra as
     seis maiores e resume o resto em "Mais N campanhas"; ali a soma do
     que aparece é menor de propósito, e a nota diz isso.

     ⚠️ E DESDE 21/09/2026 A COLUNA NÃO É MAIS DE UMA UNIDADE SÓ. Cada
     linha mostra o que a SUA campanha compra — visita, impressão,
     clique ou a conversão da conta —, então somar a coluna inteira
     deixou de significar alguma coisa, e o card "Resultados" continua
     sendo o total da conversão da conta. O arredondamento abaixo
     continua valendo para as linhas de conversão, que são as que o
     card conta: sem ele, duas campanhas de 9,5 e 5,95 imprimiam 10 e 6
     contra um card de 15. É a coluna "Objetivo", ao lado, que impede a
     leitura errada de números de unidades diferentes empilhados. */
  /* ORDENADO ANTES DE DISTRIBUIR, e por gasto — que é a ordem em que a
     tabela sai. O desempate por índice do maior resto usa a posição da
     lista; se a lista chegasse na ordem de iteração do Map (ou seja, a
     ordem em que as linhas vieram do banco, que `order("metric_date")`
     não determina dentro de um mesmo dia), duas execuções com o mesmo
     dado poderiam dar assentos diferentes.

     Isso importa porque a prévia que a equipe aprova e o PDF que sai no
     envio são duas consultas distintas: a folha revisada podia dizer
     "A: 3 · B: 2" e o arquivo entregue "A: 2 · B: 3", sem nada ter
     mudado. Com a ordenação aqui, a mesma entrada dá sempre a mesma
     saída — e `name` desempata o empate de gasto. */
  const entradas = [...porCampanha.entries()].sort((a, b) => {
    const gastoA = a[1].reduce((s, l) => s + l.spend_cents, 0);
    const gastoB = b[1].reduce((s, l) => s + l.spend_cents, 0);
    return gastoB - gastoA || a[0].localeCompare(b[0]);
  });

  const brutos = entradas.map(([, l]) => sumMetrics(l).conversions);
  const arredondados = distribuirArredondamento(brutos);

  return entradas
    .map(([name, linhasDaCampanha], i) => {
      /* SEM `tiposDeConversao` DE PROPÓSITO, e não por esquecimento.
         Aqui as linhas já são de UMA campanha só: gasto dividido pelos
         resultados dela é o custo dela, que é o número certo e o mesmo
         que a isolação produz. Passar a lista faria a campanha que não é
         de origem — tráfego, reconhecimento — imprimir "—" no lugar do
         próprio custo, escondendo justamente o que a tabela existe para
         mostrar: quanto cada frente custou. */
      const t = sumMetrics(linhasDaCampanha);

      /* A UNIDADE SAI DA PRÓPRIA CAMPANHA, não da conta.
         -------------------------------------------------------------
         Até 21/09/2026 esta coluna imprimia sempre `conversions`, que
         é a conversão escolhida para a CONTA em `conversion-action.ts`.
         Numa conta de captação isso é conversa iniciada — e a campanha
         que compra visita ao perfil não gera nenhuma. Medido na Meu
         Case, 11–17/09: "01 | ENGAJAMENTO INSTAGRAM", R$ 79,80,
         PROFILE_AND_PAGE_ENGAGEMENT, resultado impresso 0. O mesmo PDF
         mostrava 131 visitas no card do criativo, duas seções abaixo.

         O objetivo chega vivo em `daily_metrics` desde que a campanha
         de origem precisou dele. Tomamos o primeiro não-nulo: as linhas
         de uma campanha são todas dela, e a Meta só muda objetivo
         criando campanha nova. */
      const comObjetivo = linhasDaCampanha.find(
        (l) => l.optimization_goal || l.objective,
      );
      const unidade = unidadeDaCampanha(
        comObjetivo?.optimization_goal ?? null,
        comObjetivo?.objective ?? null,
      );

      /* NULO SE NENHUMA LINHA TROUXE O NÚMERO, e é a diferença entre
         "não teve visita" e "este dia foi sincronizado antes da coluna
         existir" (migration 76). Somar tratando nulo como zero
         imprimiria um número menor que o real com cara de apurado. */
      const visitas = linhasDaCampanha.reduce<number | null>(
        (acc, l) =>
          l.profile_visits === null || l.profile_visits === undefined
            ? acc
            : (acc ?? 0) + l.profile_visits,
        null,
      );

      const resultado =
        unidade === "visitas"
          ? visitas
          : unidade === "impressoes"
            ? t.impressions
            : unidade === "cliques"
              ? t.clicks
              : /* A conversão da conta, com o arredondamento que fecha
                   com o card — ver a nota acima. */
                arredondados[i];

      /* O custo é o do MESMO denominador que a linha mostra. É a regra
         que já vale no card do criativo: quem vê "131 visitas" ao lado
         de "R$ 0,61" refaz a conta e fecha. Dividir pelo resultado da
         conta aqui traria de volta a divergência de agosto, só que
         dentro da própria linha. */
      const custoIndefinido = resultado === null || resultado === 0;
      const cpaCents = custoIndefinido
        ? 0
        : unidade === "impressoes"
          ? /* CPM: custo por impressão é fração de centavo e sairia
               "R$ 0,00". O "/mil" ao lado é o que impede a leitura mil
               vezes mais cara. */
            Math.round((t.spendCents / t.impressions) * 1000)
          : Math.round(t.spendCents / (resultado as number));

      return {
        name: encurtar(name),
        spendCents: t.spendCents,
        objetivo:
          unidade === "conversao"
            ? /* O nome que ESTA conta dá ao resultado — "Pedidos",
                 "Leads". Cair em "Resultados" é o caso da folha A4, que
                 não tem template. */
              rotulos.results ?? rotulos.leads ?? "Resultados"
            : ROTULO_DA_UNIDADE[unidade],
        results: resultado,
        cpaCents,
        custoSufixo: unidade === "impressoes" ? "/mil" : "",
        custoIndefinido,
        clicks: t.clicks,
        ctr: deriveMetric("ctr", t),
        roas: deriveMetric("roas", t),
      };
    })
    /* A lista já chega ordenada por gasto (ver `entradas`); este sort
       final desempata pelo nome do mesmo jeito, para a tabela e a
       distribuição do arredondamento verem exatamente a mesma ordem. */
    .sort((a, b) => b.spendCents - a.spendCents || a.name.localeCompare(b.name));
}
