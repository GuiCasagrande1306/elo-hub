import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import {
  getSessionStatus,
  logoutSession,
  startPairing,
} from "@/lib/whatsapp/session";

/**
 * WhatsApp pessoal do usuário logado.
 *
 *   GET     estado da conexão
 *   POST    cria a instância (se preciso) e devolve o QR
 *   DELETE  desconecta o celular
 *
 * NENHUMA das rotas recebe identificador de instância. O alvo é sempre
 * derivado da sessão — é o que impede um usuário de parear, ler o QR ou
 * derrubar a conexão de outro trocando um parâmetro.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const status = await getSessionStatus(user.id);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const resultado = await startPairing(user.id);

  // 502 quando a Evolution recusou: separa "nosso código quebrou" de
  // "o servidor de WhatsApp está fora".
  return NextResponse.json(resultado, {
    status: resultado.success ? 200 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const resultado = await logoutSession(user.id);
  return NextResponse.json(resultado, {
    status: resultado.success ? 200 : 502,
  });
}
