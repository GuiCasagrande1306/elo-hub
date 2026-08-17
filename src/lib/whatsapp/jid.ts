/* =====================================================================
   Identificadores do WhatsApp
   ---------------------------------------------------------------------
   SEM `server-only`: estas funções também rodam no browser, no seletor
   de destino. O resto de `lib/whatsapp` é servidor puro porque toca a
   chave da Evolution — estas aqui só olham o formato de uma string.
   ===================================================================== */

/**
 * Um JID é o identificador nativo do WhatsApp. Grupos terminam em
 * `@g.us`, contatos individuais em `@s.whatsapp.net` ou `@c.us`.
 */
export function isJid(value: string): boolean {
  return /@(g\.us|s\.whatsapp\.net|c\.us|lid)$/i.test(value.trim());
}

/** O destino é um grupo? */
export function isGroupJid(value: string): boolean {
  return /@g\.us$/i.test(value.trim());
}

/**
 * Normaliza o destino.
 *
 * ⚠️ JID passa INTACTO. Uma versão anterior aplicava
 * `replace(/\D/g, "")` em tudo, o que transformava
 * `120363000000000000@g.us` em `120363000000000000` — a API recebia o
 * id do grupo como se fosse telefone e o relatório nunca chegava. O bug
 * só apareceu quando grupos entraram no escopo, porque com celular a
 * função sempre funcionou.
 *
 * Para telefone segue valendo E.164 sem "+", completando o DDI 55
 * quando falta — que é o erro mais comum no cadastro do cliente.
 *
 * ⚠️ A DECISÃO É PELO COMPRIMENTO, NUNCA PELO PREFIXO. A versão anterior
 * fazia `if (digits.startsWith("55")) return digits`, e com isso o DDD
 * 55 — Santa Maria e toda a região central do Rio Grande do Sul — era
 * confundido com o DDI 55. Um cliente com o número (55) 99999-8888 vira
 * "55999998888"; a regra antiga devolvia isso intacto, a Evolution lia
 * como DDI 55 + DDD 99 + 99998888, e o relatório do cliente era
 * ENTREGUE COM SUCESSO no telefone de um desconhecido no Maranhão. Sem
 * erro nenhum, porque do ponto de vista da API deu tudo certo.
 *
 * O comprimento resolve sem ambiguidade:
 *
 *   10 ou 11 dígitos  → número nacional (DDD + 8 fixo, ou DDD + 9 móvel).
 *                       Falta o DDI, mesmo que comece em 55.
 *   12 ou 13 dígitos  → já tem DDI. Com 55 na frente é brasileiro.
 *   qualquer outro    → estrangeiro ou cadastro torto; passa como está,
 *                       porque inventar dígito seria pior.
 *
 * Não existe número brasileiro de 11 dígitos COM DDI: seriam 55 + 9, e
 * nenhuma faixa nacional tem 9 dígitos depois do país. Por isso o caso
 * ambíguo simplesmente não existe.
 */
export function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (isJid(value)) return value;

  const digits = value.replace(/\D/g, "");

  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}
