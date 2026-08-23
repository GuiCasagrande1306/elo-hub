import { Fragment, type ReactNode } from "react";

/* =====================================================================
   Marcação em linha do brief
   ---------------------------------------------------------------------
   Três marcas, descritas em `lib/content/blocks.ts`:

     **negrito**   ênfase
     _itálico_     indicação de cena
     [colchete]    pendência a confirmar com o cliente

   NÃO é markdown, e não deve virar. O texto aqui é lido em voz alta na
   frente de uma câmera; link, título e lista não têm para onde ir num
   roteiro falado. Um parser de markdown completo só acrescentaria
   formas de o texto sair diferente do que foi escrito.

   Sem aninhamento: `**_assim_**` sai literal. Suportar combinação
   exigiria recursão sobre o texto e nenhum documento pediu isso — o
   negrito é do argumento, o itálico é da cena, e os dois no mesmo
   trecho não querem dizer nada.
   ===================================================================== */

/**
 * Uma alternância, uma passada.
 *
 * O `_` exige que não haja caractere de palavra colado, senão
 * `client_id` e `report_enabled` — que aparecem em documento técnico —
 * virariam itálico no meio da frase.
 */
const MARCAS = /\*\*([^*\n]+)\*\*|(?<!\w)_([^_\n]+)_(?!\w)|\[([^\]\n]+)\]/g;

export function RichText({ children }: { children: string }) {
  const partes: ReactNode[] = [];
  let cursor = 0;
  let chave = 0;

  // `matchAll` em vez de `exec` em laço: `MARCAS` é uma constante de
  // módulo com a flag `g`, e `exec` guarda `lastIndex` NA REGEX. Duas
  // chamadas concorrentes (dois blocos renderizando) começariam a
  // segunda de onde a primeira parou, pulando trechos do texto.
  for (const m of children.matchAll(MARCAS)) {
    const indice = m.index ?? 0;
    if (indice > cursor) partes.push(children.slice(cursor, indice));

    const [bruto, negrito, italico, pendencia] = m;

    if (negrito !== undefined) {
      partes.push(<strong key={chave++}>{negrito}</strong>);
    } else if (italico !== undefined) {
      partes.push(<em key={chave++}>{italico}</em>);
    } else if (pendencia !== undefined) {
      /* Os colchetes ficam VISÍVEIS dentro da marca. É o combinado da
         agência: quem lê o roteiro na hora de gravar precisa reconhecer
         a pendência mesmo num print em preto e branco, onde o amarelo
         não existe. */
      partes.push(
        <mark className="brief-ph" key={chave++}>
          [{pendencia}]
        </mark>,
      );
    }

    cursor = indice + bruto.length;
  }

  if (cursor < children.length) partes.push(children.slice(cursor));

  return (
    <>
      {partes.map((parte, i) => (
        <Fragment key={i}>{parte}</Fragment>
      ))}
    </>
  );
}

/** Versão em texto puro — para `<title>`, nome de arquivo e prévia. */
export function semMarcacao(texto: string): string {
  return texto.replace(MARCAS, (_bruto, negrito, italico, pendencia) =>
    negrito ?? italico ?? `[${pendencia}]`,
  );
}
