import { dataNoBrasil } from "@/lib/date-br";
import { situacaoDoPost } from "@/lib/social/post-status";
import type { SocialPostWithRelations } from "@/types/database";

import { DIAS_SEMANA, MESES } from "./agenda";

/* =====================================================================
   Pauta: a grade cliente × dia
   ---------------------------------------------------------------------
   O calendário do mês responde "o que sai neste dia". Esta grade
   responde outra pergunta, que é a que trava a produção: "quem está sem
   nada esta semana".

   A diferença não é de estilo. No calendário do mês, uma semana com dez
   peças de dois clientes parece cheia — e os outros oito clientes, que
   não têm nada, são invisíveis, porque um cliente sem peça simplesmente
   não desenha nada. Aqui ele desenha uma LINHA VAZIA, do mesmo tamanho
   das outras, e o buraco fica do tamanho do problema.

   Por isso a grade mostra todos os clientes por padrão, inclusive os que
   não têm pauta nenhuma. A linha vazia é a informação.
   ===================================================================== */

/* ------------------------------------------------------------------ */
/* Semana                                                              */
/* ------------------------------------------------------------------ */

/**
 * Os sete dias da semana que contém `iso`, de domingo a sábado.
 *
 * Domingo primeiro para bater com `DIAS_SEMANA` e com a grade do mês:
 * quem alterna entre as duas abas na mesma página não deveria ter de
 * reaprender a ordem das colunas no meio do caminho.
 *
 * A conta é feita com `Date` local ancorado ao MEIO-DIA. Partir da
 * meia-noite deixa o instante a três horas da virada no fuso do Brasil,
 * e `getDay()` responde o dia anterior — o mesmo cuidado que
 * `rotuloDoDia` já toma.
 */
