import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   Renovação automática do token da Meta
   ---------------------------------------------------------------------
   O token de usuário de longa duração dura ~60 dias. Conferido em
   29/09/2026 no `debug_token`: tipo USER, expirando em 27/11. Ele NÃO
   se renova sozinho — quem não trocar, perde.

   ⚠️ E ISTO NÃO É O QUE DERRUBOU AS 48 CONTAS EM 18/09. Medido: as 48
   com erro de autenticação tinham prazo NO FUTURO, nenhuma vencida. O
   que as matou foi `190 — a sessão foi invalidada`, junto com as duas
   restrições na conta do Facebook que autoriza a carteira. Sessão morta
   não se renova.

   Ou seja, este arquivo fecha a porta do VENCIMENTO, que é uma falha
   silenciosa e evitável, e não pretende resolver a outra. A que resolve
   a outra é o Usuário do Sistema da Business Manager, que depende de as
   contas dos clientes serem compartilhadas com a BM — trabalho de
   processo, não de código.

   ⚠️ UM TOKEN, VÁRIOS CLIENTES. Quase toda a carteira foi autorizada
   pela mesma pessoa, então o MESMO valor de token está gravado em
   dezenas de linhas de `integration_secrets`. Trocar linha a linha
   faria dezenas de chamadas para renovar um único segredo, e a Meta
   devolveria um token diferente em cada uma — deixando a carteira com
   dezenas de tokens novos onde havia um. Aqui se agrupa por valor,
   troca UMA vez, e grava o resultado em todas as linhas que tinham o
   antigo.
   ===================================================================== */

/**
 * A partir de quantos dias do fim vale trocar.
 *
 * Catorze: o cron roda uma vez por dia, então a janela precisa
 * comportar uma sequência de falhas — deploy quebrado, Meta fora do ar,
 * rodada que estourou o tempo — sem o token morrer no meio. Trocar cedo
 * demais também custa: cada troca gera um token novo e descarta o
 * anterior, e não há nada a ganhar renovando algo que ainda tem cinco
 * semanas.
 */
const DIAS_PARA_RENOVAR = 14;

export interface ResultadoDaRenovacao {
  /** Valores distintos de token encontrados na carteira. */
  tokensDistintos: number;
  /** Quantos estavam perto do fim e foram tentados. */
  tentados: number;
  renovados: number;
  falharam: number;
  /** Linhas de `integration_secrets` atualizadas. */
  linhasAtualizadas: number;
  motivos: string[];
}

