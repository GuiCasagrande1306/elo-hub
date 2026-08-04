import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { fetchAllGroups } from "@/lib/whatsapp/session";

/**
 * GET /api/whatsapp/groups
 *
 * Grupos do WhatsApp do usuário logado, para o seletor de destino.
 *
 * A instância é derivada da sessão — nunca vem por parâmetro. Além de
 * ser a regra de autorização do módulo, é o que faz a lista ter
 * sentido: só dá para postar em grupo do qual se participa, então
 * mostrar os grupos de outra pessoa ofereceria destinos que o envio
 * recusaria depois.
 *
 * A chave da Evolution não sai do servidor.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Menos que o teto da função: a listagem pode demorar quando o WhatsApp
// está limitando, e é melhor devolver erro tratado que ser morto.
export const maxDuration = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const resultado = await fetchAllGroups(user.id);

  if (!resultado.ok) {
    // 200 com `ok:false`, não 5xx: a lista indisponível é um estado
    // esperado (WhatsApp limitando, celular desconectado), não uma
    // falha do servidor — e o formulário precisa exibir o motivo em vez
    // de tratar como erro de rede.
    return NextResponse.json(resultado, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(resultado, {
    headers: { "Cache-Control": "no-store" },
  });
}
