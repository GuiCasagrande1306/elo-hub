import "server-only";

import { isDemoMode } from "@/lib/env";
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

export async function dispatchScheduledReports(options?: {
  /** Teto de tempo total. Padrão: 60s, o limite do plano Hobby. */
  budgetMs?: number;
  /** Força um dia específico. Só para verificação manual. */
  diaForcado?: number;
}): Promise<RelatorioDeDisparo> {
  const inicio = Date.now();
  const orcamento = options?.budgetMs ?? 60_000;
  const prazoFinal = inicio + orcamento - RESERVA_MS;

  const hoje = hojeNoBrasil();
  const diaDoMes = options?.diaForcado ?? Number(hoje.slice(8, 10));

  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const ontemISO = ontem.toISOString().slice(0, 10);

  /* UMA JANELA POR CADÊNCIA. O mensal continua em 30 dias; o semanal
     cobre 7. Manter os 30 para quem recebe toda sexta produziria quatro
     relatórios quase idênticos por mês — mesmos números, mesmas
     campanhas, variando só as pontas. O `periodo` de topo permanece o
     mensal porque é ele que rotula a rodada no relatório de execução. */
  const periodo = janelaAte(ontemISO, 30);
  const janelaSemanal = janelaAte(ontemISO, 7);

  const janelaDe = (c: Client) =>
    (c.report_frequency ?? "monthly") === "weekly" ? janelaSemanal : periodo;

  const base: RelatorioDeDisparo = {
    executadoEm: new Date().toISOString(),
    diaDoMes,
    periodo,
    agendados: 0,
    preparados: [],
    falhas: [],
    pulados: [],
    adiados: [],
  };

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

  const clientes = await clientesDoDia(diaDoMes, diaDaSemana);
  base.agendados = clientes.length;

  /* Custo do pior relatório JÁ MEDIDO nesta rodada.
     Enquanto é null vale o chute inicial. Não usar `max` contra o chute
     é proposital: um relatório real leva ~6s, e manter o piso de 20s
     faria o job adiar clientes que caberiam com folga — conservador ao
     ponto de virar defeito. */
  let custoObservado: number | null = null;
  const estimativa = () => custoObservado ?? CUSTO_INICIAL_MS;

  for (const cliente of clientes) {
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

    // A janela é a da CADÊNCIA deste cliente, não a da rodada.
    const janela = janelaDe(cliente);

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
 * Marca como 'failed' os automáticos presos em 'queued'/'generating'.
 *
 * Silencioso de propósito: é higiene de início de rodada, não um evento.
 * O que interessa fica na própria linha — status e `error_message` — e é
 * lá que alguém vai olhar quando perguntarem por um relatório que não
 * chegou.
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
}

/** Clientes com envio automático ligado para este dia do mês. */
/**
 * Quem recebe hoje: os mensais do dia do mês E os semanais deste dia da
 * semana.
 *
 * DUAS CONSULTAS, não um `or` — o PostgREST monta `or` como texto e uma
 * expressão com dois pares de condições fica ilegível e frágil. Duas
 * consultas com índice cada, unidas em memória, custam o mesmo e dizem o
 * que fazem.
 *
 * Cliente sem `report_frequency` (linha anterior à migration 40) é
 * tratado como mensal, que é o default da coluna — o `is` cobre o nulo
 * junto do valor explícito, senão a carteira inteira sumiria da agenda
 * entre o deploy e a migration.
 */
async function clientesDoDia(
  diaDoMes: number,
  diaDaSemana: number,
): Promise<Client[]> {
  const ehMensal = (c: Client) => (c.report_frequency ?? "monthly") === "monthly";

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.filter(
      (c) =>
        c.report_enabled &&
        (ehMensal(c)
          ? c.report_day === diaDoMes
          : c.report_weekday === diaDaSemana),
    );
  }

  const admin = createSupabaseAdminClient();

  const mensais = await admin
    .from("clients")
    .select("*")
    .eq("report_enabled", true)
    .eq("report_day", diaDoMes)
    .eq("status", "active");

  /* 42703 = a coluna ainda não existe (deploy antes da migration 40).
     Nesse estado toda conta é mensal por definição, então a consulta sem
     o filtro de frequência JÁ é a resposta certa — e insistir nela
     derrubaria a rodada inteira do cron por um recurso que ninguém
     conseguiu configurar ainda. */
  if (mensais.error) {
    if (mensais.error.code === "42703") {
      const semColuna = await admin
        .from("clients")
        .select("*")
        .eq("report_enabled", true)
        .eq("report_day", diaDoMes)
        .eq("status", "active")
        .order("name");

      if (semColuna.error) throw semColuna.error;
      return (semColuna.data ?? []) as Client[];
    }
    throw mensais.error;
  }

  const semanais = await admin
    .from("clients")
    .select("*")
    .eq("report_enabled", true)
    .eq("report_weekday", diaDaSemana)
    .eq("report_frequency", "weekly")
    .eq("status", "active");

  if (semanais.error && semanais.error.code !== "42703") throw semanais.error;

  /* O filtro de mensal exclui os semanais em MEMÓRIA: com a coluna
     recém-criada e nula nas linhas antigas, um `.neq("report_frequency",
     "weekly")` no banco descartaria justamente essas — o Postgres trata
     `null <> 'weekly'` como desconhecido, não como verdadeiro, e a
     carteira inteira sumiria da agenda. */
  const soMensais = ((mensais.data ?? []) as Client[]).filter(
    (c) => (c.report_frequency ?? "monthly") !== "weekly",
  );

  return [...soMensais, ...((semanais.data ?? []) as Client[])].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}
