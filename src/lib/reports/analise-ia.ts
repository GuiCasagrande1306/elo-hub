import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { formatCurrency, formatPercent } from "@/lib/format";
import type { ReportPayload } from "@/lib/reports/payload";

/* =====================================================================
   Rascunho da leitura do time, escrito por IA
   ---------------------------------------------------------------------
   O QUE ISTO É: um primeiro rascunho a partir dos MESMOS números que
   entram no PDF. Não é o texto final — quem assina o relatório continua
   sendo a agência, e a tela deixa editar tudo antes de gerar.

   POR QUE A PARTIR DO `ReportPayload`, e não de uma consulta própria: o
   payload é literalmente o que o PDF desenha. Montar uma segunda leitura
   aqui abriria a porta para a análise citar um CPA que não aparece em
   página nenhuma do documento — o pior defeito possível num relatório
   que vai para o cliente.

   O MODELO NÃO RECEBE NÚMERO CRU. Ele recebe o texto já formatado
   (`R$ 4.320,00`, `+12,4%`) porque é assim que o número aparece no PDF;
   passar centavos convidaria a inventar a formatação e a divergir do
   documento em vírgula e escala.
   ===================================================================== */

export class AnaliseIndisponivel extends Error {}

export interface AnaliseGerada {
  insights: string;
  nextSteps: string[];
}

/**
 * Chave da Anthropic. Ausente = recurso desligado, e a tela precisa
 * dizer isso com todas as letras em vez de mostrar um erro de rede.
 */
export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODELO = "claude-opus-5";

const SISTEMA = `Você escreve a seção de análise de relatórios mensais de tráfego pago da Elo Marketing, uma agência brasileira. O texto vai direto para o cliente final — um empresário, não um profissional de mídia.

REGRAS DO TEXTO

- Português do Brasil, tom direto e profissional. Sem jargão de agência ("otimizações", "performance", "insights") quando existir palavra comum.
- Fale do NEGÓCIO, não do painel: "cada venda custou R$ 42" e não "o CPA ficou em R$ 42".
- Só afirme o que os números mostram. Você NÃO sabe o que foi feito na conta, que criativo entrou, nem o que o cliente vendeu fora do digital. Se a causa de uma variação não estiver nos dados, escreva o que mudou e diga que a causa precisa ser confirmada — nunca invente motivo.
- Nada de elogio vazio nem de alarme. Se o mês foi ruim, diga que foi ruim e mostre onde.
- Use os valores exatamente como vieram formatados. Não recalcule, não arredonde, não converta.

ANÁLISE: 2 a 4 frases em um parágrafo corrido, sem título e sem lista. Comece pelo que mais mudou no período.

PRÓXIMOS PASSOS: 3 a 5 ações concretas que a agência executa no próximo período, uma por item, começando com verbo no infinitivo. Nada de "monitorar" ou "acompanhar" sozinho — isso não é ação.`;

/**
 * Formato de saída forçado por schema.
 *
 * Sem isto o modelo devolveria markdown com títulos, e a tela teria de
 * adivinhar onde termina a análise e começam os passos — um parser
 * frágil sobre texto livre no caminho de algo que vai ao cliente.
 */
const ESQUEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["analise", "proximosPassos"],
  properties: {
    analise: {
      type: "string",
      description: "Parágrafo corrido, 2 a 4 frases, sem título nem lista.",
    },
    proximosPassos: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" },
      description: "Ações no infinitivo, uma por item, sem numeração.",
    },
  },
};

