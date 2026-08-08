import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { conversionActionFor, isResultIndicator, resultIndicatorOf } from "./conversion-action";
import { decimalToCents, toDecimal, toInt } from "./normalize";
import type { ClientSegment } from "@/types/database";

/* =====================================================================
   Estrutura da conta — campanha › conjunto › anúncio
   ---------------------------------------------------------------------
   UMA REQUISIÇÃO, não três. `level=ad` já devolve `campaign_id`,
   `adset_id` e `ad_id` na mesma linha, então a árvore é montada
   agrupando em memória. Pedir os três níveis separadamente custaria três
   chamadas e abriria a chance de os totais não baterem entre si — o pai
   somando diferente dos filhos é o defeito clássico desse tipo de tela.

   O QUE ESTA TELA MOSTRA é o que ENTREGOU no período, não o que existe
   cadastrado. Um anúncio pausado ontem aparece com o gasto de anteontem;
   um criado hoje sem veiculação não aparece. É a leitura certa para
   "onde meu dinheiro foi" — e evita listar dezenas de conjuntos
   arquivados que só empurram o que importa para baixo.

   Não passa por `daily_metrics`: aquela tabela guarda por CAMPANHA, e
   descer a conjunto e anúncio exigiria uma migration e um backfill para
   uma tela de consulta. Ao vivo é mais simples e sempre atual — o custo
   é uma chamada, feita só quando alguém abre o card.
   ===================================================================== */

export interface NoDaArvore {
  id: string;
  name: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  /** Conversão na unidade do segmento — visita, conversa, compra… */
  results: number;
  filhos: NoDaArvore[];
}

export interface EstruturaDaConta {
  campanhas: NoDaArvore[];
  totalSpendCents: number;
  totalResults: number;
  /** Rótulo do que `results` conta, para a tela não dizer "resultados". */
  moeda: "BRL";
}

interface LinhaAd {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  results?: { indicator?: string; values?: { value?: string }[] }[];
}

const FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
  "results",
].join(",");

export type ResultadoEstrutura =
  | { ok: true; dados: EstruturaDaConta }
  | { ok: false; error: string };

export async function fetchAdStructure(
  clientId: string,
  since: string,
  until: string,
): Promise<ResultadoEstrutura> {
  if (!serverEnv.metaAppId) {
    return { ok: false, error: "Meta não configurado neste ambiente." };
  }

  /* service_role porque o token vive em `integration_secrets`, tabela sem
     policy alguma. A AUTORIZAÇÃO de quem pediu é checada na rota, antes
     de chegar aqui. */
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("client_integrations")
    .select(
      "external_account_id, conversion_action_type, clients(segment), integration_secrets(access_token)",
    )
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .maybeSingle();

  const linha = data as unknown as {
    external_account_id?: string;
    conversion_action_type?: string | null;
    clients?: { segment?: ClientSegment } | null;
    integration_secrets?: { access_token?: string | null } | null;
  } | null;

  const token = linha?.integration_secrets?.access_token;
  const conta = linha?.external_account_id;

  if (!token || !conta || conta.startsWith("pending:")) {
    return { ok: false, error: "Conta do Meta ainda não vinculada." };
  }

  const tipos = conversionActionFor(
    linha?.clients?.segment,
    linha?.conversion_action_type,
  );

  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/${
      conta.startsWith("act_") ? conta : `act_${conta}`
    }/insights`,
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("limit", "500");

  try {
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });

    const payload = (await resposta.json()) as {
      data?: LinhaAd[];
      error?: { message?: string };
    };

    if (!resposta.ok || payload.error) {
      return {
        ok: false,
        error: payload.error?.message ?? `Graph API respondeu ${resposta.status}.`,
      };
    }

    return { ok: true, dados: montarArvore(payload.data ?? [], tipos) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha de rede.",
    };
  }
}

/* ------------------------------------------------------------------ */

/**
 * Agrupa as linhas de anúncio em campanha › conjunto › anúncio.
 *
 * Pura, para poder ser conferida sem rede. O total de cada pai é a SOMA
 * dos filhos, nunca um número vindo à parte: é o que garante que abrir
 * uma campanha não revele números que não fecham com o cabeçalho.
 */
export function montarArvore(
  linhas: LinhaAd[],
  tipos: string[],
): EstruturaDaConta {
  const campanhas = new Map<string, NoDaArvore>();
  const conjuntos = new Map<string, NoDaArvore>();

  for (const l of linhas) {
    const campId = l.campaign_id ?? "_sem_campanha";
    const setId = l.adset_id ?? "_sem_conjunto";

    const anuncio: NoDaArvore = {
      id: l.ad_id ?? `${setId}-?`,
      name: l.ad_name ?? "Anúncio sem nome",
      spendCents: decimalToCents(l.spend),
      impressions: toInt(l.impressions),
      clicks: toInt(l.clicks),
      results: somarTipos(l, tipos),
      filhos: [],
    };

    let campanha = campanhas.get(campId);
    if (!campanha) {
      campanha = {
        id: campId,
        name: l.campaign_name ?? "Campanha sem nome",
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        filhos: [],
      };
      campanhas.set(campId, campanha);
    }

    const chaveSet = `${campId}:${setId}`;
    let conjunto = conjuntos.get(chaveSet);
    if (!conjunto) {
      conjunto = {
        id: setId,
        name: l.adset_name ?? "Conjunto sem nome",
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        filhos: [],
      };
      conjuntos.set(chaveSet, conjunto);
      campanha.filhos.push(conjunto);
    }

    conjunto.filhos.push(anuncio);

    for (const no of [conjunto, campanha]) {
      no.spendCents += anuncio.spendCents;
      no.impressions += anuncio.impressions;
      no.clicks += anuncio.clicks;
      no.results += anuncio.results;
    }
  }

  /* Ordena por gasto em todos os níveis: quem consome mais verba é quem
     custa mais caro quando está errado, então abre a lista. */
  const porGasto = (a: NoDaArvore, b: NoDaArvore) => b.spendCents - a.spendCents;
  const lista = [...campanhas.values()].sort(porGasto);
  for (const c of lista) {
    c.filhos.sort(porGasto);
    for (const s of c.filhos) s.filhos.sort(porGasto);
  }

  return {
    campanhas: lista,
    totalSpendCents: lista.reduce((a, c) => a + c.spendCents, 0),
    totalResults: lista.reduce((a, c) => a + c.results, 0),
    moeda: "BRL",
  };
}

/** Mesma regra de `toNormalizedRow`: duas gavetas, indicador na chave. */
function somarTipos(l: LinhaAd, tipos: string[]): number {
  return tipos.reduce((acc, tipo) => {
    if (isResultIndicator(tipo)) {
      const ind = resultIndicatorOf(tipo);
      return (
        acc +
        toDecimal(
          l.results?.find((r) => r.indicator === ind)?.values?.[0]?.value ?? 0,
        )
      );
    }
    return (
      acc + toDecimal(l.actions?.find((a) => a.action_type === tipo)?.value ?? 0)
    );
  }, 0);
}
