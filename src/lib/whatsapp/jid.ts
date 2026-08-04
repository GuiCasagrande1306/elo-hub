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
 */
export function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (isJid(value)) return value;

  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}
