/**
 * Sparkline em SVG puro.
 *
 * Não usa Recharts de propósito: são ~40 linhas contra um wrapper com
 * ResponsiveContainer que exige medição de layout, roda só no cliente e
 * pisca ao montar. Como SVG estático, renderiza no servidor, entra no
 * HTML inicial e não custa JavaScript nenhum.
 *
 * `preserveAspectRatio="none"` deixa o traço esticar com o card, o que é
 * aceitável aqui: a sparkline comunica FORMATO da curva, não valor —
 * o valor exato está no número grande logo acima.
 */

interface SparklineProps {
  data: number[];
  /** Qualquer cor CSS válida; padrão herda do texto. */
  stroke?: string;
  className?: string;
  /** Preenche a área sob a curva com um gradiente sutil. */
  fill?: boolean;
  id: string;
}

const WIDTH = 100;
const HEIGHT = 28;

export function Sparkline({
  data,
  stroke = "currentColor",
  className,
  fill = true,
  id,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Série constante teria range 0 e produziria divisão por zero:
  // nesse caso a linha fica no meio da caixa.
  const range = max - min || 1;
  const flat = max === min;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * WIDTH;
    const y = flat
      ? HEIGHT / 2
      : HEIGHT - ((value - min) / range) * (HEIGHT - 3) - 1.5;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#spark-${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Ponto no último valor: ancora o olho no dado mais recente. */}
      <circle
        cx={lastX}
        cy={lastY}
        r="1.8"
        fill={stroke}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
