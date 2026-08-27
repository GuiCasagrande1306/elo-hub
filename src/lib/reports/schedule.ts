import "server-only";

import { intervaloDoMes } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { MARCA_INTERROMPIDO } from "./envio-interrompido";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateAndDeliverReport } from "./orchestrator";
import { systemSource } from "./source";
import type { Client } from "@/types/database";

/* =====================================================================
   Preparo dos relatórios do dia
   ---------------------------------------------------------------------
   O cron NÃO ENVIA. Ele gera o PDF e para em `ready`; quem dispara é
   uma pessoa, clicando, pelo próprio WhatsApp.

   A troca foi deliberada e tem duas consequências boas: alguém OLHA o
   relatório antes de ele chegar ao cliente, e o clique é instantâneo
   porque o PDF já existe — gerar na hora custaria ~6s de espera com a
   tela travada.

   Roda uma vez por dia e atende quem tem `report_day` igual ao dia de
   hoje. Três decisões que definem o comportamento:

   1. A DATA É A DO BRASIL, não a do servidor. O cron da Vercel roda em
      UTC; perto da virada do dia, "hoje" em UTC e "hoje" em São Paulo
      são datas diferentes, e um cliente agendado para o dia 1 receberia
      no dia 2 — ou não receberia.

   2. O PERÍODO TERMINA ONTEM. O dado de hoje está incompleto: as
      plataformas ainda estão contabilizando. Fechar em ontem é o que
      permite prometer "números fechados" na mensagem que vai ao grupo.

   3. HÁ ORÇAMENTO DE TEMPO. Cada PDF sobe um Chromium; numa carteira
      grande o job seria morto no meio pelo limite da função, deixando
      metade dos clientes sem relatório e SEM registro do porquê. Com
      orçamento, quem não coube volta no relatório de execução como
      adiado, explicitamente.
   ===================================================================== */

/** Margem antes do teto da função, para sobrar tempo de responder. */
const RESERVA_MS = 8_000;

/** Custo estimado do primeiro relatório, antes de haver medição real. */
const CUSTO_INICIAL_MS = 20_000;

export interface ResultadoCliente {
  slug: string;
  nome: string;
  reportId?: string | null;
  erro?: string;
  motivo?: string;
}

export interface RelatorioDeDisparo {
  executadoEm: string;
  diaDoMes: number;
  periodo: { start: string; end: string };
  agendados: number;
  /** PDF gerado e aguardando alguém clicar em enviar. */
  preparados: ResultadoCliente[];
  falhas: ResultadoCliente[];
  pulados: ResultadoCliente[];
  adiados: ResultadoCliente[];
  /** Backfills disparados nesta rodada — ver `garantirDadosDoPeriodo`. */
  sincronizados: {
    slug: string;
    janela: string;
    linhas: number;
    erro?: string;
  }[];
}

