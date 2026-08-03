import "server-only";

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { serverEnv } from "@/lib/env";
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
 * Superfície mínima do Puppeteer que usamos.
 *
 * Tipada à mão de propósito: importar os tipos de `puppeteer-core`
 * amarraria a compilação a uma dependência que é opcional por design.
 */
interface PuppeteerLike {
  launch(options?: Record<string, unknown>): Promise<{
    newPage(): Promise<{
      setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
      goto(
        url: string,
        options?: { waitUntil?: string; timeout?: number },
      ): Promise<unknown>;
      emulateMediaType(type: string): Promise<void>;
      evaluate<T>(fn: () => T): Promise<T>;
      pdf(options?: Record<string, unknown>): Promise<Uint8Array>;
    }>;
    close(): Promise<void>;
  }>;
}

interface ChromiumLike {
  args: string[];
  executablePath(input?: string): Promise<string>;
  headless: boolean | "shell";
  defaultViewport: unknown;
}

/**
 * Carrega o Puppeteer em tempo de execução.
 *
 * Via `createRequire`, não `import()`: um import estático de módulo
 * ausente falha na hora do BUILD, e o `.catch()` nunca chegaria a rodar.
 * Aqui a ausência é um erro de runtime tratável — comportamento correto
 * para uma dependência opcional.
 */
function loadModule<T>(specifier: string): T | null {
  // Duas bases de resolução, nesta ordem. Sob Turbopack `import.meta.url`
  // aponta para um caminho virtual do bundle, de onde `node_modules` não
  // é alcançável — e aí TODA dependência opcional parece ausente, com a
  // mensagem enganosa de "instale o pacote" para um pacote já instalado.
  // A raiz do projeto é o segundo caminho, e é a que funciona tanto em
  // desenvolvimento quanto na função serverless.
  const bases = [
    import.meta.url,
    pathToFileURL(join(process.cwd(), "index.js")).href,
  ];

  for (const base of bases) {
    try {
      const requireModule = createRequire(base);
      const mod = requireModule(specifier) as T | { default: T };
      return (mod as { default?: T }).default ?? (mod as T);
    } catch {
      // Base seguinte.
    }
  }

  return null;
}

/** Serverless (Vercel/Lambda) tem `AWS_LAMBDA_FUNCTION_NAME` no ambiente. */
function isServerless(): boolean {
  return Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL === "1",
  );
}

/**
 * Onde um Chrome instalado costuma estar em máquina de desenvolvimento.
 * Consultado só quando o pacote `puppeteer` completo não existe.
 */
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findLocalChrome(): string | null {
  if (serverEnv.chromeExecutablePath) return serverEnv.chromeExecutablePath;
  return LOCAL_CHROME_PATHS.find((path) => existsSync(path)) ?? null;
}

/**
 * Renderiza a página de impressão com Chromium headless.
 *
 * A página é servida pela própria aplicação, então o PDF herda o CSS
 * real — mesma tipografia, mesmos gráficos, mesmo layout A4.
 *
 * DOIS AMBIENTES, UM CAMINHO
 * ---------------------------------------------------------------------
 * Vercel: `puppeteer-core` + `@sparticuz/chromium`, porque a função
 * serverless não tem navegador instalado e o binário completo estoura o
 * limite de tamanho do bundle.
 *
 * Local: `puppeteer` completo, se estiver instalado — ele traz o próprio
 * Chromium. Quando não está, cai para `puppeteer-core` apontando para um
 * Chrome já presente na máquina. Sem esse segundo caminho, gerar o PDF em
 * desenvolvimento exigiria baixar 170MB de navegador que a produção nem
 * usa, e a rota de preview simplesmente não rodaria.
 *
 * A escolha é pelo AMBIENTE, não por configuração: quem faz deploy não
 * deveria precisar lembrar de trocar uma variável.
 */
async function renderWithPuppeteer(
  payload: ReportPayload,
): Promise<RenderedPdf> {
  const serverless = isServerless();

  let launchOptions: Record<string, unknown> = {
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: true,
  };

  let puppeteer: PuppeteerLike | null;

  if (serverless) {
    puppeteer = loadModule<PuppeteerLike>("puppeteer-core");
    const chromium = loadModule<ChromiumLike>("@sparticuz/chromium");

    if (!puppeteer || !chromium) {
      throw new Error(
        "Em serverless, PDF_ENGINE=puppeteer exige `puppeteer-core` e " +
          "`@sparticuz/chromium` instalados.",
      );
    }

    launchOptions = {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    };
  } else {
    puppeteer = loadModule<PuppeteerLike>(serverEnv.puppeteerModule);

    if (!puppeteer) {
      puppeteer = loadModule<PuppeteerLike>("puppeteer-core");
      const executablePath = findLocalChrome();

      if (!puppeteer || !executablePath) {
        throw new Error(
          "PDF_ENGINE=puppeteer precisa de um navegador. Instale `puppeteer` " +
            "(npm i -D puppeteer) ou aponte PUPPETEER_EXECUTABLE_PATH para um " +
            "Chrome já instalado.",
        );
      }

      launchOptions.executablePath = executablePath;
    }
  }

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

  const browser = await puppeteer.launch(launchOptions);

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
