/* =====================================================================
   Datas no fuso de quem usa o sistema
   ---------------------------------------------------------------------
   O servidor da Vercel roda em UTC. `new Date()` lá dentro está três
   horas à frente de Florianópolis, e todo cálculo de "hoje" feito com
   `toISOString().slice(0, 10)` vira o dia às 21h — não à meia-noite.

   Na prática: quem registrasse uma otimização às 21h30 de segunda a
   veria contada como terça, o bloco "Hoje" da esteira mudaria de dia no
   meio da noite de trabalho, e a semana começaria domingo à noite.

   O cron de relatórios já resolvia isso por conta própria; estas
   funções são a mesma regra num lugar só, para os dois lados não
   divergirem de novo.

   Brasil não tem horário de verão desde 2019, então o deslocamento é
   fixo em -03:00 — mas quem formata usa `America/Sao_Paulo` mesmo
   assim, porque é a fonte da verdade se um dia voltar.
   ===================================================================== */

const FUSO = "America/Sao_Paulo";

/* `en-CA` produz exatamente YYYY-MM-DD; montar a string a partir das
   partes seria mais código para o mesmo resultado. */
const formatadorISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatadorDiaSemana = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  weekday: "short",
});

const DIAS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Data de um instante no fuso de São Paulo, como YYYY-MM-DD. */
export function dataNoBrasil(quando: Date | string = new Date()): string {
  const d = typeof quando === "string" ? new Date(quando) : quando;
  return formatadorISO.format(d);
}

/** Dia da semana no fuso de São Paulo. 0=domingo, 6=sábado. */
export function diaDaSemanaNoBrasil(quando: Date = new Date()): number {
  return DIAS[formatadorDiaSemana.format(quando)] ?? 0;
}

/**
 * Segunda-feira da semana corrente, como YYYY-MM-DD.
 *
 * A semana da esteira começa na segunda: é quando a rotina de tráfego
 * recomeça. Domingo pertence à semana que está acabando, então recua
 * seis dias — não um.
 */
