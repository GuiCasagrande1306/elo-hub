import { NextResponse, type NextRequest } from "next/server";

import {
  getClientBySlug,
  getReportTemplates,
  getTemplateForClient,
  lastNDays,
} from "@/lib/data";
import { buildReportPayload } from "@/lib/reports/payload";
import { renderReportPdf } from "@/lib/reports/pdf/render";
import type { ReportTemplate } from "@/types/database";

/**
 * Pré-visualização do relatório, sem gravar nada: sem linha em
 * `report_history`, sem upload, sem envio. Serve para conferir antes de
 * mandar para o cliente — o erro caro é o relatório errado já entregue.
 *
 * ⚠️ SÓ GET, E ISSO É REQUISITO, NÃO PREFERÊNCIA.
 *
 * Esta resposta ocupa uma aba inteira, e o leitor de PDF do Chrome
 * REFAZ a requisição quando a pessoa clica em baixar — sempre como GET,
 * sem corpo. Enquanto a tela abria a aba por formulário POST, o PDF
 * aparecia e o download falhava: o refazer chegava aqui sem parâmetro
 * nenhum, levava o 400 "Informe o cliente" logo abaixo, e o Chrome
 * registrava "O site não está disponível". Medido em 02/10/2026, três
 * tentativas no relatório da Brazzo.
 *
 * O `Cache-Control: no-store` da resposta torna esse refazer
 * OBRIGATÓRIO — não há cópia em cache para o navegador salvar. Logo,
 * tudo que o preview precisa tem que caber na URL.
 *
 * Havia um POST aqui para a análise escrita pelo time viajar no corpo.
 * A análise saiu da tela e o POST foi junto: parâmetro que não cabe em
 * query é parâmetro que impede o download.
 *
 * `?periodo=<dias>` continua aceito — é a forma antiga, que ainda
 * circula em links salvos.
 *
 * A autorização é a do `getClientBySlug`, que passa pelo RLS: um
 * colaborador não pré-visualiza conta alheia.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const janela = resolverJanela(
    searchParams.get("inicio"),
    searchParams.get("fim"),
    searchParams.get("periodo"),
  );

  return gerar({
    slug: searchParams.get("cliente"),
    ...janela,
    templateId: searchParams.get("template"),
    insights: searchParams.get("insights"),
    nextSteps: searchParams.get("nextSteps"),
  });
}

/* ------------------------------------------------------------------ */

async function gerar(entrada: {
  slug: string | null;
  start: string;
  end: string;
  templateId: string | null;
  insights: string | null;
  nextSteps: string | null;
}) {
  const { slug, start, end } = entrada;

  if (!slug) {
    return NextResponse.json(
      { error: "Informe o cliente." },
      { status: 400 },
    );
  }

  if (end < start) {
    return NextResponse.json(
      { error: "O fim do período é anterior ao início." },
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

  const template = await resolverTemplate(client, entrada.templateId);
  if (!template) {
    return NextResponse.json(
      { error: "Nenhum template configurado." },
      { status: 500 },
    );
  }

  let buffer: Buffer;

  try {
    const payload = await buildReportPayload({
      client,
      template,
      periodStart: start,
      periodEnd: end,
      insights: entrada.insights?.trim() || undefined,
      nextSteps: (entrada.nextSteps ?? "")
        .split("\n")
        .map((linha) => linha.trim())
        .filter(Boolean),
    });

    ({ buffer } = await renderReportPdf(payload));
  } catch (erro) {
    /* ESTA ABA ABRE EM BRANCO SE NINGUÉM SEGURAR O ERRO.
       O botão "Visualizar" envia um formulário com target="_blank": a
       resposta vira a página inteira de uma aba nova. Sem este catch, um
       erro de render devolvia o 500 cru do Next e a experiência era
       exatamente "o sistema quebra" — sem dizer o que quebrou, sem
       deixar rastro na tela de quem clicou.

       O texto do erro aparece de propósito. Este é um painel interno,
       autenticado; quem clica aqui é do time e vai ter que relatar o
       problema. "Could not resolve font for Geist" resolve em minutos;
       "algo deu errado" custa uma sessão de investigação. */
    console.error("[preview] falha ao gerar PDF", erro);

    return new NextResponse(paginaDeErro(erro), {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      /* O nome vai junto com a janela: a pessoa baixa vários numa
         sessão, e "preview-brazzo-pizza.pdf" três vezes na pasta de
         Downloads vira "(1)" e "(2)". */
      "Content-Disposition": `inline; filename="relatorio-${slug}-${start}-a-${end}.pdf"`,
      // Nunca cachear: o preview precisa refletir o dado sincronizado agora.
      "Cache-Control": "no-store",
    },
  });
}

/** Página legível no lugar do 500 cru, já que a resposta ocupa uma aba. */
function paginaDeErro(erro: unknown): string {
  const detalhe = erro instanceof Error ? erro.message : String(erro);
  const seguro = detalhe.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Não foi possível gerar o PDF</title></head>
<body style="margin:0;padding:48px;font:15px/1.6 system-ui,sans-serif;color:#141413;background:#F7F6F3">
  <div style="max-width:560px">
    <h1 style="font-size:19px;margin:0 0 12px">Não foi possível gerar o PDF</h1>
    <p style="margin:0 0 20px;color:#5C5C57">
      O relatório não chegou a ser criado e nada foi enviado ao cliente.
      Feche esta aba e avise o time com a mensagem abaixo.
    </p>
    <pre style="margin:0;padding:14px;background:#fff;border:1px solid #E4E2DD;border-radius:8px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${seguro}</pre>
  </div>
</body>
</html>`;
}

/**
 * O template escolhido à mão, ou o automático do segmento.
 *
 * A busca passa por `getReportTemplates`, que respeita a RLS — um id
 * inventado na requisição simplesmente não é encontrado e cai no
 * automático, em vez de vazar o template de outra conta.
 */
async function resolverTemplate(
  client: Awaited<ReturnType<typeof getClientBySlug>>,
  templateId: string | null,
): Promise<ReportTemplate | null> {
  if (!client) return null;

  if (templateId) {
    const templates = await getReportTemplates();
    const escolhido = templates.find((t) => t.id === templateId);
    if (escolhido) return escolhido;
  }

  return getTemplateForClient(client);
}

/**
 * Janela do preview.
 *
 * `inicio`/`fim` ganham do `periodo` quando os dois vêm juntos. Data
 * malformada cai no padrão de 30 dias em vez de derrubar a rota: o
 * preview é um atalho para conferir o layout, e um 400 aqui só faria a
 * aba abrir em branco sem dizer por quê.
 */
function resolverJanela(
  inicio: string | null,
  fim: string | null,
  periodo: string | null,
): { start: string; end: string } {
  const DATA = /^\d{4}-\d{2}-\d{2}$/;

  if (inicio && fim && DATA.test(inicio) && DATA.test(fim)) {
    return { start: inicio, end: fim };
  }

  const dias = Number(periodo);
  return lastNDays([7, 30, 90].includes(dias) ? dias : 30);
}
