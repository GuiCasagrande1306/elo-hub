import "server-only";

import { serverEnv } from "@/lib/env";
import { abrirNavegador } from "@/lib/pdf/browser";
import { criarTokenDeImpressao } from "@/lib/content/print-token";

/* =====================================================================
   O brief em PDF
   ---------------------------------------------------------------------
   SEMPRE pelo navegador, sem o segundo motor que os relatórios têm.

   O relatório tem dois motores porque o `react-pdf` desenha bem uma
   grade de números. Um brief é texto editorial: colunas comparativas,
   tabela, cards com trilho, marcação em linha. Reconstruir isso nas
   primitivas do react-pdf produziria um documento parecido de longe e
   diferente de perto — e ele é o que vai para a mão do cliente.

   Por isso também NÃO depende de `PDF_ENGINE`: essa variável escolhe o
   motor dos relatórios, não está setada na Vercel, e amarrar o PDF do
   brief a ela faria o botão simplesmente não funcionar em produção.
   ===================================================================== */

export async function renderBriefPdf(briefId: string): Promise<Buffer> {
  /* O token dá ao Chromium — que chega sem cookie de sessão — acesso à
     página de impressão. Sem ele o proxy responde 307 para /login e o
     PDF sai com a tela de login dentro, sem erro nenhum para denunciar. */
  const token = criarTokenDeImpressao(briefId);
  const url =
    `${serverEnv.appUrl}/briefs/render/${briefId}` +
    `?token=${encodeURIComponent(token)}`;

  const browser = await abrirNavegador();

  try {
    const page = await browser.newPage();

    // Largura de A4 a 96dpi (210mm ≈ 794px) menos as margens da página.
    // Sem viewport, o Chromium usa 800×600 e a folha recebe o layout de
    // celular — no brief isso deita o trilho dos roteiros.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });

    // `networkidle0` só olha requisição: a fonte pode estar baixada e
    // ainda não aplicada, e aí o PDF sai no fallback serifado do
    // sistema em vez do Archivo dos títulos.
    await page.evaluate(() => document.fonts.ready.then(() => true));

    /* `print`, ao contrário do relatório. Aqui as media queries de
       impressão são o que impede um roteiro de ser cortado no meio pela
       quebra de página (`break-inside: avoid`) — emular `screen`
       desligaria justamente a regra que faz o arquivo ficar legível. */
    await page.emulateMediaType("print");

    /* MARGEM ZERO aqui, e o respiro vem do padding do `.brief-page` em
       `@media print`. Com margem no `page.pdf()`, o Chrome renderiza o
       layout na largura cheia do viewport (794px = A4 a 96dpi) e DEPOIS
       recorta as bordas: o resultado é a segunda coluna comparativa e o
       último passo da fórmula cortados no fio da folha. Padding no CSS
       entra antes do layout, então o conteúdo já nasce dentro da área
       imprimível. */
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return Buffer.from(buffer);
  } finally {
    // Obrigatório: browser que não fecha vaza processo e, em serverless,
    // segura a função viva até o timeout — que é cobrado.
    await browser.close();
  }
}
