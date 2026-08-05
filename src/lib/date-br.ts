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