export async function gerarAnalise(
  payload: ReportPayload,
): Promise<AnaliseGerada> {
  if (!iaConfigurada()) {
    throw new AnaliseIndisponivel(
      "A análise por IA não está configurada: falta a variável ANTHROPIC_API_KEY no ambiente.",
    );
  }

  /* Sem dado no período não há o que analisar, e um modelo diante de
     zeros produz texto plausível sobre um mês que não existiu. Barrar
     aqui é mais honesto do que gerar e deixar alguém revisar. */
  const investimento = payload.kpis.find((k) => k.key === "spend");
  if (!investimento || investimento.value <= 0) {
    throw new AnaliseIndisponivel(
      "Não há investimento registrado neste período — sem números não dá para escrever a análise.",
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /* Streaming mesmo com resposta curta: `max_tokens` alto em requisição
     não-streaming esbarra no timeout de HTTP do SDK.

     ⚠️ QUEM CHAMA PRECISA DECLARAR `maxDuration = 60`. Esta função não
     controla o próprio teto: como Server Action ela herda o do segmento
     que a invoca, e como rota herda o do arquivo de rota. Hoje declaram
     `/relatorios/novo/page.tsx`, `/api/reports/generate` e
     `/api/reports/preview`. Um consumidor novo que esqueça vai ser
     cortado no meio, em silêncio. */
  const stream = client.messages.stream({
    model: MODELO,
    max_tokens: 4000,
    system: SISTEMA,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ESQUEMA },
    },
    messages: [{ role: "user", content: montarBriefing(payload) }],
  });

  const resposta = await stream.finalMessage();

  if (resposta.stop_reason === "refusal") {
    throw new AnaliseIndisponivel(
      "O modelo recusou escrever esta análise. Escreva à mão desta vez.",
    );
  }

  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let bruto: { analise?: unknown; proximosPassos?: unknown };
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new AnaliseIndisponivel(
      "A resposta do modelo veio em formato inesperado. Tente de novo.",
    );
  }

  const insights = typeof bruto.analise === "string" ? bruto.analise.trim() : "";
  const nextSteps = Array.isArray(bruto.proximosPassos)
    ? bruto.proximosPassos
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  if (!insights) {
    throw new AnaliseIndisponivel("O modelo devolveu uma análise vazia.");
  }

  return { insights, nextSteps };
}

/* ------------------------------------------------------------------ */

/**
 * O briefing enviado ao modelo.
 *
 * Números JÁ FORMATADOS, como no PDF. E a variação vem com o rótulo de
 * leitura (`melhor`/`pior`) resolvido por `sentiment`, porque a direção
 * não é óbvia: CPA subindo é ruim, e um modelo lendo "+12%" sem contexto
 * escreveria que o mês melhorou.
 */
function montarBriefing(payload: ReportPayload): string {
  const linhas: string[] = [];

  linhas.push(`Cliente: ${payload.client.name}`);
  linhas.push(`Segmento: ${payload.client.segment}`);
  linhas.push(
    `Período: ${payload.meta.periodStart} a ${payload.meta.periodEnd} (${payload.meta.days} dias)`,
  );
  linhas.push("");
  linhas.push("NÚMEROS DO PERÍODO (comparados com o período anterior de mesma duração):");

  for (const kpi of payload.kpis) {
    const variacao =
      kpi.deltaPercent === null
        ? "sem base de comparação (período anterior zerado)"
        : `${formatPercent(kpi.deltaPercent / 100, 1)} vs. ${kpi.previousFormatted} — ${leitura(kpi.sentiment)}`;

    linhas.push(`- ${kpi.label}: ${kpi.formatted} (${variacao})`);
  }

  if (payload.platforms.length > 0) {
    linhas.push("");
    linhas.push("DIVISÃO POR CANAL:");
    for (const p of payload.platforms) {
      /* `conversions` é o campo de resultado em `MetricTotals`; o
         `cpa` já vem calculado em centavos pelo `splitByPlatform`. */
      linhas.push(
        `- ${p.label}: ${formatCurrency(p.totals.spendCents)} investidos (${formatPercent(p.spendShare, 0)} do total), ${p.totals.conversions} resultados, custo por resultado ${formatCurrency(p.cpa)}`,
      );
    }
  }

  const criativos = payload.creatives.slice(0, 5);
  if (criativos.length > 0) {
    linhas.push("");
    linhas.push("ANÚNCIOS COM MAIS INVESTIMENTO:");
    for (const c of criativos) {
      linhas.push(
        `- ${c.adName ?? c.campaignName ?? "sem nome"} (${c.platformLabel}): ${formatCurrency(c.spendCents)}, ${c.results} resultados, custo por resultado ${formatCurrency(c.cpaCents)}`,
      );
    }
  }

  linhas.push("");
  linhas.push(
    "Escreva a análise do período e os próximos passos com base apenas no que está acima.",
  );

  return linhas.join("\n");
}

function leitura(sentiment: string): string {
  if (sentiment === "positive") return "melhorou";
  if (sentiment === "negative") return "piorou";
  return "estável";
}
