/**
 * Formatação pt-BR centralizada.
 *
 * Regra do projeto: dinheiro trafega em CENTAVOS (inteiro) por todo o
 * sistema — banco, API e estado. A divisão por 100 acontece uma única
 * vez, aqui, na borda de apresentação. Isso elimina a classe inteira de
 * bugs de arredondamento de ponto flutuante em soma de gasto de mídia.
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const DEC = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Centavos → "R$ 12.345,67" */
export function formatCurrency(cents: number): string {
  return BRL.format(cents / 100);
}

/** Centavos → "R$ 12,3 mil". Para eixos de gráfico e telas estreitas. */
export function formatCurrencyCompact(cents: number): string {
  return BRL_COMPACT.format(cents / 100);
}

export function formatNumber(value: number): string {
  return INT.format(value);
}

export function formatDecimal(value: number): string {
  return DEC.format(value);
}

export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

/** 0.1234 → "12,3%" (recebe fração, não porcentagem). */
export function formatPercent(fraction: number, digits = 1): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}

/** Variação já em pontos percentuais, com sinal explícito: "+12,4%". */
export function formatDelta(percentPoints: number, digits = 1): string {
  const sign = percentPoints > 0 ? "+" : "";
  return `${sign}${DEC.format(Number(percentPoints.toFixed(digits)))}%`.replace(
    /,00%$/,
    "%",
  );
}

/** "2,4x" para ROAS. */
export function formatMultiplier(value: number): string {
  return `${DEC.format(value)}x`;
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatDateFull(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** "01 – 31 de janeiro de 2026" para a capa do relatório. */
export function formatPeriod(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();

  if (sameMonth) {
    const month = new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
    }).format(e);
    return `${String(s.getDate()).padStart(2, "0")} – ${String(e.getDate()).padStart(2, "0")} de ${month}`;
  }
  return `${formatDateFull(s)} – ${formatDateFull(e)}`;
}

/** Prazo em linguagem natural: "Vence hoje", "Atrasada 3d", "em 5d". */
export function formatDueDate(iso: string | null): {
  label: string;
  tone: "overdue" | "today" | "soon" | "normal";
} {
  if (!iso) return { label: "", tone: "normal" };

  const now = new Date();
  const due = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round(
    (startOfDue.getTime() - startOfToday.getTime()) / 86_400_000,
  );

  if (days < 0) return { label: `Atrasada ${Math.abs(days)}d`, tone: "overdue" };
  if (days === 0) return { label: "Vence hoje", tone: "today" };
  if (days === 1) return { label: "Amanhã", tone: "soon" };
  if (days <= 3) return { label: `em ${days}d`, tone: "soon" };
  return { label: formatDate(due), tone: "normal" };
}

/** Iniciais para avatar de fallback: "Ana Paula Souza" → "AS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
