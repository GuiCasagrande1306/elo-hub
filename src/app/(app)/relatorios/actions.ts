"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { getClients, getReports } from "@/lib/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { buildGroupCaption } from "@/lib/reports/payload";
import { getMensagemDoCliente } from "@/lib/reports/mensagem-settings";
import {
  MARCADORES,
  mensagemDoCliente,
} from "@/lib/reports/mensagem-do-cliente";
import { formatPeriod } from "@/lib/format";
import { sendReportFromUser } from "@/lib/whatsapp/session";
import type { Client, ReportHistory } from "@/types/database";

/* =====================================================================
   Envio manual do relatório
   ---------------------------------------------------------------------
   O cron prepara; uma pessoa despacha. Quem despacha manda PELO PRÓPRIO
   WHATSAPP, então o cliente vê a mensagem vindo de um humano conhecido,
   não de um número da agência que ninguém salvou.
   ===================================================================== */

export interface EnvioPendente {
  report: ReportHistory;
  client: Client;
  /**
   * Link para CONFERIR o PDF, assinado agora.
   *
   * NÃO é `report.public_url`. Aquele foi assinado quando o arquivo
   * nasceu e vale 7 dias — o mesmo motivo pelo qual `enviarRelatorio`
   * reassina antes de despachar. A fila usava o campo gravado, então um
   * relatório preparado e esquecido por mais de uma semana mostrava um
   * botão "Conferir PDF" que abria erro do Storage. Justamente na tela
   * cujo propósito declarado é olhar o arquivo ANTES de o cliente ver.
   *
   * `null` quando o PDF não existe ou a assinatura falhou — aí o link
   * some, em vez de aparecer quebrado.
   */
  pdfUrl: string | null;
}

/**
 * Relatórios gerados e ainda não enviados.
 *
 * A leitura passa por `getReports`, que usa RLS: um colaborador só vê
 * os relatórios das contas dele. A tela não filtra nada à mão.
 */
export async function listarPendentes(): Promise<EnvioPendente[]> {
  const [reports, clients] = await Promise.all([getReports(), getClients()]);

  const pendentes = reports
    .filter((r) => r.status === "ready" || r.status === "failed")
    .map((report) => {
      const client = clients.find((c) => c.id === report.client_id);
      return client ? { report, client } : null;
    })
    .filter((x): x is { report: ReportHistory; client: Client } => x !== null);

  /* Uma assinatura por linha, em paralelo. São unidades de relatório
     por dia, não milhares — e o Storage assina sem ida ao banco. Uma
     hora basta: o link serve para conferir agora, não para arquivar. */
  const admin = isDemoMode ? null : createSupabaseAdminClient();

  return Promise.all(
    pendentes.map(async (item) => {
      if (!admin || !item.report.storage_path) {
        return { ...item, pdfUrl: null };
      }
      const { data } = await admin.storage
        .from("report-pdfs")
        .createSignedUrl(item.report.storage_path, 60 * 60);
      return { ...item, pdfUrl: data?.signedUrl ?? null };
    }),
  );
}

