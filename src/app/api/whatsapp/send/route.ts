import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/supabase/server";
import { sendFromUser } from "@/lib/whatsapp/session";

/**
 * POST /api/whatsapp/send
 *
 * Envio manual, pelo número do próprio usuário logado.
 *
 * A instância remetente NÃO vem do corpo: é derivada da sessão. Aceitar
 * o remetente como parâmetro permitiria a qualquer usuário mandar
 * mensagem saindo do celular de um colega.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.string().min(8, "Informe o destino (telefone ou JID de grupo)."),
  message: z.string().min(1).max(4096),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const resultado = await sendFromUser(
    user.id,
    parsed.data.to,
    parsed.data.message,
  );

  return NextResponse.json(resultado, {
    status: resultado.success ? 200 : 502,
  });
}
