import "server-only";

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { serverEnv } from "@/lib/env";

/* =====================================================================
   Abrir um Chromium headless
   ---------------------------------------------------------------------
   Extraído de `lib/reports/pdf/render.ts` quando o segundo consumidor
   apareceu (os briefs de conteúdo). É a parte que NÃO deve ser copiada:
   a escolha entre `puppeteer` completo e `puppeteer-core` +
   `@sparticuz/chromium` depende do ambiente, já quebrou uma vez sob o
   Turbopack, e duas cópias divergem na primeira correção que só uma
   receber.

   DOIS AMBIENTES, UM CAMINHO
     Vercel  `puppeteer-core` + `@sparticuz/chromium`, porque a função
             serverless não tem navegador e o binário completo estoura
             o limite de tamanho do bundle.
     Local   `puppeteer` completo, se instalado — ele traz o próprio
             Chromium. Quando não está, cai para `puppeteer-core`
             apontando para um Chrome já presente na máquina.

   A escolha é pelo AMBIENTE, não por configuração: quem faz deploy não
   deveria precisar lembrar de trocar uma variável.
   ===================================================================== */

/**
 * Superfície mínima do Puppeteer que usamos.
 *
 * Tipada à mão de propósito: importar os tipos de `puppeteer-core`
 * amarraria a compilação a uma dependência que é opcional por design.
 */
export interface PaginaLike {
  setViewport(v: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<void>;
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  emulateMediaType(type: string): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  pdf(options?: Record<string, unknown>): Promise<Uint8Array>;
}

export interface NavegadorLike {
  newPage(): Promise<PaginaLike>;
  close(): Promise<void>;
}

interface PuppeteerLike {
  launch(options?: Record<string, unknown>): Promise<NavegadorLike>;
}

interface ChromiumLike {
  args: string[];
  executablePath(input?: string): Promise<string>;
  headless: boolean | "shell";
  defaultViewport: unknown;
}

/**
 * Carrega um módulo em tempo de execução.
 *
 * Via `createRequire`, não `import()`: um import estático de módulo
 * ausente falha na hora do BUILD, e o tratamento de ausência nunca
 * chegaria a rodar. Aqui a ausência é um erro de runtime tratável —
 * comportamento correto para dependência opcional.
 */
function loadModule<T>(specifier: string): T | null {
  /* Duas bases de resolução, nesta ordem. Sob Turbopack
     `import.meta.url` aponta para um caminho virtual do bundle, de onde
     `node_modules` não é alcançável — e aí TODA dependência opcional
     parece ausente, com a mensagem enganosa de "instale o pacote" para
     um pacote já instalado. A raiz do projeto é o segundo caminho, e é
     a que funciona em desenvolvimento e na função serverless. */
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
 * Abre o navegador. Quem chama é responsável por `close()` — em
 * `finally`, sempre: browser que não fecha vaza processo e, em
 * serverless, mantém a função viva até o timeout, que é cobrado.
 */
export async function abrirNavegador(): Promise<NavegadorLike> {
  const serverless = isServerless();

  let launchOptions: Record<string, unknown> = {
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
    headless: true,
  };

  let puppeteer: PuppeteerLike | null;

  if (serverless) {
    puppeteer = loadModule<PuppeteerLike>("puppeteer-core");
    const chromium = loadModule<ChromiumLike>("@sparticuz/chromium");

    if (!puppeteer || !chromium) {
      throw new Error(
        "Em serverless, gerar PDF pelo navegador exige `puppeteer-core` e " +
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
          "Gerar PDF pelo navegador precisa de um Chrome. Instale " +
            "`puppeteer` (npm i -D puppeteer) ou aponte " +
            "PUPPETEER_EXECUTABLE_PATH para um Chrome já instalado.",
        );
      }

      launchOptions.executablePath = executablePath;
    }
  }

  return puppeteer.launch(launchOptions);
}
