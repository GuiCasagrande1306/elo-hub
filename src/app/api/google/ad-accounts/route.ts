import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { API_VERSION, exchangeRefreshToken } from "@/lib/ads/google-ads";

/**
 * GET /api/google/ad-accounts?clientId=<uuid>
 *
 * Contas do Google Ads alcançáveis pelo token que este cliente
 * autorizou. Espelha `/api/meta/ad-accounts`, e é ADMIN pelo mesmo
 * motivo: a resposta revela a carteira inteira da MCC, que é mais do que
 * o vínculo de um cliente só.
 *
 * A LISTA VEM DE `customer_client`, não de `listAccessibleCustomers`.
 * O segundo parecia o endpoint óbvio e é uma armadilha: devolve o que o
 * usuário do OAuth alcança DIRETAMENTE, não a hierarquia da conta de
 * gerência. Medido nesta MCC: 3 contas contra as 23 reais — e a do
 * cliente que estávamos tentando vincular ficava de fora.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* A VERSÃO VEM DE `lib/ads/google-ads.ts`, importada.
   Aqui havia uma segunda declaração com um comentário pedindo "manter em
   sincronia" — e as duas saíram de sincronia exatamente como esse tipo
   de pedido costuma terminar. Quando a v21 morreu, corrigir num lugar
   deixaria esta tela quebrada com o mesmo 404 e nenhuma pista de que
   existia outra cópia. Uma constante, um dono. */

interface ContaGoogle {
  id: string;
  name: string;
  currency: string | null;
  /** Contas de teste não servem para relatório de cliente. */
  isTest: boolean;
  isManager: boolean;
}

/** "4618704113" → "461-870-4113", que é como o Google mostra. */
function formatarId(id: string): string {
  const d = id.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : id;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Não autorizado." },
      { status: 403 },
    );
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Informe ?clientId=<uuid>." },
      { status: 400 },
    );
  }

  if (!serverEnv.googleAdsDeveloperToken || !serverEnv.googleAdsLoginCustomerId) {
    return NextResponse.json({
      ok: false,
      error:
        "Google Ads não configurado (developer token e login-customer-id).",
    });
  }

  /* service_role: `integration_secrets` tem RLS ligada e ZERO policies,
     de propósito — nenhuma sessão alcança token. Só o servidor. */
  const admin = createSupabaseAdminClient();

  const { data: integracao } = await admin
    .from("client_integrations")
    .select("id, integration_secrets(access_token, refresh_token)")
    .eq("client_id", clientId)
    .eq("platform", "google_ads")
    .maybeSingle();

  const segredos = (
    integracao as {
      integration_secrets?: {
        access_token?: string | null;
        refresh_token?: string | null;
      };
    } | null
  )?.integration_secrets;

  if (!segredos?.refresh_token) {
    return NextResponse.json({
      ok: false,
      error:
        "Este cliente ainda não autorizou o Google. Clique em Autorizar primeiro.",
    });
  }

  /* TROCA O REFRESH POR UM ACCESS NOVO — não use o guardado.
     O access token do Google vale UMA HORA. Esta rota lia
     `refresh_token` no select e mandava `access_token` mesmo assim, o
     que fazia a tela funcionar nos sessenta minutos seguintes ao
     "Autorizar" e nunca mais. Medido em 19/08/2026: o token gravado
     tinha expirado em 07/08, e a API respondia UNAUTHENTICATED.

     Sem gravar o novo: depois desta mudança ninguém mais lê o
     `access_token` guardado do Google — o sync passa o refresh direto
     ao provider, que faz a própria troca. Guardar seria manter uma
     terceira cópia de um segredo que já tem dono. */
  const token = await exchangeRefreshToken(segredos.refresh_token);

  if (!token.ok) {
    return NextResponse.json({
      ok: false,
      error: `Não foi possível renovar o acesso ao Google: ${token.message}`,
    });
  }

  const headers = {
    Authorization: `Bearer ${token.accessToken}`,
    "developer-token": serverEnv.googleAdsDeveloperToken,
    "login-customer-id": serverEnv.googleAdsLoginCustomerId.replace(/\D/g, ""),
    "Content-Type": "application/json",
  };

  try {
    /* UMA chamada, em `customer_client` a partir da MCC.
       `listAccessibleCustomers` era o endpoint errado: ele devolve as
       contas que o USUÁRIO do OAuth alcança diretamente, não a
       hierarquia da conta de gerência. Nesta MCC retornava 3 de 23 — e
       o Atacado de Pratas, que estava lá, ficava de fora. */
    const mcc = serverEnv.googleAdsLoginCustomerId.replace(/\D/g, "");

    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.test_account,
        customer_client.manager
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
    `;

    const resposta = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${mcc}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!resposta.ok) {
      const corpo = await resposta.text();

      /* PÁGINA HTML = VERSÃO MORTA, e vale dizer isso em vez de despejar
         o 404 do gateway na tela. A versão anterior colava 300
         caracteres de `<!DOCTYPE html><meta charset=utf-8>…` no aviso:
         tecnicamente o motivo estava ali, e ninguém conseguia lê-lo.
         O texto cru continua no fim, porque um 404 que NÃO seja isso
         precisa aparecer inteiro. */
      const ehPaginaHtml = corpo.trimStart().startsWith("<");

      return NextResponse.json({
        ok: false,
        error: ehPaginaHtml
          ? `A versão ${API_VERSION} da API do Google Ads foi descontinuada — ` +
            "o endereço não existe mais. É correção de código: atualizar " +
            "`API_VERSION` em `lib/ads/google-ads.ts` para a versão viva " +
            "mais nova. Não adianta reautorizar."
          : `Google recusou (${resposta.status}): ${corpo.slice(0, 300)}`,
      });
    }

    // searchStream devolve um ARRAY de chunks, não um objeto único.
    const chunks = (await resposta.json()) as {
      results?: {
        customerClient?: {
          id?: string;
          descriptiveName?: string;
          currencyCode?: string;
          testAccount?: boolean;
          manager?: boolean;
        };
      }[];
    }[];

    const contas: ContaGoogle[] = [];

    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      for (const linha of chunk.results ?? []) {
        const c = linha.customerClient;
        if (!c?.id) continue;

        contas.push({
          id: formatarId(c.id),
          name: c.descriptiveName?.trim() || formatarId(c.id),
          currency: c.currencyCode ?? null,
          isTest: Boolean(c.testAccount),
          isManager: Boolean(c.manager),
        });
      }
    }

    /* MCC e conta de teste ficam no fim: são alcançáveis mas quase nunca
       são o que se quer vincular. Vincular a MCC por engano devolve o
       agregado da carteira inteira no relatório de um cliente só. */
    contas.sort((a, b) => {
      const pesoA = (a.isManager ? 2 : 0) + (a.isTest ? 1 : 0);
      const pesoB = (b.isManager ? 2 : 0) + (b.isTest ? 1 : 0);
      return pesoA - pesoB || a.name.localeCompare(b.name, "pt-BR");
    });

    return NextResponse.json({ ok: true, accounts: contas });
  } catch (erro) {
    return NextResponse.json({
      ok: false,
      error:
        erro instanceof Error
          ? `Falha ao consultar o Google: ${erro.message}`
          : "Falha ao consultar o Google.",
    });
  }
}
