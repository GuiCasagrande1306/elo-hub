/* =====================================================================
   Cor de identificação do cliente
   ---------------------------------------------------------------------
   `brand_primary` deixou de ser digitada no cadastro — a logo ocupou o
   lugar dela no formulário. Só que a cor não era enfeite: ela é o
   quadradinho que distingue um cliente do outro em cerca de quinze
   telas onde NENHUMA imagem é renderizada — card de tarefa, esteira,
   sidebar, fila de relatórios, radar da torre de controle.

   Sem cor, todos esses quadrados caem no cinza `#8a8a8a` e param de
   informar qualquer coisa: uma lista de dez tarefas de cinco clientes
   vira dez quadrados iguais.

   Por isso a cor passa a ser DERIVADA do nome. Determinística — o mesmo
   nome dá sempre a mesma cor, então o cliente não muda de cor entre uma
   tela e outra nem depois de um redeploy. E como sai de uma paleta
   fechada, nenhuma combinação nasce ilegível como aconteceria sorteando
   hex livre.
   ===================================================================== */

/* Escolhidas para terem contraste suficiente com texto branco e para se
   distinguirem entre si mesmo em quadrados de 20px. Sem amarelo puro
   nem pastéis: somem no tema claro. */
const PALETA = [
  "#2F6F4E", // verde mata
  "#1E4E8C", // azul profundo
  "#8A3D3D", // terracota
  "#5B4B8A", // roxo
  "#1F6F6F", // petróleo
  "#8A6E4B", // caramelo
  "#A8443C", // vermelho tijolo
  "#3E6B2F", // oliva
  "#2B5C8A", // azul aço
  "#7A3F6D", // vinho
  "#4A5568", // grafite
  "#96591F", // âmbar escuro
] as const;

/**
 * Cor estável para um cliente, a partir do nome.
 *
 * djb2: hash simples e determinístico. Não precisa ser criptográfico —
 * precisa ser o MESMO em todo lugar, inclusive entre servidor e
 * navegador, e é por isso que não pode envolver `Math.random()` nem
 * qualquer coisa dependente de horário.
 */
export function brandColorFromName(nome: string): string {
  const limpo = nome.trim().toLowerCase();
  if (!limpo) return PALETA[0];

  let hash = 5381;
  for (let i = 0; i < limpo.length; i += 1) {
    // `| 0` mantém em 32 bits; sem isso o número vira float e perde
    // precisão em nomes longos, mudando a cor por causa do comprimento.
    hash = ((hash << 5) + hash + limpo.charCodeAt(i)) | 0;
  }

  return PALETA[Math.abs(hash) % PALETA.length];
}
