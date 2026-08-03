import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { generateAndDeliverReport } from "@/lib/reports/orchestrator";

/**
 * POST /api/reports/generate
 *
 * Entrada HTTP do pipeline de relatório. A rota é fina de propósito:
 * valida, delega ao orquestrador e traduz o resultado em status HTTP.
 * Toda a lógica vive em `src/lib/reports/orchestrator.ts`, o que a torna
 * chamável também por Server Action, job de cron ou script de CLI.
 *
 * `runtime = "nodejs"` é obrigatório: o render de PDF usa Buffer e
 * streams do Node, que não existem no runtime Edge.
 */
export const runtime = "nodejs";

// A geração pode encostar em 30s com carteira grande e muitos criativos.
export const maxDuration = 60;

const bodySchema = z.object({
  clientSlug: z.string().min(1),
  templateId: z.string().optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  insights: z.string().max(4000).optional(),
  nextSteps: z.array(z.string().max(500)).max(10).optional(),
  deliver: z.enum(["whatsapp", "none"]).default("none"),
  recipient: z.string().max(30).optional(),
});

export async function POST(request: NextRequest) {
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

  const { periodStart, periodEnd } = parsed.data;
  if (periodEnd < periodStart) {
    return NextResponse.json(
      { error: "O fim do período é anterior ao início." },
      { status: 400 },
    );
  }

  const result = await generateAndDeliverReport(parsed.data);

  // Em demo o PDF volta em memória (não há Storage): devolvemos o
  // arquivo direto, para que o fluxo seja verificável ponta a ponta.
  if (result.ok && result.pdf) {
    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="relatorio-${parsed.data.clientSlug}.pdf"`,
      },
    });
  }

  if (!result.ok) {
    // 403 quando o RLS barrou; 500 quando o pipeline quebrou.
    const status = result.error?.includes("permissão") ? 403 : 500;
    return NextResponse.json(
      { error: result.error, reportId: result.reportId, status: result.status },
      { status },
    );
  }

  return NextResponse.json(result);
}