/** Dias que a janela cobre, contando as duas pontas. */
function diasEntre(inicio: string, fim: string): number {
  return (
    Math.round(
      (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

export interface ResultadoEnvio {
  ok: boolean;
  error?: string;
}

export async function enviarRelatorio(
  reportId: string,
): Promise<ResultadoEnvio> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  if (isDemoMode) {
    return {
      ok: false,
      error: "Modo demo: o envio real exige banco e WhatsApp configurados.",
    };
  }

  const supabase = await createSupabaseServerClient();

  /* A leitura passa pelo RLS: se o usuário não tem acesso à conta, o
     relatório volta vazio e o envio nem começa. É a mesma barreira que
     protege o resto do sistema — não há checagem paralela aqui. */
  const { data: report } = await supabase
    .from("report_history")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    return { ok: false, error: "Relatório não encontrado ou sem permissão." };
  }

  const linha = report as ReportHistory;

  if (linha.status === "sent") {
    return { ok: false, error: "Este relatório já foi enviado." };
  }

  if (!linha.storage_path) {
    return { ok: false, error: "O PDF ainda não foi gerado." };
  }

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", linha.client_id)
    .maybeSingle();

  if (!client) {
    return { ok: false, error: "Cliente não encontrado ou sem permissão." };
  }

  const destino = (client as Client).whatsapp_phone;
  if (!destino) {
    return { ok: false, error: "Cliente sem WhatsApp cadastrado." };
  }

  /* URL assinada NOVA, não a gravada em `public_url`.
     Aquela foi assinada quando o PDF nasceu e vale 7 dias; um relatório
     preparado e esquecido por duas semanas teria um link morto, e a
     Evolution falharia ao baixar o arquivo com erro genérico. */
  const admin = createSupabaseAdminClient();
  const { data: assinada } = await admin.storage
    .from("report-pdfs")
    .createSignedUrl(linha.storage_path, 60 * 60);

  if (!assinada?.signedUrl) {
    return { ok: false, error: "Não foi possível assinar a URL do PDF." };
  }

  await supabase
    .from("report_history")
    .update({ status: "sending" })
    .eq("id", reportId);

  /* O texto gravado, buscado agora. O snapshot dá o PERÍODO; a voz vem
     da configuração vigente. */
  const modelo = await getMensagemDoCliente();

  const legenda =
    linha.snapshot && typeof linha.snapshot === "object"
      ? buildGroupCaption(linha.snapshot as never, modelo)
      : /* Sem snapshot — relatório antigo. Monta com o mesmo texto, e o
           período sai das colunas da própria linha do histórico. */
        mensagemDoCliente(
          {
            periodoLabel: formatPeriod(linha.period_start, linha.period_end),
            dias: diasEntre(linha.period_start, linha.period_end),
            cliente: (client as Client).name,
          },
          modelo,
        );

  const resultado = await sendReportFromUser(
    user.id,
    destino,
    assinada.signedUrl,
    legenda,
    (client as Client).name,
  );

  if (!resultado.success) {
    // O `storage_path` continua intacto: dá para reenviar sem regerar.
    await supabase
      .from("report_history")
      .update({ status: "failed", error_message: resultado.error })
      .eq("id", reportId);

    return { ok: false, error: resultado.error };
  }

  await supabase
    .from("report_history")
    .update({
      status: "sent",
      channel: "whatsapp",
      recipient: destino,
      delivered_at: new Date().toISOString(),
      provider_message_id: resultado.messageId,
      // Quem clicou. Sem isto não há como saber depois quem despachou.
      generated_by: linha.generated_by ?? user.id,
    })
    .eq("id", reportId);

  revalidatePath("/relatorios");
  return { ok: true };
}

/* =====================================================================
   Edição dos templates por segmento
   ---------------------------------------------------------------------
   Quem barra colaborador é a policy `report_templates_admin`, que exige
   `app.is_admin()`. Não repito a checagem aqui: duas fontes de verdade
   sobre permissão divergem, e a que envelhece é sempre a da aplicação.

   ⚠️ Até a migration 30 a tabela tinha a policy mas NÃO tinha
   `grant update` — o Postgres recusava antes de avaliar a policy, e o
   salvamento falhava com 42501. Se voltar a dar "permissão negada" num
   admin, é grant, não policy.
   ===================================================================== */

const templateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240),
  /* Ordem importa: é a ordem dos KPIs no PDF. */
  metrics: z.array(z.string()).min(1).max(8),
  /* Rótulo por métrica. O mesmo `conversions` é "Vendas" na loja e
     "Contatos" no negócio local — sem isto o cliente não reconhece o
     próprio negócio no relatório. */
  metricLabels: z.record(z.string(), z.string().trim().max(40)),
  /* Vazio = capa sem destaque. A coerência com `metrics` é conferida
     abaixo e no banco — o check da migration 45 é a rede final. */
  highlightMetric: z.string().nullable(),
});

