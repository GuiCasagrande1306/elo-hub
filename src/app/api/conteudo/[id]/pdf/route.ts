import { NextResponse } from "next/server";

import { getContentBrief } from "@/lib/content/queries";
import { renderBriefPdf } from "@/lib/content/pdf";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Baixar o brief em PDF.
 *
 * A autorização acontece ANTES do navegador abrir: `getContentBrief`
 * passa pela RLS com o JWT de quem pediu, então quem não enxerga o
 * cliente recebe 404 sem que um Chromium chegue a subir. A ordem
 * importa — invertida, um id chutado custaria alguns segundos de função
 * serverless por tentativa.
 *
 * 401 (e não redirect para /login) porque isto é API: devolver HTML de
 * login a quem pediu um PDF quebra o cliente de um jeito difícil de
 * diagnosticar.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { id } = await params;

  const brief = await getContentBrief(id).catch(() => null);
  if (!brief) {
    return NextResponse.json(
      { error: "Documento não encontrado." },
      { status: 404 },
    );
  }

  try {
    const pdf = await renderBriefPdf(brief.id);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        /* `inline` para abrir no visualizador do navegador — o uso real
           é conferir antes de mandar, não arquivar. O nome do arquivo
           vale mesmo assim: é ele que aparece quando a pessoa salva. */
        "Content-Disposition": `inline; filename="${nomeDoArquivo(brief.titulo)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erro) {
    /* A mensagem do erro é útil de verdade aqui: quase sempre é
       "precisa de um Chrome" em máquina de desenvolvimento, e um 500
       mudo mandaria procurar no lugar errado. */
    return NextResponse.json(
      {
        error:
          erro instanceof Error ? erro.message : "Falha ao gerar o PDF.",
      },
      { status: 500 },
    );
  }
}

/** ASCII e sem espaço: `Content-Disposition` não aceita acento cru. */
function nomeDoArquivo(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${base || "documento"}.pdf`;
}