export function segundaDestaSemana(quando: Date = new Date()): string {
  const dia = diaDaSemanaNoBrasil(quando);
  const recuo = dia === 0 ? 6 : dia - 1;

  /* Ancora ao MEIO-DIA da data local antes de subtrair. Partir da
     meia-noite deixaria o resultado a três horas da virada, e qualquer
     arredondamento de fuso jogaria a data para o dia anterior. */
  const base = new Date(`${dataNoBrasil(quando)}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() - recuo);

  return dataNoBrasil(base);
}

/**
 * Início de um dia brasileiro como instante absoluto, para comparar com
 * `timestamptz` no banco.
 *
 * `${data}T00:00:00Z` — o que o código fazia antes — é meia-noite em
 * Londres, ou seja 21h do dia ANTERIOR aqui. A consulta trazia três
 * horas a mais de registros do que devia.
 */
export function inicioDoDiaBR(dataISO: string): string {
  return `${dataISO}T00:00:00-03:00`;
}

/**
 * Primeiro e último dia do mês corrente, no fuso de São Paulo.
 *
 * `new Date(y, m, 1)` seguido de `toISOString()` — o que o código fazia
 * — mistura duas coisas: constrói no fuso do servidor e formata em UTC.
 * Na Vercel, às 22h de 31 de agosto isso devolve setembro, e a meta do
 * mês seria gravada no mês errado por três horas todo fim de mês.
 */
export function mesCorrenteBR(quando: Date = new Date()): {
  /** "2026-08" — a chave do mês de referência. */
  referencia: string;
  start: string;
  end: string;
} {
  const hoje = dataNoBrasil(quando);
  const [ano, mes] = hoje.split("-").map(Number);

  const start = `${hoje.slice(0, 7)}-01`;
  /* Dia 0 do mês SEGUINTE é o último dia deste. Construído em UTC ao
     meio-dia para nenhum deslocamento de fuso empurrar a data. */
  const ultimo = new Date(Date.UTC(ano, mes, 0, 12));
  const end = ultimo.toISOString().slice(0, 10);

  return { referencia: hoje.slice(0, 7), start, end };
}

/** "agosto de 2026" — para texto de interface. */
export function nomeDoMes(referencia: string): string {
  const [ano, mes] = referencia.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: FUSO,
  }).format(new Date(Date.UTC(ano, mes - 1, 15, 12)));
}

/** "ago/26" — rótulo curto, para eixo de gráfico. */
export function mesCurto(referencia: string): string {
  const [ano, mes] = referencia.split("-").map(Number);
  const nome = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: FUSO,
  })
    .format(new Date(Date.UTC(ano, mes - 1, 15, 12)))
    .replace(".", "");
  return `${nome}/${String(ano).slice(2)}`;
}

/** Primeiro e último dia de um mês "YYYY-MM". */
export function intervaloDoMes(referencia: string): {
  start: string;
  end: string;
} {
  const [ano, mes] = referencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0, 12));
  return { start: `${referencia}-01`, end: ultimo.toISOString().slice(0, 10) };
}

/**
 * Últimos N meses, do mais recente para o mais antigo.
 *
 * Gerado a partir de HOJE no fuso de São Paulo — não de uma lista fixa,
 * que envelheceria calada na virada do ano.
 */
export function ultimosMeses(quantidade = 12, quando: Date = new Date()) {
  const hoje = dataNoBrasil(quando);
  const [ano, mes] = hoje.split("-").map(Number);

  return Array.from({ length: quantidade }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 15, 12));
    const ref = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value: ref, label: mesCurto(ref), atual: i === 0 };
  });
}

/* =====================================================================
   Presets de período
   ---------------------------------------------------------------------
   Um lugar só resolvendo rótulo → datas. Espalhar isso pelas telas faria
   "últimos 30 dias" significar coisas diferentes em duas páginas — que é
   como um relatório passa a discordar do painel.

   TODOS terminam ONTEM, nunca hoje. O dia corrente ainda está sendo
   veiculado: incluí-lo mostra uma queda no último ponto do gráfico que
   não existe, e some sozinha no dia seguinte. A exceção é "hoje", onde a
   pergunta é justamente o parcial.
   ===================================================================== */

/**
 * Lista COMPLETA de atalhos, usada pelo seletor de calendário.
 *
 * A toolbar de Performance mostra um subconjunto — ver `PERIOD_PRESETS`
 * logo abaixo, que é DERIVADO daqui. Duas listas escritas à mão fariam
 * "Últimos 30 dias" resolver para intervalos diferentes em duas telas,
 * que é exatamente o que este arquivo existe para impedir.
 */
export const PRESETS_INTERVALO = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "14d", label: "Últimos 14 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "mes", label: "Este mês" },
  { value: "mes_passado", label: "Mês passado" },
] as const;

export type IntervaloPreset = (typeof PRESETS_INTERVALO)[number]["value"];

/**
 * O que a toolbar de Performance oferece — um subconjunto.
 *
 * Escrito como união à mão porque `PeriodPreset` já é o tipo que aquela
 * página usa no `searchParams`; acrescentar "ontem" e "14d" ali mudaria
 * a tela de Performance, que não faz parte deste pedido.
 */
export type PeriodPreset = "hoje" | "7d" | "30d" | "mes" | "mes_passado";

const NA_TOOLBAR: readonly string[] = [
  "hoje",
  "7d",
  "30d",
  "mes",
  "mes_passado",
];

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] =
  PRESETS_INTERVALO.filter((p) => NA_TOOLBAR.includes(p.value)).map((p) => ({
    value: p.value as PeriodPreset,
    label: p.label,
  }));

export function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return PERIOD_PRESETS.some((p) => p.value === v);
}

/** Rótulo do preset, para o cabeçalho da página dizer o que está vendo. */
export function periodLabel(preset: PeriodPreset): string {
  return PERIOD_PRESETS.find((p) => p.value === preset)?.label ?? "";
}

/**
 * Preset → intervalo real, no fuso de São Paulo.
 *
 * Ancorado em `dataNoBrasil()` e não em `new Date()`: o servidor da
 * Vercel roda em UTC, e das 21h à meia-noite "ontem" lá já é hoje aqui —
 * o que desloca a janela inteira em um dia por três horas por noite.
 */
export function resolvePeriod(preset: IntervaloPreset): {
  start: string;
  end: string;
} {
  const hoje = dataNoBrasil();

  if (preset === "hoje") return { start: hoje, end: hoje };

  if (preset === "ontem") {
    const o = ontemBR();
    return { start: o, end: o };
  }

  if (preset === "mes") {
    const { start, end } = mesCorrenteBR();
    /* Corta em ontem: o fim do mês civil é futuro na maior parte dos
       dias, e pedir dado até lá devolve dias vazios que achatam o
       gráfico.

       ⚠️ COM PISO NO INÍCIO DO MÊS. No DIA 1, "ontem" é o último dia do
       mês ANTERIOR, e cortar por ele devolvia um intervalo invertido —
       `{ start: "2026-09-01", end: "2026-08-31" }`. Uma vez por mês:
       em /performance a consulta casava zero linhas e a carteira
       aparecia zerada o dia inteiro sem erro nenhum; no calendário de
       relatórios o atalho "Este mês" ficava impossível de aplicar. No
       dia 1, "este mês" é o próprio dia 1 — que é o que o Meta faz. */
    const fim = menorData(end, ontemBR());
    return { start, end: fim < start ? start : fim };
  }

  if (preset === "mes_passado") {
    const [ano, mes] = hoje.split("-").map(Number);
    const alvo = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
    return intervaloDoMes(alvo);
  }

  const dias = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const fim = ontemBR();
  const inicio = new Date(`${fim}T12:00:00-03:00`);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  return { start: inicio.toISOString().slice(0, 10), end: fim };
}

function ontemBR(): string {
  const d = new Date(`${dataNoBrasil()}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const menorData = (a: string, b: string) => (a < b ? a : b);