/** Data corrente no fuso de São Paulo, como YYYY-MM-DD. */
function hojeNoBrasil(): string {
  // `en-CA` porque produz exatamente YYYY-MM-DD; montar a string a partir
  // das partes seria mais código para o mesmo resultado.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * O MÊS CIVIL ANTERIOR, completo — a janela do relatório mensal.
 *
 * ⚠️ NÃO É "30 dias terminando ontem", que era o que valia antes. Um
 * envio no dia 5 com aquela regra cobria do dia 6 do mês passado ao dia
 * 4 do corrente: atravessava dois meses e não fechava nenhum. O cliente
 * que recebe em setembro espera ler AGOSTO, e compara com o faturamento
 * que ele já fechou no caixa. Qualquer outra janela obriga ele a
 * desconfiar do número — e desconfiar de um número é o mesmo que não
 * ter o número.
 */
function mesAnterior(hojeISO: string) {
  const [ano, mes] = hojeISO.split("-").map(Number);
  const referencia =
    mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
  return intervaloDoMes(referencia);
}

/**
 * Garante que a janela do relatório foi realmente buscada nas plataformas.
 *
 * O DEFEITO QUE ISTO CONSERTA
 * ---------------------------------------------------------------------
 * A rodada de sincronização usa `mode: "month"`, que é
 * `currentMonthRange()` — do dia 1 do mês CORRENTE até hoje. O relatório
 * mensal lê o mês ANTERIOR. São janelas que não se encostam, e o
 * resultado é um relatório somando um período que o sync nunca pediu à
 * Meta.
 *
 * Medido em 18/08/2026, antes do conserto: das 57 contas, 5 tinham
 * qualquer linha em julho. Quarenta e uma começavam exatamente em
 * 2026-08-01 — o piso do `currentMonthRange`, não uma coincidência. Uma
 * delas, D'Billys Burguer, abria o relatório de julho com R$ 0,00 de
 * investimento e R$ 0,00 de faturamento. O backfill do mesmo período
 * trouxe 62 linhas, R$ 2.281,25 e R$ 16.970,00: o dado estava na Meta o
 * tempo inteiro, só nunca tinha sido buscado.
 *
 * O semanal sofre do mesmo mal na virada do mês: "últimos 7 dias" em 03
 * de setembro começa em 27 de agosto, e o sync do dia só cobre setembro.
 *
 * POR QUE AQUI, E NÃO NA ETAPA DE SYNC
 * ---------------------------------------------------------------------
 * A etapa de sync roda DEPOIS dos relatórios de propósito (ver a nota em
 * `api/cron/daily`), então o que ela traz só serviria ao relatório de
 * amanhã. Puxar aqui é o único ponto em que o dado chega antes de quem
 * precisa dele.
 *
 * O custo entra no orçamento sozinho: `custoObservado` mede a iteração
 * inteira, e a partir da segunda conta o job já sabe que um relatório de
 * mês fechado custa o PDF mais o backfill.
 *
 * SÓ QUANDO PRECISA. Janela inteiramente dentro do mês corrente já foi
 * coberta pela rodada de ontem — o semanal do meio do mês não paga nada.
 */
export function precisaDeBackfill(
  janelaStart: string,
  hojeISO: string,
): boolean {
  // O sync de rotina (`mode: "month"`) cobre do dia 1 deste mês até
  // hoje. Só o que começa ANTES disso nunca foi pedido à plataforma.
  return janelaStart < `${hojeISO.slice(0, 7)}-01`;
}

async function garantirDadosDoPeriodo(
  cliente: Client,
  janela: { start: string; end: string },
  hojeISO: string,
  jaFeitos: Set<string>,
): Promise<RelatorioDeDisparo["sincronizados"][number] | null> {
  if (isDemoMode) return null;
  if (!precisaDeBackfill(janela.start, hojeISO)) return null;

  const chave = `${cliente.id}|${janela.start}|${janela.end}`;
  if (jaFeitos.has(chave)) return null;
  jaFeitos.add(chave);

  const registro = {
    slug: cliente.slug,
    janela: `${janela.start}..${janela.end}`,
    linhas: 0,
  };

  try {
    /* Import dinâmico: `sync.ts` carrega os dois provedores de anúncios
       no topo. Estático, ele entraria em toda rota que importa este
       módulo — inclusive a tela de relatórios, que só precisa das datas. */
    const { syncAllClients } = await import("@/lib/ads/sync");

    const relatorio = await syncAllClients({
      clientId: cliente.id,
      range: { since: janela.start, until: janela.end },
    });

    registro.linhas = relatorio.totalRowsUpserted;

    /* Falha parcial NÃO interrompe. Uma conta com duas plataformas em
       que só o Google recusa o token ainda tem os números da Meta, e um
       relatório com um canal vale mais do que nenhum relatório. O que
       falhou fica dito no corpo da resposta do cron. */
    if (relatorio.failed > 0) {
      return {
        ...registro,
        erro: relatorio.results
          .filter((r) => !r.ok)
          .map((r) => `${r.platform}: ${r.message ?? r.code ?? "erro sem mensagem"}`)
          .join(" | "),
      };
    }

    return registro;
  } catch (error) {
    // Também não interrompe: o relatório sai com o que já existe no
    // banco. Sem dado nenhum ele sai zerado, que é o estado anterior a
    // este conserto — nunca pior.
    return {
      ...registro,
      erro: error instanceof Error ? error.message : "falha desconhecida",
    };
  }
}

/** Janela de N dias terminando ONTEM, ancorada numa data YYYY-MM-DD. */
function janelaAte(ontemISO: string, dias: number) {
  // T12:00 evita que o deslocamento de fuso jogue a data para o dia
  // anterior ao converter de volta para string.
  const fim = new Date(`${ontemISO}T12:00:00Z`);
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(inicio), end: iso(fim) };
}

