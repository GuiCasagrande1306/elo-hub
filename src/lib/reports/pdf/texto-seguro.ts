/* =====================================================================
   Texto de anúncio que o PDF consegue desenhar
   ---------------------------------------------------------------------
   O PROBLEMA, medido em 19/08/2026.

   Geist não tem glifo de emoji — nenhum. Isso por si só daria um espaço
   em branco, o que seria aceitável. O que acontece é pior: o react-pdf
   parte o par de substitutos (surrogate pair) de um emoji do plano
   astral ANTES de resolver a fonte, e cada metade vira um glifo
   qualquer. Na prática, no relatório que foi ao cliente:

       "cenas fortes de pura suculência! 🔥🍔"  →  "…suculência! <%"
       "está chegando na área! 🚀"              →  "…na área! =€"
       "atravessa a ponte. ❤️‍🔥 Nossa nova…"     →  "…a ponte. ≠Nossa nova…"

   E não é só feio: a largura desses glifos não corresponde ao avanço
   calculado, então o lixo ATROPELA a palavra seguinte — visível no
   terceiro exemplo, onde "≠No" cai por cima de "Nossa".

   POR QUE NÃO UMA FONTE DE EMOJI. Foi tentado e medido: registrar
   `fontFamily: ["Geist", "NotoEmoji"]` conserta ❤ e ⭐ (plano básico) e
   NÃO conserta 🔥 🍔 🚀 👉 (plano astral) — justamente os que aparecem
   em anúncio. A quebra do par de substitutos acontece antes da pilha de
   fontes ser consultada, então o fallback nunca é alcançado. Meio
   conserto, mais 2MB de binário na função.

   POR QUE NÃO LIMPAR NA GRAVAÇÃO. O texto guardado é o anúncio como ele
   está no ar; a folha A4 e a tela mostram emoji sem problema, porque
   navegador tem fonte de emoji. Quem não consegue desenhar é o PDF —
   então é o PDF que limpa, na hora de imprimir.
   ===================================================================== */

/**
 * Sinais que compõem emoji sem serem pictogramas por conta própria.
 *
 * `FE0F`/`FE0E` escolhem apresentação (emoji ou texto), `200D` costura
 * sequências como 👨‍👩‍👧, `20E3` fecha teclas como 1️⃣, e o bloco
 * `1F3FB–1F3FF` são os tons de pele. Sozinhos eles não desenham nada —
 * e se ficarem para trás viram o mesmo lixo do pictograma que
 * acompanhavam.
 */
const ACOMPANHANTES = /[︎️‍⃣\u{1F3FB}-\u{1F3FF}]/gu;

/** Bandeiras: pares de indicadores regionais, 🇧🇷 e afins. */
const BANDEIRAS = /\p{Regional_Indicator}/gu;

/**
 * Invisíveis que sobraram na varredura do texto real.
 *
 * Achados rodando esta limpeza sobre os 509 criativos do banco e
 * conferindo CADA caractere restante contra o cmap de Geist. Os três não
 * são emoji e passariam pelas regras acima:
 *
 *   U+2800  braille em branco, 18x — usado como espaçador em copy de
 *           rede social para forçar quebra de linha. Vira espaço, que é
 *           o papel que ele cumpre ali.
 *   U+FFFD  o losango de interrogação, 16x — o texto JÁ chegou
 *           corrompido da plataforma. Não há o que recuperar; some.
 *   U+200C  não-juntor, 1x — invisível por definição.
 */
const ESPACADOR_BRAILLE = /⠀/gu;
const INVISIVEIS_SEM_GLIFO = /[�‌]/gu;

/**
 * Pictogramas — menos os três que Geist DESENHA.
 *
 * `Extended_Pictographic` inclui © ® ™, que não são emoji no sentido
 * usual e aparecem legitimamente em nome de marca. Medido na própria
 * fonte: dos catorze símbolos testados, Geist tem © ® ™ → • – … e não
 * tem ✓ ★ ⚡ ❤ ⭐ ✔ ☎. Só os três primeiros são pictográficos, então a
 * exceção é exatamente esta.
 */
const PICTOGRAMAS = /\p{Extended_Pictographic}/gu;
const MANTER = new Set(["©", "®", "™"]);

/**
 * O texto sem o que o PDF não sabe desenhar.
 *
 * A limpeza do ESPAÇO importa tanto quanto a do símbolo: "na área! 🚀
 * Peça já" sem tratamento vira "na área!  Peça já", com dois espaços, e
 * um emoji no fim da frase deixa espaço pendurado antes do ponto. Sobra
 * de espaço em documento de cliente é a diferença entre "limpo" e
 * "alguém apagou algo aqui".
 */
export function semEmoji(texto: string): string {
  return texto
    .replace(PICTOGRAMAS, (c) => (MANTER.has(c) ? c : ""))
    .replace(ACOMPANHANTES, "")
    .replace(BANDEIRAS, "")
    .replace(ESPACADOR_BRAILLE, " ")
    .replace(INVISIVEIS_SEM_GLIFO, "")
    /* Espaço duplicado no lugar do símbolo removido. \s e não " " porque
       copy de anúncio vem com espaço fino e não separável. */
    .replace(/[^\S\n]{2,}/g, " ")
    // Espaço que sobrou colado na pontuação.
    .replace(/[^\S\n]+([,.;:!?…])/g, "$1")
    // Linha que era só emoji não deve virar linha em branco no meio.
    .replace(/\n[^\S\n]*\n[^\S\n]*\n+/g, "\n\n")
    .trim();
}

/**
 * `semEmoji` e corte, nesta ordem.
 *
 * Cortar antes de limpar gastaria parte do limite com caractere que vai
 * ser removido — e, pior, o corte pode cair NO MEIO de um par de
 * substitutos e deixar meio emoji, que é exatamente o caso que produz
 * lixo.
 */
export function copyDoAnuncio(
  texto: string | null,
  limite: number,
): string | null {
  if (!texto) return null;

  const limpo = semEmoji(texto);
  if (!limpo) return null;
  if (limpo.length <= limite) return limpo;

  /* Corta na última palavra inteira, não no caractere exato: "…é o sabor
     inconfundível da lenha de pessegue…" é pior de ler do que terminar
     em "lenha de". Comportamento herdado do `truncate` que existia neste
     documento e que esta função substituiu. */
  const cortado = limpo.slice(0, limite);
  const ultimoEspaco = cortado.lastIndexOf(" ");

  return `${cortado.slice(0, ultimoEspaco > 0 ? ultimoEspaco : limite).trimEnd()}…`;
}
