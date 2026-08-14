import { dataNoBrasil } from "@/lib/date-br";

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

/**
 * "5.000,00" | "5000" | "R$ 5.000" → 500000 centavos. `null` = inválido.
 *
 * Aceita o que o brasileiro realmente digita: com ou sem separador de
 * milhar, vírgula ou ponto decimal, com ou sem "R$". Devolver 0 em
 * entrada inválida seria pior que falhar — o usuário acharia que
 * cadastrou a meta e ela viria zerada.
 *
 * Mora aqui, e não em `validation/client`, porque é o par exato de
 * `formatCurrency`: mesma borda, sentido inverso. Ficar junto do schema
 * de cadastro criava ciclo de import assim que outro módulo de domínio
 * precisava converter reais em centavos.
 */
export function parseCurrencyToCents(input: string): number | null {
  const trimmed = input.trim();

  // Campo em branco = "não definir meta agora". É diferente de campo
  // preenchido com lixo.
  if (trimmed === "") return 0;

  const cleaned = trimmed.replace(/[^\d,.]/g, "");

  // O usuário digitou ALGO, mas sem nenhum dígito ("abc", "R$"). Aceitar
  // como zero faria a meta sumir sem aviso — ele sairia da tela achando
  // que cadastrou um orçamento.
  if (!/\d/.test(cleaned)) return null;

  // Com vírgula, ela é o separador decimal (pt-BR) e o ponto é milhar.
  // Sem vírgula, um ponto pode ser qualquer um dos dois — tratamos como
  // decimal só quando sobram 1 ou 2 casas ("1.5" = 1,50; "1.500" = mil
  // e quinhentos).
  let normalized: string;

  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    const isDecimalPoint =
      parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
    normalized = isDecimalPoint ? cleaned : cleaned.replace(/\./g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
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

/**
 * Prazo em linguagem natural: "Vence hoje", "Atrasada 3d", "em 5d".
 *
 * ⚠️ A CONTA É EM SÃO PAULO, não no relógio de quem renderiza. A versão
 * anterior usava `getFullYear/getMonth/getDate`, que respondem no fuso
 * local — e esta função roda nos DOIS lados:
 *
 *   • no servidor da Vercel, que é UTC: das 21h à meia-noite daqui, o
 *     "hoje" de lá já era o dia seguinte, e uma tarefa para amanhã
 *     aparecia como "Vence hoje" durante três horas por noite. Pior:
 *     servidor e navegador discordavam no mesmo render, que é a receita
 *     de erro de hidratação;
 *   • no navegador, onde bastava alguém abrir o sistema fora do fuso de
 *     Brasília para ver outro prazo.
 *
 * Os dois lados são ancorados ao MEIO-DIA da data brasileira antes de
 * subtrair, então a diferença sai em múltiplos exatos de 24h e nenhum
 * arredondamento empurra o resultado para o dia vizinho.
 */
export function formatDueDate(iso: string | null): {
  label: string;
  tone: "overdue" | "today" | "soon" | "normal";
} {
  if (!iso) return { label: "", tone: "normal" };

  const hoje = dataNoBrasil();
  const prazo = dataNoBrasil(iso);

  const days = Math.round(
    (Date.parse(`${prazo}T12:00:00-03:00`) -
      Date.parse(`${hoje}T12:00:00-03:00`)) /
      86_400_000,
  );

  if (days < 0) return { label: `Atrasada ${Math.abs(days)}d`, tone: "overdue" };
  if (days === 0) return { label: "Vence hoje", tone: "today" };
  if (days === 1) return { label: "Amanhã", tone: "soon" };
  if (days <= 3) return { label: `em ${days}d`, tone: "soon" };
  /* Formata a partir da data JÁ resolvida em São Paulo — passar o
     instante cru devolveria `formatDate` ao fuso local que esta função
     acabou de deixar de usar. */
  return { label: formatDate(`${prazo}T12:00:00-03:00`), tone: "normal" };
}

/** Iniciais para avatar de fallback: "Ana Paula Souza" → "AS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
