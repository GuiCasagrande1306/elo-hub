/* =====================================================================
   Normalização de valores das plataformas
   ---------------------------------------------------------------------
   Cada API devolve dinheiro num formato diferente, e cada uma tem uma
   armadilha própria:

     Google Ads  `cost_micros: "12345678"`   → 1 BRL = 1.000.000 micros
     Meta Ads    `spend: "123.45"`           → string decimal, não number
     Meta Ads    `actions: [...]`            → soma cega conta o mesmo
                                               lead 3 vezes

   O padrão unificado do projeto é CENTAVOS (inteiro), não reais decimais.
   A razão é a mesma que vale em todo o sistema: soma de gasto de mídia em
   float acumula erro. `0.1 + 0.2 !== 0.3`, e num mês de 60 campanhas ×
   30 dias isso vira centavos de diferença entre o card e a fatura. Com
   inteiro não existe classe de bug. A conversão para reais acontece uma
   única vez, na borda de apresentação (`lib/format.ts`).
   ===================================================================== */

/** 1 real = 1.000.000 micros = 100 centavos ⇒ micros ÷ 10.000. */
export function microsToCents(micros: string | number | null | undefined): number {
  const value = typeof micros === "string" ? Number(micros) : (micros ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 10_000);
}

/**
 * String decimal → centavos.
 *
 * `Number("123.45") * 100` dá 12344.999999999998 em ponto flutuante;
 * o `Math.round` é o que impede o centavo perdido. Não trocar por
 * `Math.floor`/`| 0`, que truncariam para baixo sistematicamente.
 */
export function decimalToCents(value: string | number | null | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Inteiro seguro a partir de string/number/null. */
export function toInt(value: string | number | null | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * Conversões vêm fracionadas de propósito.
 *
 * O Google atribui 0,33 conversão quando o modelo é distribuído entre
 * três toques. Arredondar para inteiro aqui subestimaria o resultado do
 * cliente — a coluna `conversions` é numeric(12,2) exatamente por isso.
 */
export function toDecimal(value: string | number | null | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

/**
 * Moeda da conta.
 *
 * ⚠️ Somar uma conta em USD com outra em BRL produz um total que não
 * significa nada — e o erro é silencioso, porque a soma "funciona".
 * Preferimos recusar a conta e registrar o motivo a entregar um número
 * errado com aparência de certo.
 *
 * Suporte multi-moeda exige taxa de câmbio POR DIA (a do dia do gasto,
 * não a de hoje), o que é um recurso à parte.
 */
export const BASE_CURRENCY = "BRL";

export function isSupportedCurrency(currency: string | null | undefined): boolean {
  return (currency ?? BASE_CURRENCY).toUpperCase() === BASE_CURRENCY;
}

/** "123-456-7890" → "1234567890". A API do Google recusa os hífens. */
export function normalizeCustomerId(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Primeiro e último dia do mês corrente, em ISO. */
export function currentMonthRange(now = new Date()): { since: string; until: string } {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { since: toISODate(first), until: toISODate(last) };
}

/** Janela curta terminando hoje — usada nas rodadas de hora em hora. */
export function lookbackRange(days: number, now = new Date()): {
  since: string;
  until: string;
} {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { since: toISODate(start), until: toISODate(now) };
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
