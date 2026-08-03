import "server-only";

import { createRequire } from "node:module";

import { serverEnv } from "@/lib/env";
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
  reportId: string,
): Promise<RenderedPdf> {
  return serverEnv.pdfEngine === "puppeteer"
    ? renderWithPuppeteer(reportId)
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
 * Superfície mínima do Puppeteer que usamos.
 *
 * Tipada à mão de propósito: `import type { Browser } from "puppeteer"`
 * exigiria a dependência instalada só para o projeto compilar, o que
 * anularia o "opcional".
 */
interface PuppeteerLike {
  launch(options?: { args?: string[] }): Promise<{
    newPage(): Promise<{
      goto(
        url: string,
        options?: { waitUntil?: string; timeout?: number },
      ): Promise<unknown>;
      pdf(options?: Record<string, unknown>): Promise<Uint8Array>;
    }>;
    close(): Promise<void>;
  }>;
}

/**
 * Carrega o Puppeteer em tempo de execução.
 *
 * Via `createRequire`, não `import("puppeteer")`: um import estático de
 * módulo ausente falha na hora do BUILD, e o `.catch()` nunca chegaria a
 * rodar. Aqui a ausência é um erro de runtime tratável — que é o
 * comportamento correto para uma dependência opcional.
 */
function loadPuppeteer(): PuppeteerLike | null {
  try {
    const requireModule = createRequire(import.meta.url);

    // O especificador vem de `serverEnv` (leitura de propriedade em
    // runtime), nunca de literal: um literal faria o bundler tentar
    // resolver "puppeteer" em tempo de build e emitir module-not-found
    // para uma dependência que é opcional por design.
    const mod = requireModule(serverEnv.puppeteerModule) as
      | PuppeteerLike
      | { default: PuppeteerLike };

    return "launch" in mod ? mod : mod.default;
  } catch {
    return null;
  }
}

/**
 * Renderiza a rota `/relatorios/<id>/print` com Chromium headless.
 *
 * A rota é servida pela própria aplicação, então o PDF herda o design
 * system inteiro — mesmos tokens, mesma tipografia, mesmos gráficos.
 * O custo é operacional: alguém precisa manter o Chromium disponível.
 */
async function renderWithPuppeteer(reportId: string): Promise<RenderedPdf> {
  const puppeteer = loadPuppeteer();

  if (!puppeteer) {
    throw new Error(
      "PDF_ENGINE=puppeteer requer a dependência `puppeteer` instalada " +
        "(ou `puppeteer-core` + `@sparticuz/chromium` em serverless). " +
        "Instale-a ou volte para PDF_ENGINE=react-pdf.",
    );
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();

    // `networkidle0` garante que fontes e imagens dos criativos já
    // carregaram; sem isso o PDF sai com blocos vazios.
    await page.goto(`${serverEnv.appUrl}/relatorios/${reportId}/print`, {
      waitUntil: "networkidle0",
      timeout: 45_000,
    });

    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return { buffer: Buffer.from(buffer), pageCount: null };
  } finally {
    // `finally` obrigatório: um browser que não fecha vaza processo e
    // derruba o servidor depois de algumas gerações com erro.
    await browser.close();
  }
}
