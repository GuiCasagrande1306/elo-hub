import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { isGroupJid, sendReportToGroup } from "@/lib/whatsapp";

/**
 * POST /api/test-whatsapp   ⚠️ ROTA TEMPORÁRIA
 *
 * Valida a conexão com a Evolution enviando um PDF real para um grupo.
 * Apagar quando a integração estiver estável.
 *
 * PROTEGIDA POR SESSÃO DE ADMIN, não deixada aberta: ela dispara
 * mensagem de verdade no WhatsApp da agência. Uma rota de teste sem
 * autenticação vira, na prática, um endpoint de spam com o número da
 * empresa — e é o tipo de coisa que fica em produção por meses depois
 * do "teste rápido".
 *
 * `GET` devolve o diagnóstico da configuração sem enviar nada, que é o
 * primeiro passo quando o envio falha.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF público e estável, para testar sem depender do nosso Storage. */
const PDF_DE_TESTE =
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const bodySchema = z.object({
  groupId: z.string().min(1, "Informe o groupId."),
  pdfUrl: z.string().url().optional(),
  caption: z.string().max(1024).optional(),
  clientName: z.string().max(120).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  // Só reporta o QUE está definido, nunca o valor — a chave da Evolution
  // não pode aparecer numa resposta HTTP.
  return NextResponse.json({
    provider: serverEnv.whatsappProvider,
    evolution: {
      url: serverEnv.whatsappEvolutionUrl || null,
      instance: serverEnv.whatsappEvolutionInstance || null,
      apiKeyDefinida: Boolean(serverEnv.whatsappToken),
      versaoDoPayload: serverEnv.evolutionApiVersion,
    },
    pronto:
      serverEnv.whatsappProvider === "evolution" &&
      Boolean(
        serverEnv.whatsappEvolutionUrl &&
          serverEnv.whatsappEvolutionInstance &&
          serverEnv.whatsappToken,
      ),
    comoUsar:
      'POST { "groupId": "1203630000000@g.us" } para enviar um PDF de teste.',
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
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

  const { groupId, pdfUrl, caption, clientName } = parsed.data;

  // Erro de formato de JID vale 400 (o chamador errou), não 502.
  if (!isGroupJid(groupId)) {
    return NextResponse.json(
      {
        error: `"${groupId}" não é um id de grupo.`,
        dica: "Use o JID completo, terminando em @g.us. Pegue em /group/fetchAllGroups na Evolution.",
      },
      { status: 400 },
    );
  }

  const result = await sendReportToGroup(
    groupId,
    pdfUrl ?? PDF_DE_TESTE,
    caption ??
      "*Teste de integração — Elo Hub*\n\nSe esta mensagem chegou com o PDF em anexo, a Evolution está conectada e o grupo está correto.",
    clientName ?? "Teste",
  );

  // 502 quando a falha é do provedor: distingue "nosso código quebrou"
  // de "a instância está fora do ar", que é o que o log precisa dizer.
  return NextResponse.json(result, { status: result.success ? 200 : 502 });
}
