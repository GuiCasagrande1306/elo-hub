import "server-only";

import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { normalizeCustomerId } from "./normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Coleta das conversões do Google POR AÇÃO
   ---------------------------------------------------------------------
   Roda ao lado do sync de métricas, não dentro dele: a consulta é
   outra (segmentada por ação de conversão) e o volume é diferente —
   uma linha por dia POR AÇÃO, em vez de uma por campanha.

   ⚠️ ENGOLE O PRÓPRIO ERRO, de propósito. Igual a `syncCreatives`:
   isto é complemento do painel, e uma conta que recuse a consulta
   segmentada não pode fazer a sincronização de gasto contar como
   falha. O erro vai para o log; o número de gasto chega igual.

   ⚠️ APAGA A JANELA ANTES DE REGRAVAR. O Google reclassifica
   conversão por dias depois do fato — ação some, nome muda, categoria
   é corrigida. Sem o apagar, uma ação renomeada fica no banco para
   sempre, somando junto com o nome novo e dobrando o resultado do
   cliente. Mesmo cuidado de `sincronizarLojas`.
   ===================================================================== */

/** Uma linha por dia por ação. Campanha fica de fora: a pergunta da
    tela é "quantos contatos no mês", não "de qual campanha". */
const QUERY = `
  SELECT
    segments.date,
    segments.conversion_action_name,
    segments.conversion_action_category,
    metrics.conversions,
    metrics.all_conversions
  FROM customer
  WHERE segments.date BETWEEN '{since}' AND '{until}'
`;

interface Linha {
  segments?: {
    date?: string;
    conversionActionName?: string;
    conversionActionCategory?: string;
  };
  metrics?: { conversions?: number | string; allConversions?: number | string };
}

export interface ResultadoDaColeta {
  ok: boolean;
  linhas: number;
  motivo?: string;
}

export async function coletarConversoesGoogle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  clientId: string,
  externalAccountId: string,
  refreshToken: string | null,
  since: string,
  until: string,
): Promise<ResultadoDaColeta> {
  if (!refreshToken) return { ok: false, linhas: 0, motivo: "sem refresh token" };

  try {
    const token = await exchangeRefreshToken(refreshToken);
    if (!token.ok) return { ok: false, linhas: 0, motivo: token.message };

    const customerId = normalizeCustomerId(externalAccountId);

    const resposta = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "developer-token": serverEnv.googleAdsDeveloperToken,
          ...(serverEnv.googleAdsLoginCustomerId
            ? {
                "login-customer-id": normalizeCustomerId(
                  serverEnv.googleAdsLoginCustomerId,
                ),
              }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: QUERY.replace("{since}", since).replace("{until}", until),
        }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      },
    );

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return { ok: false, linhas: 0, motivo: corpo.slice(0, 160) };
    }

    /* `searchStream` devolve um ARRAY de pedaços, não um objeto. */
    const pedacos = (await resposta.json()) as { results?: Linha[] }[];
    const brutas = pedacos.flatMap((p) => p.results ?? []);

    /* A mesma ação pode vir em mais de um pedaço do stream; a chave
       primária é (cliente, dia, ação), então somar antes de gravar
       evita um upsert sobrescrever o outro e perder metade do dia. */
    const porChave = new Map<
      string,
      {
        metric_date: string;
        action_name: string;
        category: string | null;
        conversions: number;
        all_conversions: number;
      }
    >();

    for (const l of brutas) {
      const data = l.segments?.date;
      const nome = l.segments?.conversionActionName;
      if (!data || !nome) continue;

      const chave = `${data}|${nome}`;
      const atual = porChave.get(chave) ?? {
        metric_date: data,
        action_name: nome.slice(0, 200),
        category: l.segments?.conversionActionCategory ?? null,
        conversions: 0,
        all_conversions: 0,
      };

      atual.conversions += Number(l.metrics?.conversions ?? 0);
      atual.all_conversions += Number(l.metrics?.allConversions ?? 0);
      porChave.set(chave, atual);
    }

    const linhas = [...porChave.values()].map((l) => ({ ...l, client_id: clientId }));

    /* Apaga a janela antes de regravar — ver a nota do cabeçalho. */
    const { error: erroDelete } = await admin
      .from("google_conversion_daily")
      .delete()
      .eq("client_id", clientId)
      .gte("metric_date", since)
      .lte("metric_date", until);

    if (erroDelete) return { ok: false, linhas: 0, motivo: erroDelete.message };

    if (linhas.length === 0) return { ok: true, linhas: 0 };

    const { error } = await admin.from("google_conversion_daily").insert(linhas);
    if (error) return { ok: false, linhas: 0, motivo: error.message };

    return { ok: true, linhas: linhas.length };
  } catch (e) {
    return {
      ok: false,
      linhas: 0,
      motivo: e instanceof Error ? e.message.slice(0, 160) : "falha desconhecida",
    };
  }
}