export async function salvarTemplate(input: {
  id: string;
  name: string;
  description: string;
  metrics: string[];
  metricLabels: Record<string, string>;
  highlightMetric: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Confira nome, descrição e métricas." };
  }

  const { id, name, description, metrics, metricLabels, highlightMetric } =
    parsed.data;

  /* Recusa AQUI, com frase legível, antes de o banco recusar com o texto
     cru do check. Acontece de verdade: tirar da lista a métrica que
     estava destacada é o caminho natural de quem está reorganizando. */
  if (highlightMetric && !metrics.includes(highlightMetric)) {
    return {
      ok: false,
      error: "A métrica em destaque precisa estar entre as métricas escolhidas.",
    };
  }

  /* Rótulo em branco significa "usar o padrão da métrica", não string
     vazia — gravar "" faria o PDF imprimir um cabeçalho sem texto. */
  const rotulos = Object.fromEntries(
    Object.entries(metricLabels).filter(([, v]) => v.trim().length > 0),
  );

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("report_templates")
    .update({
      name,
      description: description || null,
      metrics,
      metric_labels: rotulos,
      highlight_metric: highlightMetric,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Apenas administradores editam templates." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/relatorios");
  return { ok: true };
}

/* =====================================================================
   A mensagem que acompanha o relatório
   ---------------------------------------------------------------------
   Quem barra colaborador é a policy `report_message_settings_escrita`,
   que exige `app.is_admin()`. Não repito a checagem aqui: duas fontes
   de verdade sobre permissão divergem, e a que envelhece é a da
   aplicação.
   ===================================================================== */

const mensagemSchema = z.object({
  /* O teto é 900 e não 1024 pelo mesmo motivo do check no banco: o
     WhatsApp corta em 1024 e a substituição de `{periodo}` CRESCE o
     texto. A folga evita legenda truncada no meio da frase. */
  template: z.string().trim().min(1).max(900),
});

export async function salvarMensagemDoCliente(input: {
  template: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = mensagemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "A mensagem precisa ter entre 1 e 900 caracteres.",
    };
  }

  /* MARCADOR DESCONHECIDO É ERRO DE DIGITAÇÃO, e ele chegaria cru ao
     cliente. "{periodo }" ou "{cliente}" com acento passam pelo tamanho
     e pelo check do banco, e o texto sai com a chave literal no meio.
     Melhor recusar aqui, onde dá para dizer qual é. */
  const conhecidos = new Set<string>(MARCADORES.map((m) => m.chave));
  const usados = parsed.data.template.match(/\{[^}]*\}/g) ?? [];
  const invalido = usados.find((m) => !conhecidos.has(m));
  if (invalido) {
    return {
      ok: false,
      error: `"${invalido}" não é um marcador conhecido. Use ${[...conhecidos].join(" ou ")}.`,
    };
  }

  if (isDemoMode) return { ok: true };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  /* ⚠️ `count`, E ELE É A CHECAGEM DE PERMISSÃO. Um `update` que não
     casa NENHUMA linha volta com `error: null` — sucesso silencioso. E
     é exatamente o que a RLS produz aqui: a policy de escrita exige
     `app.is_admin()`, então para um colaborador a linha simplesmente
     não existe, o Postgres não recusa nada e a ação devolvia `ok`.

     Medido em 27/08/2026 contra o servidor local: colaborador recebia
     "Mensagem salva.", o banco continuava com o texto anterior, e não
     havia nada na tela dizendo o contrário. O mesmo defeito já tinha
     aparecido em `setAdAccountId` — é o formato do PostgREST, não um
     descuido isolado, e todo update sob RLS precisa desta contagem. */
  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("report_message_settings")
    .update(
      {
        template: parsed.data.template,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { count: "exact" },
    )
    .eq("id", true);

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Apenas administradores editam a mensagem." };
    }
    return { ok: false, error: error.message };
  }

  if (count === 0) {
    return { ok: false, error: "Apenas administradores editam a mensagem." };
  }

  revalidatePath("/relatorios");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Agenda de envio — em lote, direto da tela de Relatórios             */
/* ------------------------------------------------------------------ */

const agendaSchema = z.object({
  /* `min(1)` e NÃO `uuid()`: o formato do id é assunto do banco, que
     recusa o que não for uuid, e a coluna já está sob RLS. Exigir uuid
     aqui quebrava o modo demonstração inteiro — os ids de lá são
     `c-nord` — e a tela ficava sem como mostrar o fluxo que ela existe
     para mostrar. */
  clientId: z.string().min(1),
  /* `null` = sem envio recorrente. 28 é o teto pelo mesmo motivo do
     banco e do faturamento: fevereiro existe, e dia 30 nunca chegaria. */
  reportDay: z.number().int().min(1).max(28).nullable(),
  /* 0=domingo a 6=sábado, como `Date.getDay()`. INDEPENDENTE de
     `reportDay` desde a migration 48: a conta pode ter as duas agendas,
     e havia aqui um campo `frequency` que as tratava como exclusivas. */
  reportWeekday: z.number().int().min(0).max(6).nullable(),
  /* A HORA vale para as duas cadências — o que a conta combina com o
     cliente é o turno, não um horário por tipo de relatório. Sem valor
     cai em 8, o mesmo default da migration 67. */
  reportHour: z.number().int().min(0).max(23).default(8),
  enabled: z.boolean(),
  /* Telefone OU JID de grupo (`...@g.us`). Vazio limpa o destino. */
  whatsapp: z.string().trim().max(120),
});

