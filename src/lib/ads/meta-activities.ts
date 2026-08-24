import "server-only";

import { serverEnv } from "@/lib/env";
import { formatCurrency } from "@/lib/format";
import { dataNoBrasil } from "@/lib/date-br";

/* =====================================================================
   O histórico de alterações da conta, direto da Meta
   ---------------------------------------------------------------------
   É o mesmo log que o Gerenciador de Anúncios mostra em "Histórico de
   atividade" — `GET /act_<id>/activities`. A Meta já devolve o rótulo
   TRADUZIDO ("Orçamento do conjunto de anúncios atualizado"), então a
   tela não precisa manter um dicionário de `event_type` que ficaria
   desatualizado no dia em que aparecesse um tipo novo.

   POR QUE ISSO ENTRA NA ESTEIRA. O registro de otimização era memória:
   alguém escrevia "pausei dois criativos" e, um mês depois, ninguém
   sabia quais. O log é a prova do que foi mexido; a observação passa a
   ser só o PORQUÊ, que é a única parte que a API não sabe.

   DUAS MEDIÇÕES QUE DECIDIRAM O DESENHO, em 24/08/2026, na conta da
   Estação Elite Barbearia:

   1. VALOR EM CENTAVOS. O `new_value` de uma troca de orçamento veio
      275000, e o `lifetime_budget` do mesmo conjunto na API é "275000"
      — bate exatamente. É a unidade menor da moeda, igual ao resto do
      sistema, então `formatCurrency` serve direto. Dividir por 100
      "para converter" mostraria R$ 27,50 no lugar de R$ 2.750,00.

   2. COBRANÇA NÃO É OTIMIZAÇÃO. De 38 atividades em 30 dias, 27 eram
      `ad_account_billing_charge` — o cartão sendo debitado todo dia.
      Deixá-las na lista enterraria as duas mudanças de orçamento que
      de fato explicam o mês.
   ===================================================================== */

/** Cobrança do cartão. Ver a medição 2 no cabeçalho. */
const RUIDO = new Set(["ad_account_billing_charge", "funding_event_successful"]);

export interface AtividadeDaConta {
  /** Instante ISO, como a Meta devolveu. */
  quando: string;
  /** "Orçamento do conjunto de anúncios atualizado" — já em português. */
  atividade: string;
  /** "De R$ 2.830,00 para R$ 2.750,00 (Orçamento total)". `null` = sem detalhe. */
  detalhe: string | null;
  /** Nome do conjunto, campanha ou anúncio mexido. */
  objeto: string | null;
  objetoId: string | null;
  /** Quem mexeu. "Meta" quando foi automação da plataforma. */
  quem: string;
  /** `true` quando quem mexeu foi a plataforma, não uma pessoa. */
  automatico: boolean;
}

export interface DiaDeAtividade {
  /** `2026-08-24`, no fuso de São Paulo. */
  dia: string;
  atividades: AtividadeDaConta[];
}

/* ------------------------------------------------------------------ */

interface LinhaBruta {
  event_type?: string;
  translated_event_type?: string;
  event_time?: string;
  object_id?: string;
  object_name?: string;
  actor_name?: string;
  extra_data?: string;
}

export type ResultadoDeAtividades =
  | { ok: true; dias: DiaDeAtividade[] }
  | { ok: false; error: string };

/**
 * As atividades da conta, agrupadas por dia.
 *
 * `desdeDias` conta dias corridos para trás. O padrão de 30 cobre o mês
 * que a esteira discute sem trazer histórico que ninguém vai abrir.
 */