export async function renovarTokensDaMeta(): Promise<ResultadoDaRenovacao> {
  const vazio: ResultadoDaRenovacao = {
    tokensDistintos: 0,
    tentados: 0,
    renovados: 0,
    falharam: 0,
    linhasAtualizadas: 0,
    motivos: [],
  };

  if (isDemoMode) return vazio;

  /* ⚠️ SEM SEGREDO DO APP NÃO HÁ TROCA. É o mesmo segredo usado no
     callback do OAuth, e um valor errado aqui falha em toda rodada sem
     consequência visível — o token simplesmente vence um dia. Por isso
     o motivo volta no relatório da rodada. */
  if (!serverEnv.metaAppId || !serverEnv.metaAppSecret) {
    return { ...vazio, motivos: ["META_APP_ID/SECRET ausentes"] };
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("client_integrations")
    .select("id, sync_error, integration_secrets(access_token, expires_at)")
    .eq("platform", "meta_ads")
    .eq("is_active", true);

  if (error) return { ...vazio, motivos: [`consulta recusada: ${error.message}`] };

  /* Agrupa por VALOR do token — ver a nota do cabeçalho. */
  const porToken = new Map<
    string,
    { expiraEm: string | null; integracoes: string[]; algumVivo: boolean }
  >();

  for (const linha of (data ?? []) as unknown as {
    id: string;
    sync_error: string | null;
    integration_secrets?: { access_token?: string | null; expires_at?: string | null } | null;
  }[]) {
    const token = linha.integration_secrets?.access_token;
    if (!token) continue;

    const grupo = porToken.get(token) ?? {
      expiraEm: linha.integration_secrets?.expires_at ?? null,
      integracoes: [],
      algumVivo: false,
    };
    grupo.integracoes.push(linha.id);

    /* `auth_expired` = sessão já morta. Trocar um token morto devolve
       erro garantido; pular economiza a chamada e mantém o relatório da
       rodada legível. Outros erros de sync não dizem nada sobre o
       token, então não contam. */
    if (!linha.sync_error?.includes("auth_expired")) grupo.algumVivo = true;

    porToken.set(token, grupo);
  }

  const resultado: ResultadoDaRenovacao = {
    ...vazio,
    tokensDistintos: porToken.size,
    motivos: [],
  };

  const limite = new Date();
  limite.setDate(limite.getDate() + DIAS_PARA_RENOVAR);

  for (const [token, grupo] of porToken) {
    if (!grupo.algumVivo) continue;

    /* Sem data gravada, trocar é o lado seguro: não saber quando vence
       é o mesmo risco de estar perto de vencer. */
    if (grupo.expiraEm && new Date(grupo.expiraEm) > limite) continue;

    resultado.tentados += 1;

    const novo = await trocarToken(token);

    if (!novo.ok) {
      resultado.falharam += 1;
      resultado.motivos.push(novo.motivo);
      continue;
    }

    /* ⚠️ SÓ GRAVA NO SUCESSO, e é a regra que mais importa aqui.
       Escrever o resultado de uma troca que falhou apagaria um token
       que ainda funciona e derrubaria a coleta do cliente — o conserto
       automático virando a avaria. */
    const expiraEm = novo.expiraEmSegundos
      ? new Date(Date.now() + novo.expiraEmSegundos * 1000).toISOString()
      : null;

    const { error: erroUpdate, count } = await admin
      .from("integration_secrets")
      .update(
        {
          access_token: novo.token,
          expires_at: expiraEm,
          updated_at: new Date().toISOString(),
        },
        { count: "exact" },
      )
      .in("integration_id", grupo.integracoes);

    if (erroUpdate) {
      resultado.falharam += 1;
      resultado.motivos.push(`falha ao gravar: ${erroUpdate.message}`);
      continue;
    }

    resultado.renovados += 1;
    resultado.linhasAtualizadas += count ?? 0;
  }

  return resultado;
}

type TrocaDeToken =
  | { ok: true; token: string; expiraEmSegundos: number | null }
  | { ok: false; motivo: string };

/**
 * Troca um token de longa duração por outro novo.
 *
 * Função à parte porque o caminho de erro tem três saídas — rede,
 * resposta sem token, JSON inesperado — e um `continue` em cada uma,
 * dentro do laço, fazia o TypeScript perder o tipo do resultado. Aqui
 * o contrato é explícito: ou veio token, ou veio motivo.
 *
 * ⚠️ NUNCA lança: quem chama está no meio de uma varredura da carteira,
 * e uma conta que falha não pode derrubar as outras.
 */
async function trocarToken(atual: string): Promise<TrocaDeToken> {
  try {
    const url = new URL(
      `https://graph.facebook.com/${serverEnv.metaApiVersion}/oauth/access_token`,
    );
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", serverEnv.metaAppId);
    url.searchParams.set("client_secret", serverEnv.metaAppSecret);
    url.searchParams.set("fb_exchange_token", atual);

    const r = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const corpo = (await r.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    } | null;

    if (!r.ok || !corpo?.access_token) {
      return {
        ok: false,
        motivo: corpo?.error?.message?.slice(0, 90) ?? `HTTP ${r.status}`,
      };
    }

    return {
      ok: true,
      token: corpo.access_token,
      expiraEmSegundos: corpo.expires_in ?? null,
    };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.name : "falha de rede" };
  }
}
