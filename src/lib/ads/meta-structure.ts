import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CAMPOS_DE_METRICA, conversionActionFor } from "./conversion-action";
import { valorDoTipo } from "./meta-ads";
import { fetchGoogleStructure } from "./google-structure";
import { decimalToCents, toInt } from "./normalize";
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

export type NivelDaArvore = "campanha" | "conjunto" | "anuncio";

export type PlataformaDaArvore = "meta_ads" | "google_ads";

export interface NoDaArvore {
  id: string;
  name: string;
  nivel: NivelDaArvore;
  /** De onde veio a linha. As duas plataformas convivem na mesma árvore. */
  plataforma: PlataformaDaArvore;
  spendCents: number;
  impressions: number;
  clicks: number;
  /** Conversão na unidade do segmento — visita, conversa, compra… */
  results: number;
  revenueCents: number;
  /** Só no nível do anúncio: miniatura e link para o post real. */
  thumbnailUrl?: string | null;
  permalink?: string | null;
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
  action_values?: { action_type: string; value: string }[];
  instagram_profile_visits?: string;
}

/** Metadados do criativo, vindos da edge `/ads` — não do insights. */
interface Criativo {
  thumbnailUrl: string | null;
  permalink: string | null;
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
  "action_values",
  ...CAMPOS_DE_METRICA,
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
      "platform, external_account_id, conversion_action_type, clients(segment), integration_secrets(access_token, refresh_token)",
    )
    .eq("client_id", clientId)
    .eq("is_active", true);

  const integracoes = (data ?? []) as unknown as {
    platform: string;
    external_account_id?: string;
    conversion_action_type?: string | null;
    clients?: { segment?: ClientSegment } | null;
    integration_secrets?: {
      access_token?: string | null;
      refresh_token?: string | null;
    } | null;
  }[];

  const linha = integracoes.find((i) => i.platform === "meta_ads");
  const google = integracoes.find((i) => i.platform === "google_ads");

  const token = linha?.integration_secrets?.access_token;
  const conta = linha?.external_account_id;

  /* O Google roda EM PARALELO com a Meta e engole os próprios erros —
     ver `fetchGoogleStructure`. Uma conta que só tem Google precisa
     aparecer, e uma que só tem Meta não pode esperar o Google falhar. */
  const promessaGoogle = fetchGoogleStructure(
    google?.external_account_id,
    google?.integration_secrets?.refresh_token,
    since,
    until,
  );

  /* A guarda também ESTREITA os tipos daqui para baixo — por isso ela
     testa `token` e `conta` diretamente, em vez de um booleano à parte
     que o TypeScript não sabe relacionar. */
  if (!token || !conta || conta.startsWith("pending:")) {
    const campanhas = await promessaGoogle;
    return campanhas.length > 0
      ? { ok: true, dados: consolidar(campanhas) }
      : { ok: false, error: "Nenhuma conta de mídia vinculada." };
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
      /* A Meta falhou, mas o Google pode ter respondido. Devolver erro
         seco esconderia metade da conta. */
      const soGoogle = await promessaGoogle;
      if (soGoogle.length > 0) return { ok: true, dados: consolidar(soGoogle) };
      return {
        ok: false,
        error: payload.error?.message ?? `Graph API respondeu ${resposta.status}.`,
      };
    }

    /* Criativos numa chamada SEPARADA: `insights` não carrega
       miniatura nem permalink, e `/ads` não carrega métrica. Falhar
       aqui não derruba a árvore — os números são o essencial, a
       imagem é conforto. */
    const [criativos, campanhasGoogle] = await Promise.all([
      buscarCriativos(conta, token).catch(() => new Map<string, Criativo>()),
      promessaGoogle,
    ]);

    const meta = montarArvore(payload.data ?? [], tipos, criativos);

    return {
      ok: true,
      dados: consolidar([...meta.campanhas, ...campanhasGoogle]),
    };
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
  criativos: Map<string, Criativo> = new Map(),
): EstruturaDaConta {
  const campanhas = new Map<string, NoDaArvore>();
  const conjuntos = new Map<string, NoDaArvore>();

  for (const l of linhas) {
    const campId = l.campaign_id ?? "_sem_campanha";
    const setId = l.adset_id ?? "_sem_conjunto";

    const criativo = l.ad_id ? criativos.get(l.ad_id) : undefined;

    const anuncio: NoDaArvore = {
      id: l.ad_id ?? `${setId}-?`,
      name: l.ad_name ?? "Anúncio sem nome",
      nivel: "anuncio",
      plataforma: "meta_ads",
      spendCents: decimalToCents(l.spend),
      impressions: toInt(l.impressions),
      clicks: toInt(l.clicks),
      results: somarTipos(l, tipos),
      revenueCents: somarValores(l, tipos),
      thumbnailUrl: criativo?.thumbnailUrl ?? null,
      permalink: criativo?.permalink ?? null,
      filhos: [],
    };

    let campanha = campanhas.get(campId);
    if (!campanha) {
      campanha = {
        id: campId,
        name: l.campaign_name ?? "Campanha sem nome",
        nivel: "campanha",
        plataforma: "meta_ads",
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        revenueCents: 0,
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
        nivel: "conjunto",
        plataforma: "meta_ads",
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
        revenueCents: 0,
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
      no.revenueCents += anuncio.revenueCents;
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

/**
 * A MESMA função que o sync usa, importada em vez de reescrita.
 *
 * Duas cópias da regra "campo do Insights ou `action_type`" divergiriam
 * na primeira mudança, e a árvore passaria a somar diferente do card de
 * cima — na mesma tela.
 */
function somarTipos(l: LinhaAd, tipos: string[]): number {
  return tipos.reduce((acc, tipo) => acc + valorDoTipo(l, tipo), 0);
}

/** Receita dos mesmos tipos, para o ROAS. Campo de métrica não tem. */
function somarValores(l: LinhaAd, tipos: string[]): number {
  return tipos.reduce(
    (acc, tipo) =>
      acc +
      decimalToCents(
        l.action_values?.find((a) => a.action_type === tipo)?.value,
      ),
    0,
  );
}

/**
 * Miniatura e link do post, por `ad_id`.
 *
 * `instagram_permalink_url` primeiro: é o post real, que a pessoa abre
 * para ver o anúncio como o público vê. `preview_shareable_link` é o
 * preview do Gerenciador — funciona, mas exige login na conta certa.
 */
async function buscarCriativos(
  conta: string,
  token: string,
): Promise<Map<string, Criativo>> {
  const mapa = new Map<string, Criativo>();

  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/${
      conta.startsWith("act_") ? conta : `act_${conta}`
    }/ads`,
  );
  url.searchParams.set(
    "fields",
    "id,preview_shareable_link,creative{thumbnail_url,instagram_permalink_url}",
  );
  url.searchParams.set("limit", "500");

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  const j = (await r.json()) as {
    data?: {
      id: string;
      preview_shareable_link?: string;
      creative?: { thumbnail_url?: string; instagram_permalink_url?: string };
    }[];
  };

  for (const a of j.data ?? []) {
    mapa.set(a.id, {
      thumbnailUrl: a.creative?.thumbnail_url ?? null,
      permalink:
        a.creative?.instagram_permalink_url ?? a.preview_shareable_link ?? null,
    });
  }

  return mapa;
}


/* ------------------------------------------------------------------ */

/**
 * Junta as campanhas das duas plataformas numa árvore só.
 *
 * Ordenadas por gasto, misturadas de propósito: a pergunta é "onde meu
 * dinheiro foi", e ela não respeita fronteira de plataforma. O selo de
 * origem fica em cada linha (`plataforma`), então nada se confunde.
 */
function consolidar(campanhas: NoDaArvore[]): EstruturaDaConta {
  /* Fora quem não entregou NADA no período. O card promete "o que
     entregou", e conta antiga acumula campanha arquivada: no Atacado de
     Pratas eram 4 campanhas do Google a R$ 0,00 empurrando para baixo a
     única que gastou R$ 1.486. Sem gasto, sem impressão e sem resultado
     não há o que ler — é ruído, não informação. */
  const entregou = (n: NoDaArvore) =>
    n.spendCents > 0 || n.impressions > 0 || n.results > 0;

  const lista = campanhas
    .filter(entregou)
    .map((c) => ({
      ...c,
      filhos: c.filhos
        .filter(entregou)
        .map((s) => ({ ...s, filhos: s.filhos.filter(entregou) })),
    }))
    .sort((a, b) => b.spendCents - a.spendCents);
  return {
    campanhas: lista,
    totalSpendCents: lista.reduce((a, c) => a + c.spendCents, 0),
    totalResults: lista.reduce((a, c) => a + c.results, 0),
    moeda: "BRL",
  };
}