/** Uma conta e a cadência pela qual ela caiu na rodada de hoje. */
interface Agendado {
  cliente: Client;
  cadencia: "mensal" | "semanal";
}

export async function dispatchScheduledReports(options?: {
  /** Teto de tempo total. Padrão: 60s, o limite do plano Hobby. */
  budgetMs?: number;
  /** Força um dia específico. Só para verificação manual. */
  diaForcado?: number;
  /**
   * Só as contas marcadas para ESTA hora (0–23, São Paulo).
   *
   * Omitir pega a agenda inteira do dia — que é o certo para quem roda
   * uma vez por dia. Ver `clientesDoDia`.
   */
  hora?: number;
}): Promise<RelatorioDeDisparo> {
  const inicio = Date.now();
  const orcamento = options?.budgetMs ?? 60_000;
  const prazoFinal = inicio + orcamento - RESERVA_MS;

  const hoje = hojeNoBrasil();
  const diaDoMes = options?.diaForcado ?? Number(hoje.slice(8, 10));

  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const ontemISO = ontem.toISOString().slice(0, 10);

  /* UMA JANELA POR CADÊNCIA, e as duas podem valer para o MESMO cliente
     no mesmo dia — desde a migration 48 mensal e semanal deixaram de ser
     modos exclusivos. Quando o dia do mês cai no dia da semana escolhido,
     a conta recebe os dois documentos: são períodos diferentes, então o
     índice de duplicidade aceita, e cada um responde uma pergunta
     distinta (o mês fechado e a semana corrente).

     `periodo` de topo é o mensal porque é ele que rotula a rodada no
     relatório de execução. */
  const periodo = mesAnterior(hoje);
  const janelaSemanal = janelaAte(ontemISO, 7);

  const base: RelatorioDeDisparo = {
    executadoEm: new Date().toISOString(),
    diaDoMes,
    periodo,
    agendados: 0,
    preparados: [],
    falhas: [],
    pulados: [],
    adiados: [],
    sincronizados: [],
  };

  /* Um mesmo cliente pode cair duas vezes na rodada (mensal e semanal).
     Sem esta memória, uma virada de mês pediria o mesmo backfill duas
     vezes e pagaria dois segundos de API por nada. */
  const backfillsFeitos = new Set<string>();

  /* `getUTCDay()` sobre o meio-dia UTC da data brasileira: o meio-dia
     evita que o deslocamento de fuso jogue a data para o dia anterior ou
     seguinte, que é o mesmo cuidado das outras contas de data aqui. */
  const diaDaSemana = new Date(`${hoje}T12:00:00Z`).getUTCDay();

  /* DESTRAVA O QUE FICOU PRESO, antes de qualquer coisa.

     A linha de `report_history` nasce em 'queued' antes de o PDF existir.
     Se a função for cortada no meio — teto da plataforma, erro de rede
     no upload —, sobra uma linha que nunca vira nada e que o índice
     `report_history_automated_unique` passa a usar para recusar toda
     nova tentativa daquele período. O cliente não recebe o relatório
     daquele mês, e a única pista é um status parado numa tabela que a
     tela nem lista.

     Marcar como 'failed' resolve os dois lados: o índice da migration 47
     ignora 'failed', então a retentativa passa; e a tentativa perdida
     fica registrada, que é o que responde "por que não chegou?".

     QUINZE MINUTOS porque o teto de uma função é medido em dezenas de
     segundos — nada legítimo fica 'generating' por quinze minutos. Curto
     demais mataria uma geração em andamento; longo demais faria o
     cliente esperar o mês seguinte. */
  await destravarPresos();

  const hora =
    options?.hora === undefined ||
    !Number.isInteger(options.hora) ||
    options.hora < 0 ||
    options.hora > 23
      ? null
      : options.hora;

  const agendados = await clientesDoDia(diaDoMes, diaDaSemana, hora);
  base.agendados = agendados.length;

  /* Custo do pior relatório JÁ MEDIDO nesta rodada.
     Enquanto é null vale o chute inicial. Não usar `max` contra o chute
     é proposital: um relatório real leva ~6s, e manter o piso de 20s
     faria o job adiar clientes que caberiam com folga — conservador ao
     ponto de virar defeito. */
  let custoObservado: number | null = null;
  const estimativa = () => custoObservado ?? CUSTO_INICIAL_MS;

  for (const { cliente, cadencia } of agendados) {
    // Sem destino não há o que tentar: falharia no envio depois de
    // gastar o tempo de gerar o PDF.
    if (!cliente.whatsapp_phone) {
      base.pulados.push({
        slug: cliente.slug,
        nome: cliente.name,
        motivo: "Cliente sem WhatsApp cadastrado — sem destino para o envio.",
      });
      continue;
    }

    if (Date.now() + estimativa() > prazoFinal) {
      base.adiados.push({
        slug: cliente.slug,
        nome: cliente.name,
        motivo: "Sem tempo de execução restante nesta rodada.",
      });
      continue;
    }

    const antes = Date.now();

    // A janela é a da CADÊNCIA desta entrada, não a da rodada — e o
    // mesmo cliente pode aparecer duas vezes, com janelas diferentes.
    const janela = cadencia === "semanal" ? janelaSemanal : periodo;

    /* ANTES DE GERAR, garante que o período existe no banco. Um mês
       fechado nunca foi pedido à plataforma pela rodada de rotina. */
    const backfill = await garantirDadosDoPeriodo(
      cliente,
      janela,
      hoje,
      backfillsFeitos,
    );
    if (backfill) base.sincronizados.push(backfill);

    const resultado = await generateAndDeliverReport({
      clientSlug: cliente.slug,
      periodStart: janela.start,
      periodEnd: janela.end,
      // Gera e ARQUIVA. O envio é manual, por uma pessoa, pelo
      // WhatsApp dela — ver `sendReportFromUser`.
      deliver: "none",
      source: systemSource(),
      automated: true,
    });

    // A medição real substitui a estimativa: da segunda iteração em
    // diante o job já sabe quanto custa um relatório NESTE ambiente —
    // que difere bastante entre a máquina local e o Chromium serverless.
    custoObservado = Math.max(custoObservado ?? 0, Date.now() - antes);

    const registro: ResultadoCliente = {
      slug: cliente.slug,
      nome: cliente.name,
      reportId: resultado.reportId,
    };

    if (resultado.ok) {
      base.preparados.push(registro);
      continue;
    }

    // Violação do índice parcial = já foi enviado neste período. É o
    // caso esperado de reexecução, não uma falha para investigar.
    if (/duplicate key|unique constraint/i.test(resultado.error ?? "")) {
      base.pulados.push({
        ...registro,
        motivo: "Relatório deste período já havia sido preparado.",
      });
      continue;
    }

    base.falhas.push({ ...registro, erro: resultado.error });
  }

  return base;
}

