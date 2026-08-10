import { dataNoBrasil } from "@/lib/date-br";
import type { SocialPostWithRelations } from "@/types/database";

/* =====================================================================
   Agenda: converter entre o `timestamptz` do banco e os campos da tela
   ---------------------------------------------------------------------
   `scheduled_at` é um INSTANTE. Os dois campos do formulário são uma
   data e uma hora LOCAIS. A conversão entre os dois é onde nasce o bug
   clássico deste projeto: montar `"2026-08-14T10:00"` sem fuso faz o
   Postgres ler como UTC, e o post que deveria sair às 10h aparece às 7h
   para quem opera — três horas antes, todo dia, sem erro nenhum na tela.

   Por isso NADA aqui usa `toISOString().slice()`. O deslocamento entra
   explícito, como já fazem `date-br.ts` e o cron de relatórios.
   ===================================================================== */

/* Brasil sem horário de verão desde 2019. Mesma premissa (e mesma
   ressalva) de `date-br.ts`: quem FORMATA usa `America/Sao_Paulo`, para
   continuar correto se um dia voltar. */
const OFFSET = "-03:00";

const formatadorHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-08-14" + "10:00" → instante absoluto, com fuso explícito. */
export function montarAgendamento(data: string, hora: string): string | null {
  if (!data) return null;
  /* Hora vazia com data preenchida vira 09:00, não meia-noite: uma peça
     "agendada para as 00:00" some no fim do dia anterior em qualquer
     leitura por período, e ninguém publica à meia-noite de propósito. */
  const h = hora || "09:00";
  return `${data}T${h}:00${OFFSET}`;
}

/** Instante → os dois campos do formulário, no fuso de quem opera. */
export function partesDoAgendamento(iso: string | null): {
  data: string;
  hora: string;
} {
  if (!iso) return { data: "", hora: "" };
  return {
    data: dataNoBrasil(iso),
    hora: formatadorHora.format(new Date(iso)),
  };
}

/** Só a hora, para a linha do calendário. */
export function horaDoPost(iso: string | null): string {
  return iso ? formatadorHora.format(new Date(iso)) : "";
}

/**
 * Índice por dia, para a grade do calendário.
 *
 * Posts SEM data ficam de fora — o calendário mostra o total deles à
 * parte. Jogá-los num dia arbitrário inventaria um compromisso que
 * ninguém assumiu, o mesmo motivo pelo qual tarefa sem prazo não aparece
 * no calendário de tarefas.
 */
export function agruparPorDia(
  posts: SocialPostWithRelations[],
): Map<string, SocialPostWithRelations[]> {
  const porDia = new Map<string, SocialPostWithRelations[]>();

  for (const post of posts) {
    if (!post.scheduled_at) continue;
    const dia = dataNoBrasil(post.scheduled_at);
    const lista = porDia.get(dia);
    if (lista) lista.push(post);
    else porDia.set(dia, [post]);
  }

  /* Dentro do dia, por HORA. A ordem do servidor é por instante e já
     serve, mas um post reagendado no navegador entra fora de ordem até
     o refresh — e a linha do dia é justamente onde isso se vê. */
  for (const lista of porDia.values()) {
    lista.sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
  }

  return porDia;
}

export const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "seg, 14 de agosto" — cabeçalho da agenda no celular. */
export function rotuloDoDia(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  /* Meio-dia como âncora: partir da meia-noite deixa o instante a três
     horas da virada, e o `getDay` cai no dia anterior. */
  const d = new Date(ano, mes - 1, dia, 12);
  return `${DIAS_SEMANA[d.getDay()]}, ${dia} de ${MESES[mes - 1]}`;
}
