import localFont from "next/font/local";

/* =====================================================================
   Tipografia do brief
   ---------------------------------------------------------------------
   O documento NÃO usa a fonte do painel. É proposital: ele sai do
   sistema — vai para o link que o cliente abre e para o PDF que circula
   no WhatsApp — e ali precisa parecer material editorial, não tela de
   ferramenta.

   Três famílias, três funções:
     Source Serif 4  corpo. Serifada porque o documento é para LER,
                     não para escanear; são páginas de texto corrido.
     Archivo         títulos e ganchos. Peso 800 dá a batida de manchete.
     IBM Plex Mono   rótulos, tabelas e números. Tabular por padrão, que
                     é o que alinha coluna de views.

   Carregadas pelo `next/font`, não por `<link>` para o Google — e de
   ARQUIVO LOCAL (src/fonts), não `next/font/google`, porque o download
   a cada build derrubou o deploy da Vercel em 12–13/11/2026 (ver
   `src/app/layout.tsx`):

     1. O PUPPETEER GERA O PDF. Fonte remota chega no meio do
        `networkidle` e às vezes não chega — o PDF sai em Times, e o
        arquivo é gerado sem erro nenhum para denunciar isso.
     2. Sem requisição a terceiro numa página que o cliente abre.
     3. Sem salto de layout: o Next injeta a métrica de fallback.
   ===================================================================== */

const serif = localFont({
  src: [
    { path: "../../fonts/SourceSerif4-normal-200-900.woff2", weight: "200 900", style: "normal" },
    { path: "../../fonts/SourceSerif4-italic-200-900.woff2", weight: "200 900", style: "italic" },
  ],
  variable: "--font-brief-serif",
  display: "swap",
});

const sans = localFont({
  src: "../../fonts/Archivo-normal-100-900.woff2",
  variable: "--font-brief-sans",
  weight: "100 900",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "../../fonts/IBMPlexMono-normal-400.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/IBMPlexMono-normal-500.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/IBMPlexMono-normal-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-brief-mono",
  display: "swap",
});

/**
 * As três variáveis numa string só, para o elemento raiz do documento.
 *
 * Fica no raiz do BRIEF e não no `<body>` do app de propósito: as
 * variáveis só existem dentro do documento, então nenhuma tela do painel
 * pode passar a depender delas por acidente.
 */
export const briefFontVars = `${serif.variable} ${sans.variable} ${mono.variable}`;
