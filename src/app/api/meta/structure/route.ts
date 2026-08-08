import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAdStructure } from "@/lib/ads/meta-structure";

/**
 * GET /api/meta/structure?clientId=&since=&until=
 *
 * Campanha › conjunto › anúncio, ao vivo da Graph API.
 *
 * AUTORIZAÇÃO À MÃO, e não é opcional: `fetchAdStructure` usa
 * `service_role` para alcançar o token em `integration_secrets`, então
 * o RLS não protege mais nada daqui para baixo. A checagem abaixo é a
 * única barreira — sem ela, qualquer sessão autenticada leria a
 * estrutura de qualquer conta passando um `clientId` na URL.
 *
 * Sob demanda, não no carregamento da página: é uma chamada externa de
 * até 20s para uma tela de consulta que nem sempre é aberta.
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") ?? "";
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";

  if (!clientId || !ISO.test(since) || !ISO.test(until) || since > until) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  /* O usuário alcança ESTE cliente? A consulta passa por RLS de
     propósito: se a policy não deixa ele ver a conta, `data` volta nulo
     e a resposta é 403 — a mesma regra do resto do sistema, sem uma
     segunda definição de "quem vê o quê" morando aqui. */
  const supabase = await createSupabaseServerClient();
  const { data: cliente } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (!cliente) {
    return NextResponse.json(
      { error: "Conta não encontrada ou sem acesso." },
      { status: 403 },
    );
  }

  const resultado = await fetchAdStructure(clientId, since, until);

  if (!resultado.ok) {
    // 200 com `error` no corpo: a rota funcionou, a plataforma é que não
    // respondeu. Um 5xx aqui faria o card parecer quebrado quando o que
    // houve foi token vencido — dois problemas com remédios diferentes.
    return NextResponse.json(
      { error: resultado.error },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(resultado.dados, {
    headers: { "Cache-Control": "no-store" },
  });
}
