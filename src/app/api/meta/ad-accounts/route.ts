import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * GET /api/meta/ad-accounts?clientId=<uuid>
 *
 * Lista as contas de anúncio que o token daquele cliente alcança, para
 * a pessoa escolher pelo NOME em vez de caçar o `act_...` no
 * Gerenciador de Anúncios.
 *
 * POR QUE `clientId` E NÃO "a agência": nesta base o token não é da
 * agência — é de cada `client_integrations`, gravado quando alguém
 * concluiu o OAuth daquele cliente. Um cliente pode ter autorizado o
 * Business Manager dele, não o nosso. Sem o parâmetro, a rota teria que
 * adivinhar qual token usar.
 *
 * ADMIN. A resposta revela a carteira inteira de contas de anúncio
 * alcançável pelo token, que é mais do que o vínculo de um cliente só.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ContaGraph {
  id?: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
}

interface RespostaGraph {
  data?: ContaGraph[];
  paging?: { next?: string };
  error?: { message?: string; code?: number };
}

/** 1 = ativa. O resto é desabilitada, pendente, encerrada, em revisão. */
const ATIVA = 1;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 403 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Informe ?clientId=<uuid>." },
      { status: 400 },
    );
  }

  /* service_role: `integration_secrets` tem RLS ligada e ZERO policies,
     de propósito — nenhuma sessão alcança token. Só o servidor. */
  const admin = createSupabaseAdminClient();

  const { data: integracao } = await admin
    .from("client_integrations")
    .select("id, integration_secrets(access_token)")
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .maybeSingle();

  const token = (
    integracao as { integration_secrets?: { access_token?: string | null } } | null
  )?.integration_secrets?.access_token;

  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "Este cliente ainda não autorizou o Meta. Clique em Autorizar primeiro.",
    });
  }

  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/me/adaccounts`,
  );
  url.searchParams.set("fields", "name,account_id,account_status,currency");
  url.searchParams.set("limit", "200");

  const contas: {
    id: string;
    name: string;
    active: boolean;
    currency: string | null;
  }[] = [];

  let proxima: string | null = url.toString();
  let pagina = 0;

  try {
    /* Teto de páginas: um Business Manager grande devolve dezenas, e um
       `paging.next` em laço travaria a função até o limite da Vercel. */
    while (proxima && pagina < 10) {
      const resposta: Response = await fetch(proxima, {
        headers: { Authorization: `Bearer ${token}` },
        // Bem abaixo do teto de 60s do plano Hobby: melhor devolver o
        // erro e deixar a digitação manual assumir do que estourar.
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });

      const dado = (await resposta.json()) as RespostaGraph;

      if (!resposta.ok || dado.error) {
        const codigo = dado.error?.code ?? 0;
        // 190/102 = token morto. Dizer isso evita a caça ao erro errado.
        const expirado = codigo === 190 || codigo === 102;
        return NextResponse.json({
          ok: false,
          error: expirado
            ? "A autorização do Meta expirou. Clique em Reautorizar."
            : (dado.error?.message ?? `A Graph API respondeu ${resposta.status}.`),
        });
      }

      for (const c of dado.data ?? []) {
        /* `id` já vem como `act_<numero>`; `account_id` vem sem o
           prefixo. Gravamos o formato com prefixo, que é o que a API de
           insights exige. */
        const id = c.id ?? (c.account_id ? `act_${c.account_id}` : null);
        if (!id) continue;

        contas.push({
          id,
          name: c.name?.trim() || id,
          active: c.account_status === ATIVA,
          currency: c.currency ?? null,
        });
      }

      proxima = dado.paging?.next ?? null;
      pagina += 1;
    }
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "O Meta demorou demais para responder. Cole o ID manualmente."
          : "Falha de rede ao consultar o Meta.",
    });
  }

  /* Ativas primeiro, depois alfabético. Quem vincula procura uma conta
     que roda — deixar as encerradas misturadas faz escolher errado. */
  contas.sort((a, b) =>
    a.active === b.active
      ? a.name.localeCompare(b.name, "pt-BR")
      : a.active
        ? -1
        : 1,
  );

  return NextResponse.json({ ok: true, accounts: contas });
}
