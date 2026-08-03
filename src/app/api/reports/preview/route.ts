import { NextResponse, type NextRequest } from "next/server";

import { getClientBySlug, getTemplateForClient, lastNDays } from "@/lib/data";
import { buildReportPayload } from "@/lib/reports/payload";
import { renderReportPdf } from "@/lib/reports/pdf/render";

/**
 * GET /api/reports/preview?cliente=<slug>&periodo=30
 *
 * Gera e devolve o PDF sem gravar nada: sem linha em `report_history`,
 * sem upload, sem envio. Serve para conferir o layout antes de mandar
 * para o cliente — o erro caro é o relatório errado já entregue.
 *
 * A autorização é a mesma do resto: `getClientBySlug` passa pelo RLS,
 * então um colaborador não consegue pré-visualizar conta alheia.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const slug = searchParams.get("cliente");
  if (!slug) {
    return NextResponse.json(
      { error: "Informe ?cliente=<slug>." },
      { status: 400 },
    );
  }

  const client = await getClientBySlug(slug);
  if (!client) {
    return NextResponse.json(
      { error: "Cliente não encontrado ou sem permissão." },
      { status: 404 },
    );
  }

  const template = await getTemplateForClient(client);
  if (!template) {
    return NextResponse.json(
      { error: "Nenhum template configurado." },
      { status: 500 },
    );
  }

  const days = [7, 30, 90].includes(Number(searchParams.get("periodo")))
    ? Number(searchParams.get("periodo"))
    : 30;
  const { start, end } = lastNDays(days);

  const payload = await buildReportPayload({
    client,
    template,
    periodStart: start,
    periodEnd: end,
  });

  const { buffer } = await renderReportPdf(payload);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="preview-${slug}.pdf"`,
      // Nunca cachear: o preview precisa refletir o dado sincronizado agora.
      "Cache-Control": "no-store",
    },
  });
}