/**
 * Marca como 'failed' os automáticos presos em geração ou em envio.
 *
 * Silencioso de propósito: é higiene de início de rodada, não um evento.
 * O que interessa fica na própria linha — status e `error_message` — e é
 * lá que alguém vai olhar quando perguntarem por um relatório que não
 * chegou.
 *
 * ⚠️ 'sending' ENTROU, e o motivo é o índice. Uma linha automática presa
 * em 'sending' não era destravada por ninguém: `listarPendentes` não a
 * listava e este laço não a cobria. E como
 * `report_history_automated_unique` é `where is_automated and status <>
 * 'failed'`, ela continuava BLOQUEANDO qualquer nova geração daquele
 * período — o cliente nunca mais receberia o relatório daquela semana.
 * É o mesmo defeito que a migration 47 foi escrita para consertar, por
 * um status que ela não cobria.
 *
 * A MENSAGEM DIZ A AMBIGUIDADE porque ela é real: cortada entre gravar
 * 'sending' e a resposta da Evolution, a mensagem pode ter saído. Marcar
 * como falha é a escolha que DESTRAVA — e o texto avisa quem for olhar.
 * O envio manual não passa por aqui: ali a linha aparece na fila com
 * "Chegou / Não chegou", e quem decide é quem abre o grupo.
 *
 * `updated_at` e não `created_at` para o envio: a linha pode ter sido
 * criada de manhã pelo cron e só ter ido para 'sending' à tarde.
 */
