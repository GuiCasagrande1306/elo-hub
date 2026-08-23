import { Archivo, IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";

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

   Carregadas pelo `next/font`, não por `<link>` para o Google:

     1. O PUPPETEER GERA O PDF. Fonte remota chega no meio do
        `networkidle` e às vezes não chega — o PDF sai em Times, e o
        arquivo é gerado sem erro nenhum para denunciar isso.
     2. Sem requisição a terceiro numa página que o cliente abre.
     3. Sem salto de layout: o Next injeta a métrica de fallback.
   ===================================================================== */

const serif = Source_Serif_4({
  variable: "--font-brief-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const sans = Archivo({
  variable: "--font-brief-sans",
  subsets: ["latin"],
  weight: ["500", "600", "800"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-brief-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
