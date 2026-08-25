import { dataNoBrasil } from "@/lib/date-br";

import { DIAS_SEMANA } from "./agenda";

/* =====================================================================
   Programação semanal: da grade fixa para as datas do calendário
   ---------------------------------------------------------------------
   A parte com data deste módulo, separada do banco e das actions para
   poder ser conferida numa mesa. É onde mora o erro caro: gerar a peça
   um dia fora coloca o post do cliente no ar na terça em vez da quarta,
   e ninguém confere data de peça que "o sistema criou sozinho".
   ===================================================================== */

/**
 * Quantas semanas o gerador mantém preenchidas à frente.
 *
 * OITO, e o número tem dois lados. Curto demais e a grade volta a
 * aparecer vazia quando alguém navega um mês para frente — que é
 * exatamente a queixa que este módulo existe para resolver. Longo demais
 * e mexer na grade passa a arrastar meio ano de peças já criadas, o que
 * torna qualquer ajuste caro. Oito semanas cobrem o planejamento de dois
 * meses, que é o horizonte com que a casa trabalha.
 */
export const SEMANAS_A_FRENTE = 8;

/** "2026-08-25" + n dias, sem passar por fuso. */
function somarDias(iso: string, n: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  /* Meio-dia como âncora: partir da meia-noite deixa o instante a três
     horas da virada no fuso do Brasil, e somar dias cai no dia anterior.
     Mesmo cuidado de `rotuloDoDia` e `semanaDe`. */
  const d = new Date(ano, mes - 1, dia, 12);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * O domingo da semana que contém `iso`.
 *
 * Exportado porque é a CHAVE DE DEDUPLICAÇÃO do gerador — ver
 * `materializar.ts`. Uma linha da grade vale uma peça por SEMANA, não
 * por data, e confundir as duas coisas duplica a produção.
 */
export function domingoDe(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  return somarDias(iso, -d.getDay());
}

/**
 * Em que dias esta linha da grade deve existir.
 *
 * NUNCA NO PASSADO. A grade diz "toda quarta"; ligá-la numa quinta não
 * pode inventar a quarta que já passou — seria uma peça nascida
 * atrasada, que o painel marcaria em vermelho no mesmo instante. Começa
 * de hoje, inclusive: ligar a grade de manhã ainda cria a peça do dia.
 */
export function diasDaRecorrencia(
  weekday: number,
  hoje: string = dataNoBrasil(),
  semanas: number = SEMANAS_A_FRENTE,
): string[] {
  const base = domingoDe(hoje);
  const dias: string[] = [];

  for (let s = 0; s < semanas; s += 1) {
    const dia = somarDias(base, s * 7 + weekday);
    if (dia >= hoje) dias.push(dia);
  }

  return dias;
}

/** "toda quarta" — como a grade se lê em uma linha. */
export function rotuloDaRecorrencia(weekday: number): string {
  const dia = DIAS_SEMANA[weekday] ?? "";
  /* "todo domingo" e "todo sábado"; "toda" para o resto. Detalhe bobo
     que, sem ele, a tela escreve "toda sábado" na cara de quem usa. */
  const artigo = weekday === 0 || weekday === 6 ? "todo" : "toda";
  return `${artigo} ${dia}`;
}

/**
 * A grade de um cliente, ordenada como a semana anda.
 *
 * Ordena por dia e depois por HORA. Duas peças na mesma quarta sem
 * critério de desempate trocam de lugar a cada render, e a lista pisca
 * enquanto alguém edita.
 */
export function ordenarGrade<T extends { weekday: number; hora: string }>(
  linhas: T[],
): T[] {
  return [...linhas].sort(
    (a, b) => a.weekday - b.weekday || a.hora.localeCompare(b.hora),
  );
}
