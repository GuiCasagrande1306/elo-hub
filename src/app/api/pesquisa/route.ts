import { NextResponse } from "next/server";

import { gravarResposta } from "@/lib/nps/dados";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const corpo = await request.json().catch(() => null);
  const resultado = await gravarResposta(corpo);
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 400 });
}