/**
 * Grava destino, dia e liga/desliga o envio de UM cliente.
 *
 * Existe porque isso só era editável dentro do formulário completo do
 * cliente, um diálogo por vez — e com 47 contas o resultado foi que
 * NENHUMA ficou configurada. Mesma razão da tabela de contratos em
 * Recorrência: quando são dezenas de linhas vindas de uma planilha,
 * abrir e fechar um diálogo por linha é a diferença entre a tela ser
 * usada e não ser.
 *
 * Sem checagem de papel: quem barra é a policy do banco em `clients`,
 * como nas outras ações de cadastro. Uma segunda fonte de verdade sobre
 * permissão aqui seria a que fica desatualizada.
 */
export async function salvarAgendaDeRelatorio(input: {
  clientId: string;
  /** Dia do mês (1-28) do relatório MENSAL. `null` = sem agenda mensal. */
  reportDay: number | null;
  /** Dia da semana (0-6) do SEMANAL. `null` = sem agenda semanal. */
  reportWeekday: number | null;
  /** Hora de São Paulo (0-23) em que o relatório fica pronto. */
  reportHour?: number;
  enabled: boolean;
  whatsapp: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = agendaSchema.safeParse(input);
  if (!parsed.success) {
    /* A mensagem do zod em vez de uma genérica: "Dia ou destino
       inválido" não diz QUAL dos dois, e foi exatamente o que mascarou
       um bug antigo — o id é que estava sendo recusado, não o dia. */
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const { clientId, reportDay, reportWeekday, reportHour, enabled, whatsapp } =
    parsed.data;

  /* LIGADO SEM NENHUMA AGENDA NUNCA DISPARA. O job procura por dia do
     mês e por dia da semana; sem nenhum dos dois o cliente fica para
     sempre em silêncio, parecendo configurado. Recusar aqui é o que
     impede a tela de mostrar "pronto" para quem não está.

     As duas juntas são LEGÍTIMAS desde a migration 48 — é o caso de quem
     recebe o fechamento do mês e um acompanhamento semanal. */
  if (enabled && reportDay === null && reportWeekday === null) {
    return {
      ok: false,
      error: "Escolha o dia do mês, o dia da semana, ou os dois.",
    };
  }

  if (enabled && whatsapp === "") {
    return {
      ok: false,
      error: "Sem destino no WhatsApp o relatório é gerado e não sai.",
    };
  }

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === clientId);
    if (alvo) {
      alvo.report_day = reportDay;
      alvo.report_weekday = reportWeekday;
      alvo.report_hour = reportHour;
      alvo.report_enabled = enabled;
      alvo.whatsapp_phone = whatsapp || null;
    }
    revalidatePath("/relatorios");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* AS DUAS COLUNAS VÃO SEMPRE, cada uma com o que a tela mandou. Não há
     mais "cadência escolhida" para zerar a outra: elas são independentes,
     e apagar uma ao salvar a outra desfaria metade da configuração de
     quem usa as duas. */
  const { error } = await supabase
    .from("clients")
    .update({
      report_day: reportDay,
      report_weekday: reportWeekday,
      report_hour: reportHour,
      report_enabled: enabled,
      whatsapp_phone: whatsapp || null,
    })
    .eq("id", clientId);

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "O banco recusou a alteração. Fale com um administrador."
          : error.message,
    };
  }

  revalidatePath("/relatorios");
  return { ok: true };
}


/* ------------------------------------------------------------------ */
/* Resumo de um período escolhido na tela                              */
/* ------------------------------------------------------------------ */