export function semanaDe(iso: string): string[] {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const base = new Date(ano, mes - 1, dia, 12);
  base.setDate(base.getDate() - base.getDay());

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

/** Mesma semana, `delta` semanas para frente ou para trás. */
export function deslocarSemana(iso: string, delta: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  d.setDate(d.getDate() + delta * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "24 a 30 de agosto" — e "31 de agosto a 6 de setembro" quando a semana
 * cruza o mês, que é justamente quando o rótulo curto enganaria.
 */
export function rotuloDaSemana(dias: string[]): string {
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  if (!primeiro || !ultimo) return "";

  const [anoA, mesA, diaA] = primeiro.split("-").map(Number);
  const [anoB, mesB, diaB] = ultimo.split("-").map(Number);

  /* A SEMANA DA VIRADA TEM DOIS ANOS, e ler só o do último dia errava
     nos dois sentidos: em "27 de dezembro a 2 de janeiro" ou o rótulo
     carimbava o ano novo sobre dezembro, ou omitia o ano justamente na
     única semana em que ele desambigua. Por isso os dois anos entram na
     decisão, e quando diferem os dois aparecem. */
  const anoAtual = Number(dataNoBrasil().slice(0, 4));
  const viraOAno = anoA !== anoB;
  const foraDoAnoCorrente = anoA !== anoAtual || anoB !== anoAtual;

  const inicio =
    mesA === mesB && !viraOAno
      ? `${diaA}`
      : `${diaA} de ${MESES[mesA - 1]}${viraOAno ? ` de ${anoA}` : ""}`;

  const fim = `${diaB} de ${MESES[mesB - 1]}`;
  const sufixo = foraDoAnoCorrente ? ` de ${anoB}` : "";

  return `${inicio} a ${fim}${sufixo}`;
}

/** "dom 24" — cabeçalho de uma coluna. */
export function rotuloDaColuna(iso: string): { semana: string; dia: number } {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  return { semana: DIAS_SEMANA[d.getDay()] ?? "", dia };
}

/* ------------------------------------------------------------------ */
/* Estado de PRODUÇÃO — derivado, nunca gravado                        */
/* ------------------------------------------------------------------ */

/**
 * A esteira de produção, que é diferente do trâmite editorial.
 *
 * `situacaoDoPost` responde "esse post está de pé?" — uma pergunta de
 * ACOMPANHAMENTO: aprovado, atrasado, publicado em parte. Ótima para
 * saber o que cobrar do cliente, inútil para saber o que gravar hoje.
 *
 * A esteira responde "esse post EXISTE?". E o que separa uma pauta de
 * uma peça é o arquivo: enquanto `media_urls` está vazio, o que há é uma
 * ideia com data marcada. Ninguém precisa de uma coluna nova no banco
 * para saber disso — a ausência da arte já é o dado, e derivá-la evita o
 * defeito clássico de duas colunas discordando (o mesmo motivo pelo qual
 * `priority` é derivada de `criticality` nas tarefas).
 */
export type EstadoDeProducao =
  | "a_produzir"
  | "arte_pronta"
  | "aprovada"
  | "no_ar"
  | "arquivada";

export const PRODUCAO: Record<
  EstadoDeProducao,
  { label: string; curto: string; dot: string; chip: string }
> = {
  a_produzir: {
    label: "A produzir",
    curto: "A produzir",
    /* Contorno, não preenchido: o vazio do miolo é o vazio da pasta. */
    dot: "border border-warning bg-transparent",
    chip: "bg-warning-muted text-warning ring-warning/25",
  },
  arte_pronta: {
    label: "Arte pronta, falta aprovar",
    curto: "Arte pronta",
    dot: "bg-chart-3",
    chip: "bg-[color-mix(in_oklab,var(--chart-3)_14%,transparent)] text-chart-3 ring-chart-3/30",
  },
  aprovada: {
    label: "Aprovada, pronta para publicar",
    curto: "Aprovada",
    dot: "bg-signal",
    chip: "bg-signal-muted text-signal ring-signal/25",
  },
  no_ar: {
    label: "No ar",
    curto: "No ar",
    dot: "bg-positive",
    chip: "bg-positive-muted text-positive ring-positive/25",
  },
  /* Mesmo cinza "fora do fluxo" de `SITUACOES.arquivado`, para as duas
     telas falarem a mesma língua de cor. */
  arquivada: {
    label: "Arquivada",
    curto: "Arquivada",
    dot: "bg-muted-foreground/30",
    chip: "bg-surface-2 text-muted-foreground/70 ring-hairline",
  },
};

export function producaoDoPost(
  post: Pick<
    SocialPostWithRelations,
    "status" | "scheduled_at" | "targets" | "media_urls"
  >,
  agora: Date = new Date(),
): EstadoDeProducao {
  const s = situacaoDoPost(post, agora);

  /* Peça cancelada não é trabalho pendente. Sem este ramo ela escorregava
     até o fallback de `media_urls` lá embaixo e voltava como "a produzir"
     — o histórico de algo que foi CANCELADO redesenhado como coisa a
     fazer, inclusive quando já tinha ido ao ar antes. */
  if (s === "arquivado") return "arquivada";

  /* PUBLICADO VENCE TUDO, inclusive a falha — e é aqui que a esteira
     precisa discordar de `situacaoDoPost`, de propósito. Lá, `falhas > 0`
     é testado ANTES de `publicados > 0`, porque aquela tela existe para
     gritar a falha: trocar a ordem lá apagaria o alerta vermelho, que é o
     sinal que ela precisa dar.

     Aqui a pergunta é outra — "isso ainda me dá trabalho de produção?" —
     e uma peça que já está pública no Instagram e falhou no TikTok não
     volta para a bancada. Sem esta linha, ela era contada como "aprovada,
     falta publicar" e sumia do contador "no ar". */
  const alvos = post.targets ?? [];
  if (alvos.some((t) => t.status === "publicado")) return "no_ar";
  if (s === "publicado" || s === "parcial") return "no_ar";

  /* `pronto` é o nome que `situacaoDoPost` dá a "aprovado sem data" — não
     existe uma situação chamada `aprovado`, porque o que aquela tela
     distingue é ter ou não ter dia marcado. Para a esteira os quatro são
     a mesma coisa: liberado, falta publicar. */
  if (s === "pronto" || s === "agendado" || s === "atrasado" || s === "falhou") {
    return "aprovada";
  }

  /* AQUI ESTÁ A REGRA QUE EU ERREI DE PRIMEIRA, e o erro aparecia na
     tela: eu olhava `media_urls` antes do trâmite, então uma peça que o
     cliente já tinha APROVADO entrava como "a produzir" só porque o
     arquivo não subiu para o painel. Absurdo — ninguém aprova o que não
     existe. Medido no dataset de demonstração: 7 peças em "a produzir",
     nenhuma em "aprovada", com peças aprovadas na semana.

     O trâmite é a evidência mais forte. Saiu do rascunho? Alguém mandou
     alguma coisa para alguém, logo a peça existe — mesmo que a arte
     esteja no Drive e não aqui. A ausência de arte só significa "não
     produzido" enquanto a peça ainda é RASCUNHO, que é justamente o
     estado em que ela é uma ideia com data marcada. */
  if (s === "em_aprovacao" || s === "ajustes") return "arte_pronta";

  return (post.media_urls ?? []).length > 0 ? "arte_pronta" : "a_produzir";
}

/* ------------------------------------------------------------------ */
/* Agrupamento                                                          */
/* ------------------------------------------------------------------ */

/** `clientId → dia ISO → peças daquele cliente naquele dia`. */
export function agruparPorClienteEDia(
  posts: SocialPostWithRelations[],
): Map<string, Map<string, SocialPostWithRelations[]>> {
  const grade = new Map<string, Map<string, SocialPostWithRelations[]>>();

  for (const post of posts) {
    if (!post.scheduled_at) continue;

    const dia = dataNoBrasil(post.scheduled_at);
    let doCliente = grade.get(post.client_id);
    if (!doCliente) {
      doCliente = new Map();
      grade.set(post.client_id, doCliente);
    }

    const lista = doCliente.get(dia);
    if (lista) lista.push(post);
    else doCliente.set(dia, [post]);
  }

  /* Dentro do dia, por hora — a mesma ordenação do calendário, pelo
     mesmo motivo: uma peça reagendada no navegador entra fora de ordem
     até o refresh. */
  for (const doCliente of grade.values()) {
    for (const lista of doCliente.values()) {
      lista.sort((a, b) =>
        (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
      );
    }
  }

  return grade;
}

export interface ResumoDaSemana {
  total: number;
  aProduzir: number;
  artePronta: number;
  aprovadas: number;
  noAr: number;
  /** Clientes da lista que não têm nenhuma peça na semana. */
  clientesSemPauta: number;
}

export function resumirSemana(
  posts: SocialPostWithRelations[],
  dias: string[],
  clientIds: string[],
  agora: Date = new Date(),
): ResumoDaSemana {
  const janela = new Set(dias);
  /* SÓ QUEM TEM LINHA NA GRADE. `getClients()` não devolve cliente
     encerrado, mas `getSocialPosts()` traz as peças dele — sem este
     recorte o cabeçalho somava uma peça que a grade não tem onde
     desenhar, e os dois números discordavam na mesma tela. */
  const naGrade = new Set(clientIds);
  const comPauta = new Set<string>();

  const resumo: ResumoDaSemana = {
    total: 0,
    aProduzir: 0,
    artePronta: 0,
    aprovadas: 0,
    noAr: 0,
    clientesSemPauta: 0,
  };

  for (const post of posts) {
    if (!post.scheduled_at) continue;
    if (!janela.has(dataNoBrasil(post.scheduled_at))) continue;
    if (!naGrade.has(post.client_id)) continue;

    /* CONTA COMO PAUTA ANTES DE FILTRAR ARQUIVADO. A grade desenha o chip
       riscado e o soma no contador da linha do cliente; dizer "cliente
       sem pauta" embaixo de uma linha que tem chip é a tela discordando
       de si mesma. O que arquivado não faz é entrar nos quatro
       contadores da esteira — ninguém produz o que foi cancelado. */
    comPauta.add(post.client_id);

    const estado = producaoDoPost(post, agora);
    if (estado === "arquivada") continue;

    resumo.total += 1;

    switch (estado) {
      case "a_produzir":
        resumo.aProduzir += 1;
        break;
      case "arte_pronta":
        resumo.artePronta += 1;
        break;
      case "aprovada":
        resumo.aprovadas += 1;
        break;
      case "no_ar":
        resumo.noAr += 1;
        break;
    }
  }

  resumo.clientesSemPauta = clientIds.filter((id) => !comPauta.has(id)).length;
  return resumo;
}
