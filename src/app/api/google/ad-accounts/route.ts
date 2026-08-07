import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/**
 * GET /api/google/ad-accounts?clientId=<uuid>
 *
 * Contas do Google Ads alcançáveis pelo token que este cliente
 * autorizou. Espelha `/api/meta/ad-accounts`, e é ADMIN pelo mesmo
 * motivo: a resposta revela a carteira inteira da MCC, que é mais do que
 * o vínculo de um cliente só.
 *
 * DUAS CHAMADAS, não uma. `listAccessibleCustomers` devolve só os
 * RESOURCE NAMES (`customers/4618704113`) — nenhum nome, nenhuma moeda.
 * Uma lista de dez números crus não é um seletor: seria pior que o campo
 * de texto que ela substitui. A segunda chamada busca o descritivo de
 * cada conta com um `searchStream` na MCC.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* A Google aposenta versão a cada poucos meses, e a resposta de uma
   versão morta é a página HTML 404 do gateway — não um JSON de erro.
   Manter em sincronia com `lib/ads/google-ads.ts`. */
const API_VERSION = "v21";

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

  if (!segredos?.access_token) {
    return NextResponse.json({
      ok: false,
      error:
        "Este cliente ainda não autorizou o Google. Clique em Autorizar primeiro.",
    });
  }

  const headers = {
    Authorization: `Bearer ${segredos.access_token}`,
    "developer-token": serverEnv.googleAdsDeveloperToken,
    "login-customer-id": serverEnv.googleAdsLoginCustomerId.replace(/\D/g, ""),
    "Content-Type": "application/json",
  };

  try {
    /* 1) Quais contas este token alcança. */
    const acessivel = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );

    if (!acessivel.ok) {
      /* O corpo pode ser HTML quando a versão da API morreu. Ler como
         texto e cortar evita despejar uma página inteira na tela. */
      const corpo = (await acessivel.text()).slice(0, 200);
      return NextResponse.json({
        ok: false,
        error: `Google recusou (${acessivel.status}): ${corpo}`,
      });
    }

    const { resourceNames = [] } = (await acessivel.json()) as {
      resourceNames?: string[];
    };

    const ids = resourceNames.map((r) => r.split("/").pop() ?? "").filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, accounts: [] });
    }

    /* 2) O descritivo de cada uma, numa consulta só na MCC. `IN` com a
       lista inteira em vez de um request por conta: dez chamadas
       sequenciais estourariam o tempo da função. */
    const mcc = serverEnv.googleAdsLoginCustomerId.replace(/\D/g, "");
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.test_account,
        customer_client.manager
      FROM customer_client
      WHERE customer_client.id IN (${ids.join(",")})
    `;

    const detalhes = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${mcc}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );

    /* Se o descritivo falhar, ainda devolvemos os ids. Um seletor com
       números crus é ruim; um seletor vazio é inútil. */
    if (!detalhes.ok) {
      return NextResponse.json({
        ok: true,
        accounts: ids.map<ContaGoogle>((id) => ({
          id: formatarId(id),
          name: formatarId(id),
          currency: null,
          isTest: false,
          isManager: false,
        })),
        warning: "Não foi possível ler os nomes das contas.",
      });
    }

    // searchStream devolve um ARRAY de chunks, não um objeto único.
    const chunks = (await detalhes.json()) as {
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
       são o que se quer vincular a um cliente. */
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
