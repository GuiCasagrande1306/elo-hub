import "server-only";

import { serverEnv } from "@/lib/env";
import { abrirNavegador } from "@/lib/pdf/browser";
import { createPrintToken } from "@/lib/reports/print-token";
import type { ReportPayload } from "@/lib/reports/payload";

/* =====================================================================
   Renderizador de PDF — dois motores atrás de uma interface
   ---------------------------------------------------------------------
   react-pdf (padrão)
     + roda em qualquer runtime Node, inclusive serverless
     + saída vetorial: texto selecionável, imprime nítido
     + sem binário externo, cold start baixo
     − layout próprio: não é HTML/CSS

   puppeteer (opcional)
     + fidelidade total — renderiza a rota HTML do relatório, então o
       PDF fica idêntico ao que se vê no navegador
     − exige Chromium (~170MB) e mais memória; em serverless precisa de
       @sparticuz/chromium

   A escolha é de ambiente (PDF_ENGINE), não de código. Trocar de motor
   não altera nenhum chamador.
   ===================================================================== */

export interface RenderedPdf {
  buffer: Buffer;
  pageCount: number | null;
}

export async function renderReportPdf(
  payload: ReportPayload,
): Promise<RenderedPdf> {
  return serverEnv.pdfEngine === "puppeteer"
    ? renderWithPuppeteer(payload)
    : renderWithReactPdf(payload);
}

/* ------------------------------------------------------------------ */
/* Motor padrão                                                        */
/* ------------------------------------------------------------------ */

async function renderWithReactPdf(
  payload: ReportPayload,
): Promise<RenderedPdf> {
  // Import dinâmico: o react-pdf carrega fontes e o motor de layout no
  // topo do módulo. Estático, isso entraria no bundle de toda rota que
  // importar este arquivo, mesmo quem nunca gera PDF.
  const [{ renderToBuffer }, { ReportDocument }, { createElement }] =
    await Promise.all([
      import("@react-pdf/renderer"),
      import("./document"),
      import("react"),
    ]);

  // `createElement` em vez de JSX para manter este módulo como .ts puro:
  // é código exclusivamente de servidor, sem nenhuma marcação.
  //
  // O cast existe porque `renderToBuffer` declara receber
  // ReactElement<DocumentProps>, enquanto o nosso componente recebe
  // `payload` e devolve <Document>. A checagem real acontece dentro de
  // `ReportDocument`, que é tipado.
  const element = createElement(ReportDocument, { payload });
  const buffer = await renderToBuffer(
    element as unknown as Parameters<typeof renderToBuffer>[0],
  );

  return {
    buffer: Buffer.from(buffer),
    // Contar páginas exigiria reparsear o PDF; a capa + corpo dão pelo
    // menos 2. O número exato não é crítico — é só metadado de listagem.
    pageCount: null,
  };
}

/* ------------------------------------------------------------------ */
/* Motor de alta fidelidade                                            */
/* ------------------------------------------------------------------ */

/**
 * Renderiza a página de impressão com Chromium headless.
 *
 * A página é servida pela própria aplicação, então o PDF herda o CSS
 * real — mesma tipografia, mesmos gráficos, mesmo layout A4.
 *
 * Qual Chromium abrir — o do pacote `puppeteer` em desenvolvimento, o do
 * `@sparticuz/chromium` em serverless — é problema de
 * `lib/pdf/browser.ts`, compartilhado com o PDF dos briefs de conteúdo.
 */
async function renderWithPuppeteer(
  payload: ReportPayload,
): Promise<RenderedPdf> {
  // O token dá ao Puppeteer — que chega sem sessão — acesso à página de
  // impressão. Sem ele o proxy responderia /login e o PDF sairia com a
  // tela de login dentro.
  const token = createPrintToken({
    clientId: payload.client.id,
    periodStart: payload.meta.periodStart,
    periodEnd: payload.meta.periodEnd,
  });

  const url =
    `${serverEnv.appUrl}/reports/render/${payload.client.id}` +
    `?token=${encodeURIComponent(token)}`;

  const browser = await abrirNavegador();

  try {
    const page = await browser.newPage();

    // Viewport na largura de uma folha A4 a 96dpi (210mm ≈ 794px). Sem
    // isso o Chromium usa 800×600 e o layout responsivo do Tailwind
    // escolhe breakpoints de celular para o papel.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

    // `networkidle0`: espera as miniaturas dos criativos e as fontes.
    // Sem isso o PDF sai com retângulos vazios no lugar dos anúncios.
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });

    // Garante que as webfonts terminaram de carregar. `networkidle0` só
    // olha requisições; a fonte pode estar baixada e ainda não aplicada,
    // e aí o PDF sai com a fonte de fallback.
    await page.evaluate(() => document.fonts.ready.then(() => true));

    // `screen`, não `print`: o layout já é A4 e as media queries de
    // impressão do Tailwind esconderiam elementos por engano.
    await page.emulateMediaType("screen");

    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return { buffer: Buffer.from(buffer), pageCount: null };
  } finally {
    // `finally` obrigatório: browser que não fecha vaza processo e, em
    // serverless, mantém a função viva até o timeout — cobrado.
    await browser.close();
  }
}