async function destravarPresos(): Promise<void> {
  if (isDemoMode) return;

  const admin = createSupabaseAdminClient();
  const limite = new Date(Date.now() - 15 * 60_000).toISOString();

  await admin
    .from("report_history")
    .update({
      status: "failed",
      error_message:
        "Interrompido antes de terminar — a função foi cortada no meio da geração.",
    })
    .eq("is_automated", true)
    .in("status", ["queued", "generating"])
    .lt("created_at", limite);

  await admin
    .from("report_history")
    .update({
      status: "failed",
      /* O PREFIXO É CONTRATO com `listarPendentes`: é por ele que a fila
         reconhece a linha como PRESA e continua oferecendo "Chegou /
         Não chegou" em vez de um "Enviar" comum. Sem a marca, o cron
         apagava a ambiguidade que a tela tinha construído e a linha
         voltava no dia seguinte como falha qualquer. */
      error_message: `${MARCA_INTERROMPIDO} — PODE ter sido entregue. Confira o grupo do cliente antes de mandar de novo.`,
    })
    .eq("is_automated", true)
    .eq("status", "sending")
    .lt("updated_at", limite);
}

/**
 * A hora de quem foi cadastrado antes de a coluna existir.
 *
 * Espelha o `default 8` da migration 67. Repetido aqui porque a linha
 * pode chegar de `demoClients`, que não passa pelo banco — e um
 * `undefined` silencioso faria a conta nunca casar com hora nenhuma.
 */
const HORA_PADRAO = 8;

/**
 * Quem recebe hoje, e por qual cadência.
 *
 * DEVOLVE ENTRADAS, NÃO CLIENTES. Desde a migration 48 mensal e semanal
 * são agendas independentes: uma conta com `report_day = 8` e
 * `report_weekday = 1` aparece DUAS VEZES numa segunda-feira dia 8, cada
 * ocorrência com a janela dela. Devolver uma lista de clientes obrigaria
 * quem chama a redescobrir por que cada um entrou.
 *
 * DUAS CONSULTAS, não um `or` — o PostgREST monta `or` como texto e uma
 * expressão com dois pares de condições fica ilegível e frágil. Duas
 * consultas com índice cada, unidas em memória, custam o mesmo e dizem o
 * que fazem.
 */
async function clientesDoDia(
  diaDoMes: number,
  diaDaSemana: number,
  /**
   * A hora que está tocando, em São Paulo. `null` ignora a hora e pega
   * a agenda inteira do dia.
   *
   * `null` é o comportamento de quem chama uma vez por dia — o cron da
   * Vercel, e a verificação manual com `?dia=N`. Com gatilho horário
   * vem o número, e cada conta é preparada na hora combinada.
   */
  hora: number | null,
): Promise<Agendado[]> {
  const naHora = (c: { report_hour?: number | null }) =>
    hora === null || (c.report_hour ?? HORA_PADRAO) === hora;

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const ligados = demoClients.filter((c) => c.report_enabled && naHora(c));
    return [
      ...ligados
        .filter((c) => c.report_day === diaDoMes)
        .map((cliente) => ({ cliente, cadencia: "mensal" as const })),
      ...ligados
        .filter((c) => c.report_weekday === diaDaSemana)
        .map((cliente) => ({ cliente, cadencia: "semanal" as const })),
    ];
  }

  const admin = createSupabaseAdminClient();

  /* O FILTRO DA HORA VAI NO BANCO, não em memória. Com a carteira em 54
     contas a diferença é pequena; o que não é pequeno é a consulta
     trazer a agenda inteira do dia a cada hora e o código depender de
     lembrar de filtrar depois. */
  const daHora = <T extends { eq: (c: string, v: unknown) => T }>(q: T) =>
    hora === null ? q : q.eq("report_hour", hora);

  const [mensais, semanais] = await Promise.all([
    daHora(
      admin
        .from("clients")
        .select("*")
        .eq("report_enabled", true)
        .eq("report_day", diaDoMes)
        .eq("status", "active"),
    ).order("name"),
    daHora(
      admin
        .from("clients")
        .select("*")
        .eq("report_enabled", true)
        .eq("report_weekday", diaDaSemana)
        .eq("status", "active"),
    ).order("name"),
  ]);

  if (mensais.error) throw mensais.error;
  if (semanais.error) throw semanais.error;

  /* MENSAIS PRIMEIRO, de propósito. Quando o orçamento da rodada acaba,
     quem sobra é adiado — e perder o fechamento do mês custa mais que
     perder um acompanhamento semanal, que se repete em sete dias. */
  return [
    ...((mensais.data ?? []) as Client[]).map((cliente) => ({
      cliente,
      cadencia: "mensal" as const,
    })),
    ...((semanais.data ?? []) as Client[]).map((cliente) => ({
      cliente,
      cadencia: "semanal" as const,
    })),
  ];
}
