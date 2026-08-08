/* =====================================================================
   Casamento de texto para a busca global
   ---------------------------------------------------------------------
   SEM ACENTO E SEM CAIXA, sempre. Metade da carteira tem acento no nome
   — Casarão, Nuur Estética, Açaí do Bem — e ninguém digita acento numa
   busca de atalho. "casarao" precisa achar "Casarão", senão a paleta
   fica mais lenta que clicar na sidebar e ninguém volta a usá-la.

   `ilike` do Postgres NÃO faz isso: seria preciso a extensão `unaccent`.
   Por isso a busca de clientes acontece aqui, no navegador, sobre a
   lista que o shell já carregou — e não numa query.
   ===================================================================== */

/** "Casarão Grill" → "casarao grill". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Quão bem `texto` casa com `termo`. Menor é melhor; `null` = não casa.
 *
 *   0 — começa com o termo          ("Parma" para "par")
 *   1 — alguma PALAVRA começa com   ("Grupo Parma" para "par")
 *   2 — contém em qualquer posição  ("Esparmed" para "par")
 *
 * A distinção existe porque o caso que importa é digitar três letras e
 * dar Enter: sem ela, um nome que contém "par" no meio pode chegar
 * antes do cliente chamado Parma, e o Enter abre a conta errada.
 */
export function pontuar(texto: string, termo: string): number | null {
  const alvo = normalizar(texto);
  const busca = normalizar(termo);

  if (!busca) return 2;

  const posicao = alvo.indexOf(busca);
  if (posicao < 0) return null;
  if (posicao === 0) return 0;

  /* Início de palavra: o caractere anterior é separador. Inclui hífen e
     barra porque nome de cliente vem com os dois ("Bem Viver - Matriz",
     "Casarão/Centro"). */
  return /[\s\-–—/·.,()]/.test(alvo[posicao - 1]) ? 1 : 2;
}

/**
 * Filtra e ordena por relevância, mantendo ordem alfabética no empate.
 *
 * Termo vazio devolve a lista inteira em ordem alfabética — é o estado
 * da paleta recém-aberta, que deve mostrar as contas e não um vazio.
 */
export function ranquear<T>(
  itens: T[],
  termo: string,
  textoDe: (item: T) => string,
): T[] {
  return itens
    .map((item) => ({ item, ponto: pontuar(textoDe(item), termo) }))
    .filter((r): r is { item: T; ponto: number } => r.ponto !== null)
    .sort(
      (a, b) =>
        a.ponto - b.ponto ||
        textoDe(a.item).localeCompare(textoDe(b.item), "pt-BR"),
    )
    .map((r) => r.item);
}

/**
 * Neutraliza os curingas do `ilike` antes de mandar o termo ao Postgres.
 *
 * Sem isto, digitar `%` vira `%%%` e casa com a tabela inteira — a
 * paleta responderia com oito tarefas aleatórias, que parece resultado.
 * `*` entra na lista porque o PostgREST o traduz para `%`.
 */
export function escaparIlike(termo: string): string {
  return termo.replace(/[\\%_*]/g, (c) => `\\${c}`);
}
