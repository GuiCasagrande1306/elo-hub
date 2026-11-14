import type { SaudeDaConta } from "@/types/database";

export interface SaudeAtual {
  cor: SaudeDaConta;
  /** Dia (YYYY-MM-DD) da primeira otimização desta sequência de mesma cor. */
  desde: string;
  /** Dias desde `desde`, contados no servidor (relógio fora do render). */
  dias: number;
}

/** Espera as linhas da mais nova para a mais antiga; `hoje` = YYYY-MM-DD. */
export function saudeDaSequencia(
  linhas: { dia: string; account_health: SaudeDaConta | null }[],
  hoje: string,
): SaudeAtual | null {
  const marcadas = linhas.filter((l) => l.account_health !== null);
  if (marcadas.length === 0) return null;
  const cor = marcadas[0].account_health as SaudeDaConta;
  let desde = marcadas[0].dia;
  for (const l of marcadas) {
    if (l.account_health !== cor) break;
    desde = l.dia;
  }
  const dias = Math.max(0, Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000));
  return { cor, desde, dias };
}
