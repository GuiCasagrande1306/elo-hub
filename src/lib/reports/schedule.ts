import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateAndDeliverReport } from "./orchestrator";
import { systemSource } from "./source";
import type { Client } from "@/types/database";

/* =====================================================================
   Disparo automático de relatórios
   ---------------------------------------------------------------------
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
  enviados: ResultadoCliente[];
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
  const periodo = janelaAte(ontem.toISOString().slice(0, 10), 30);

  const base: RelatorioDeDisparo = {
    executadoEm: new Date().toISOString(),
    diaDoMes,
    periodo,
    agendados: 0,
    enviados: [],
    falhas: [],
    pulados: [],
    adiados: [],
  };

  const clientes = await clientesDoDia(diaDoMes);
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
        motivo: "Cliente sem WhatsApp cadastrado.",
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

    const resultado = await generateAndDeliverReport({
      clientSlug: cliente.slug,
      periodStart: periodo.start,
      periodEnd: periodo.end,
      deliver: "whatsapp",
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
      base.enviados.push(registro);
      continue;
    }

    // Violação do índice parcial = já foi enviado neste período. É o
    // caso esperado de reexecução, não uma falha para investigar.
    if (/duplicate key|unique constraint/i.test(resultado.error ?? "")) {
      base.pulados.push({
        ...registro,
        motivo: "Relatório deste período já havia sido enviado.",
      });
      continue;
    }

    base.falhas.push({ ...registro, erro: resultado.error });
  }

  return base;
}

/** Clientes com envio automático ligado para este dia do mês. */
async function clientesDoDia(dia: number): Promise<Client[]> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    return demoClients.filter(
      (c) => c.report_enabled && c.report_day === dia,
    );
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .select("*")
    .eq("report_enabled", true)
    .eq("report_day", dia)
    .eq("status", "active")
    .order("name");

  if (error) throw error;
  return (data ?? []) as Client[];
}