export async function atividadesDaConta(
  externalAccountId: string,
  accessToken: string,
  desdeDias = 30,
): Promise<ResultadoDeAtividades> {
  const conta = externalAccountId.startsWith("act_")
    ? externalAccountId
    : `act_${externalAccountId}`;

  const desde = Math.floor(Date.now() / 1000) - desdeDias * 86_400;

  const url =
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/${conta}/activities` +
    `?fields=event_type,translated_event_type,event_time,object_id,object_name,actor_name,extra_data` +
    `&since=${desde}&limit=200`;

  try {
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });

    const corpo = (await resposta.json()) as {
      data?: LinhaBruta[];
      error?: { message?: string };
    };

    if (!resposta.ok || corpo.error) {
      return {
        ok: false,
        error: corpo.error?.message ?? `A Meta respondeu ${resposta.status}.`,
      };
    }

    return { ok: true, dias: agruparPorDia(corpo.data ?? []) };
  } catch (erro) {
    return {
      ok: false,
      error:
        erro instanceof Error
          ? `Falha ao consultar a Meta: ${erro.message}`
          : "Falha ao consultar a Meta.",
    };
  }
}

/* ------------------------------------------------------------------ */

function agruparPorDia(linhas: LinhaBruta[]): DiaDeAtividade[] {
  const porDia = new Map<string, AtividadeDaConta[]>();

  for (const linha of linhas) {
    if (RUIDO.has(linha.event_type ?? "")) continue;
    if (!linha.event_time) continue;

    /* O DIA É O DE SÃO PAULO, não o de UTC. A Meta carimba
       `2026-08-24T17:10:37+0000`; uma alteração feita às 22h de
       Brasília chega como 01h do dia seguinte em UTC e cairia no bloco
       errado — justamente a alteração feita "ontem à noite", que é
       quando boa parte da otimização acontece. */
    const dia = dataNoBrasil(new Date(linha.event_time));

    const lista = porDia.get(dia) ?? [];
    lista.push({
      quando: linha.event_time,
      atividade:
        linha.translated_event_type?.trim() ||
        rotuloDeReserva(linha.event_type ?? ""),
      detalhe: descreverMudanca(linha.extra_data),
      objeto: linha.object_name?.trim() || null,
      objetoId: linha.object_id ?? null,
      quem: linha.actor_name?.trim() || "—",
      automatico: (linha.actor_name ?? "").trim().toLowerCase() === "meta",
    });
    porDia.set(dia, lista);
  }

  return [...porDia.entries()]
    .map(([dia, atividades]) => ({
      dia,
      atividades: atividades.sort((a, b) => b.quando.localeCompare(a.quando)),
    }))
    .sort((a, b) => b.dia.localeCompare(a.dia));
}

/**
 * Quando a Meta não manda o texto pronto.
 *
 * `update_ad_set_budget` → "Update ad set budget". Feio, e de
 * propósito: um dicionário nosso de `event_type` daria a impressão de
 * cobertura completa e silenciaria o tipo novo que aparecesse amanhã.
 * Assim fica evidente que veio sem tradução.
 */
function rotuloDeReserva(eventType: string): string {
  if (!eventType) return "Alteração";
  const t = eventType.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ------------------------------------------------------------------ */

interface ValorComposto {
  type?: string;
  currency?: string;
  old_value?: number | string;
  new_value?: number | string;
  additional_value?: string;
}

interface ExtraData {
  type?: string;
  old_value?: ValorComposto | string | number;
  new_value?: ValorComposto | string | number;
}

/**
 * "De X para Y", quando dá para dizer.
 *
 * O `extra_data` vem como STRING de JSON e muda de formato por tipo de
 * evento: ora `old_value` é um texto ("nome antigo"), ora é um objeto
 * com moeda e unidade. Um `JSON.parse` sem rede de proteção derrubaria
 * a tela inteira por causa de um evento exótico — daí o `try` que
 * devolve `null`: sem detalhe é aceitável, tela quebrada não.
 */
export function descreverMudanca(bruto: string | undefined): string | null {
  if (!bruto) return null;

  let dados: ExtraData;
  try {
    dados = JSON.parse(bruto) as ExtraData;
  } catch {
    return null;
  }

  const antes = ladoDaMudanca(dados.old_value, "old_value");
  const depois = ladoDaMudanca(dados.new_value, "new_value");

  if (!antes && !depois) return null;

  /* A UNIDADE VEM DO LADO NOVO — "Por dia", "Orçamento total". É o que
     diferencia R$ 2.750,00 por dia de R$ 2.750,00 no total, e sem ela o
     número sozinho engana em uma ordem de grandeza. */
  const unidade =
    typeof dados.new_value === "object" && dados.new_value !== null
      ? (dados.new_value as ValorComposto).additional_value?.trim()
      : "";

  const sufixo = unidade ? ` (${unidade})` : "";

  if (antes && depois) return `De ${antes} para ${depois}${sufixo}`;

  /* SÓ UM LADO: o valor sozinho, sem "Para". Eventos como "Anúncio
     exibido" não vêm de estado nenhum — o Gerenciador mostra apenas
     "Exibição iniciada", e um "Para Exibição iniciada" inventaria uma
     transição que não existiu. */
  return `${depois ?? antes}${sufixo}`;
}

/** Um dos lados do "de/para", já formatado. */
function ladoDaMudanca(
  valor: ValorComposto | string | number | undefined,
  chave: "old_value" | "new_value",
): string | null {
  if (valor === undefined || valor === null) return null;

  if (typeof valor === "string") return valor.trim() || null;
  if (typeof valor === "number") return String(valor);

  const bruto = valor[chave];
  if (bruto === undefined || bruto === null) return null;

  /* Dinheiro em CENTAVOS — conferido contra o `lifetime_budget` da
     própria API. Ver a medição 1 no cabeçalho. */
  if (valor.type === "payment_amount" && typeof bruto === "number") {
    return formatCurrency(bruto);
  }

  return String(bruto).trim() || null;
}
