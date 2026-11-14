/* =====================================================================
   Painel do CS — contas puras (sem banco), testadas em
   scripts/teste-painel-do-cs.mts. Datas sempre "YYYY-MM-DD" no fuso de
   São Paulo; a conversão do relógio acontece no servidor.
   ===================================================================== */

const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function somarDias(dia: string, n: number): string {
  return iso(ms(dia) + n * DIA);
}

/** Dias de `de` até `ate` (positivo se `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((ms(ate) - ms(de)) / DIA);
}

/** A segunda-feira da semana de `dia`. Domingo pertence à semana que termina nele. */
export function segundaDaSemana(dia: string): string {
  const dow = new Date(ms(dia)).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((dow + 6) % 7));
}

/** "09 a 13/11" — segunda a sexta. */
export function rotuloDaSemana(segunda: string): string {
  const sexta = somarDias(segunda, 4);
  const [, mS, dS] = segunda.split("-");
  const [, mF, dF] = sexta.split("-");
  return mS === mF ? `${dS} a ${dF}/${mF}` : `${dS}/${mS} a ${dF}/${mF}`;
}

/**
 * Próxima ocorrência de uma data "dd/mm" (ou "dd/mm/aaaa", ano ignorado:
 * aniversário e fundação se repetem). `null` se não der para ler.
 */
export function proximaOcorrencia(texto: string, hoje: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})/.exec(texto);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  const ano = Number(hoje.slice(0, 4));
  const candidata = (a: number) => `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const esteAno = candidata(ano);
  if (Number.isNaN(ms(esteAno))) return null;
  return esteAno >= hoje ? esteAno : candidata(ano + 1);
}

/** "há 9 dias" / "hoje" / "atrasada 1 dia" / "vence 15/11". */
export function prazo(dia: string, hoje: string): { texto: string; atrasado: boolean } {
  const n = diasEntre(hoje, dia);
  if (n === 0) return { texto: "hoje", atrasado: false };
  if (n < 0) return { texto: `atrasada ${-n} ${n === -1 ? "dia" : "dias"}`, atrasado: true };
  const [, mm, dd] = dia.split("-");
  return { texto: `${dd}/${mm}`, atrasado: false };
}