const resumoSchema = z.object({
  clientId: z.string().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ResumoDoPeriodo = {
  spendCents: number;
  /** Cru, sem unidade aplicada — ver a nota da função. */
  conversions: number;
  revenueCents: number;
  /**
   * Os mesmos totais contados só nas campanhas de origem.
   *
   * É de onde saem CUSTO e RETORNO no cartão da tela — as duas razões
   * que o PDF também divide pela campanha que compra o resultado. O
   * volume (investimento, pedidos) continua vindo da conta inteira.
   */
  origem: { spendCents: number; conversions: number; revenueCents: number };
  /**
   * Quantas linhas de `daily_metrics` existem na janela.
   *
   * ZERO LINHA E ZERO REAL SÃO COISAS DIFERENTES, e a tela precisa
   * distinguir: "a conta não gastou nada em julho" contra "julho nunca
   * foi sincronizado". Os dois exibiam R$ 0,00 e a segunda leitura era
   * indistinguível da primeira — foi exatamente assim que um mês
   * inteiro sem backfill passou por relatório pronto para enviar.
   */
  linhas: number;
};

/**
 * Soma as métricas da conta na janela pedida.
 *
 * ⚠️ ESTA AÇÃO É O QUE TORNA O SELETOR DE PERÍODO HONESTO. A estação de
 * comando já teve um seletor e ele foi REMOVIDO porque mentia: trocava a
 * frase ("resumo dos últimos 7 dias") sem trocar os números, que
 * continuavam sendo os do mês inteiro. O comentário no componente
 * registrava a dívida — "voltará quando houver busca de verdade por
 * intervalo". É esta.
 *
 * O texto montado naquela tela é copiado e enviado ao cliente final. Um
 * controle que muda o rótulo e não o dado é pior que controle nenhum:
 * produz um número errado com aparência de conferido.
 *
 * A leitura passa por `getMetrics`, que roda sob RLS — um colaborador
 * não soma a carteira de quem não atende.
 *
 * ⚠️ DEVOLVE OS TOTAIS CRUS, e não "o resultado" já resolvido. A versão
 * anterior escolhia a unidade aqui, chamando `goalMetricFor(segment,
 * null)` — e `null` naquele parâmetro significa "meta antiga, logo
 * CONTAGEM", que é exatamente o que a documentação da função avisa.
 * Resultado medido na tela: conta de e-commerce com R$ 12.170,81 de
 * receita na janela exibindo "R$ 0,64", porque as 64 conversões estavam
 * sendo formatadas como dinheiro.
 *
 * A unidade tem UM dono: `cliente.metric`, que o servidor já resolveu
 * para os números iniciais. Quem chama aplica `goalExecutedFrom` com ela
 * e os dois lados nunca discordam.
 */
export async function resumoDoPeriodo(
  input: z.input<typeof resumoSchema>,
): Promise<{ ok: true; resumo: ResumoDoPeriodo } | { ok: false; error: string }> {
  const parsed = resumoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Período inválido." };

  const { clientId, start, end } = parsed.data;
  if (end < start) {
    return { ok: false, error: "O fim do período é anterior ao início." };
  }

  const { getClients, getMetrics } = await import("@/lib/data");
  const { sumMetrics } = await import("@/lib/metrics/kpi");
  const { tiposDeConversaoDoCliente } = await import(
    "@/lib/ads/conversao-do-cliente"
  );

  /* A leitura de clientes existe só para provar que a conta é visível
     para quem pediu: `getClients` roda sob RLS, e sem ela um id
     adivinhado somaria a carteira de outra agência. */
  const visivel = (await getClients()).some((c) => c.id === clientId);
  if (!visivel) return { ok: false, error: "Conta não encontrada." };

  const metricas = await getMetrics(clientId, start, end);
  /* Com os tipos: é o que faz o cartão da tela mostrar o mesmo custo e o
     mesmo retorno que o PDF gerado logo abaixo dele. */
  const totais = sumMetrics(
    metricas,
    await tiposDeConversaoDoCliente(clientId),
  );

  return {
    ok: true,
    resumo: {
      spendCents: totais.spendCents,
      conversions: totais.conversions,
      revenueCents: totais.revenueCents,
      origem: {
        spendCents: totais.origem.spendCents,
        conversions: totais.origem.conversions,
        revenueCents: totais.origem.revenueCents,
      },
      linhas: metricas.length,
    },
  };
}
