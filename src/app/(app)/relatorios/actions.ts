"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { getClients, getReports } from "@/lib/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { buildGroupCaption } from "@/lib/reports/payload";
import { MARCA_INTERROMPIDO } from "@/lib/reports/envio-interrompido";
import { getMensagemDoCliente } from "@/lib/reports/mensagem-settings";
import {
  MARCADORES,
  mensagemDoCliente,
} from "@/lib/reports/mensagem-do-cliente";
import { formatDate, formatPeriod } from "@/lib/format";
import type { MetricTotals } from "@/lib/metrics/kpi";
import { sendReportFromUser } from "@/lib/whatsapp/session";
import type { Client, ReportHistory } from "@/types/database";

/* =====================================================================
   Envio manual do relatório
   ---------------------------------------------------------------------
   O cron prepara; uma pessoa despacha. Quem despacha manda PELO PRÓPRIO
   WHATSAPP, então o cliente vê a mensagem vindo de um humano conhecido,
   não de um número da agência que ninguém salvou.
   ===================================================================== */

/**
 * Depois de quantos minutos um 'sending' é considerado preso.
 *
 * `sendReportFromUser` faz DUAS chamadas à Evolution, de 25s cada no
 * pior caso — nenhum envio honesto passa de um minuto. Cinco dá folga
 * para uma Evolution acordando do sono no Railway sem confundir lentidão
 * com interrupção.
 */
const MINUTOS_PRESO = 5;

/** Períodos já entregues, lidos sem RLS. Ver a nota em `listarPendentes`. */
async function periodosEntregues(): Promise<
  { client_id: string; period_start: string; period_end: string }[]
> {
  if (isDemoMode) return [];
  const { data } = await createSupabaseAdminClient()
    .from("report_history")
    .select("client_id, period_start, period_end")
    .eq("status", "sent");
  return (data ?? []) as {
    client_id: string;
    period_start: string;
    period_end: string;
  }[];
}

export interface EnvioPendente {
  report: ReportHistory;
  client: Client;
  /**
   * A linha ficou parada em 'sending'.
   *
   * ⚠️ ESTADO AMBÍGUO, e a tela precisa dizer isso. A função foi cortada
   * entre gravar 'sending' e receber a resposta da Evolution — a
   * mensagem PODE ter saído. Reenviar duplica; não reenviar deixa o
   * cliente sem relatório. Quem decide é quem olha o grupo.
   *
   * Antes destas linhas o registro simplesmente sumia: `listarPendentes`
   * só listava 'ready' e 'failed', `destravarPresos` só destravava
   * 'queued' e 'generating', e o histórico mostrava "Enviando" sem
   * botão. Não havia caminho na aplicação para retomar.
   */
  presoEmEnvio: boolean;
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

  /* PERÍODO JÁ ENTREGUE SAI DA FILA.
     -----------------------------------------------------------------
     Uma tentativa que falha vira 'failed' e a tentativa seguinte cria
     uma linha NOVA — então o par "failed + sent do mesmo período" fica
     na tabela, e a linha morta seguia oferecendo o botão para sempre.

     Existe no banco desde 24/08/2026: Seu Parma tem 'failed' às 20:21 e
     'sent' às 20:23 para 17–23/08. Quem varre a fila para despachar os
     do dia clica e o cliente recebe a semana passada de novo, com o
     snapshot de três dias antes e sem nada avisando.

     A chave é conta + janela, não o id: são linhas diferentes falando
     do mesmo relatório. */
  /* ⚠️ SERVICE_ROLE PARA ESTA PERGUNTA, e só para ela.
     -----------------------------------------------------------------
     `getReports()` lê sob RLS, e `report_history_select` devolve ao
     colaborador apenas `generated_by = auth.uid() or generated_by is
     null`. Ou seja: a linha 'sent' que esta trava precisa enxergar é
     justamente a que fica INVISÍVEL para quem não a enviou.

     O efeito era a trava valer só para admin e para quem despachou.
     Marina entrega o relatório; João abre a fila, não vê a linha dela,
     vê a do cron em 'failed' com botão normal, clica, e o grupo recebe
     duas vezes — exatamente o defeito que este bloco existe para
     impedir. E despachar é trabalho de colaborador: metade dos envios
     no histórico saiu do WhatsApp do Bernardo.

     A AUTORIZAÇÃO NÃO MUDA. Quem entra na fila continua sendo decidido
     por `getReports()` sob RLS; o admin aqui só responde "este período
     já saiu?", que é um sim/não sobre conta que a pessoa já enxerga. */
  const entregues = new Set(
    (await periodosEntregues()).map(
      (r) => `${r.client_id}|${r.period_start}|${r.period_end}`,
    ),
  );

  const limitePreso = Date.now() - MINUTOS_PRESO * 60_000;

  const pendentes = reports
    .filter((r) => {
      if (entregues.has(`${r.client_id}|${r.period_start}|${r.period_end}`)) {
        return false;
      }
      if (r.status === "ready" || r.status === "failed") return true;
      /* 'sending' só entra quando está PRESO. Recente é envio em
         andamento de outra aba, e mostrá-lo convidaria ao clique duplo
         que a reserva atômica existe para barrar. */
      return (
        r.status === "sending" &&
        Date.parse(r.updated_at ?? r.created_at) < limitePreso
      );
    })
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
      /* 'failed' COM A MARCA também é preso: foi o cron que o tirou de
         'sending' para destravar o índice, e a ambiguidade continua a
         mesma. Sem isto a linha reaparecia no dia seguinte com botão
         "Enviar" comum, e quem estivesse de plantão mandaria de novo um
         relatório que talvez já tivesse chegado. */
      const presoEmEnvio =
        item.report.status === "sending" ||
        (item.report.status === "failed" &&
          (item.report.error_message ?? "").startsWith(MARCA_INTERROMPIDO));

      if (!admin || !item.report.storage_path) {
        return { ...item, pdfUrl: null, presoEmEnvio };
      }
      const { data } = await admin.storage
        .from("report-pdfs")
        .createSignedUrl(item.report.storage_path, 60 * 60);
      return { ...item, pdfUrl: data?.signedUrl ?? null, presoEmEnvio };
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

  /* OUTRA LINHA JÁ ENTREGOU ESTE PERÍODO?
     -----------------------------------------------------------------
     A trava acima olha só a PRÓPRIA linha. Quando um envio falha, a
     tentativa seguinte cria uma linha nova — e a que falhou continua
     por aí, com PDF e botão, apontando para o mesmo cliente e a mesma
     janela que já chegaram ao grupo.

     `report_history_automated_unique` não cobre: o índice é parcial,
     `where is_automated`, e o disparo manual passa por fora. */
  /* Sem RLS pelo mesmo motivo do Set em `listarPendentes`: a irmã que
     interessa costuma ser de outra pessoa, e é justamente a que a
     policy esconde. */
  const { data: irmas } = await createSupabaseAdminClient()
    .from("report_history")
    .select("id, delivered_at")
    .eq("client_id", linha.client_id)
    .eq("period_start", linha.period_start)
    .eq("period_end", linha.period_end)
    .eq("status", "sent")
    .limit(1);

  if (irmas && irmas.length > 0) {
    const quando = irmas[0].delivered_at as string | null;
    return {
      ok: false,
      error: quando
        ? `Este período já foi entregue em ${formatDate(quando)}. Se precisar mandar de novo, gere um relatório novo na estação.`
        : "Este período já foi entregue a este cliente.",
    };
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

  /* RESERVA ATÔMICA, e é ela que impede o envio em dobro.
     -----------------------------------------------------------------
     O ciclo era ler, conferir `status === 'sent'` e só então gravar
     'sending' — sem condição no update e sem olhar quantas linhas
     mudaram. Nada reservava a linha. O `useTransition` de cada botão
     protege UM componente, não duas abas nem duas pessoas despachando a
     mesma fila.

     Aqui a condição vai no WHERE: só sai de 'ready' ou 'failed'. Quem
     chegar em segundo casa zero linha, `count` volta 0, e o envio nem
     começa — é o banco serializando, não a aplicação torcendo.

     'sending' NÃO entra na lista de propósito: quem está em envio ou
     está saindo agora (e duplicar seria o defeito) ou está preso, e
     preso passa por `retomarEnvioPreso`, que exige uma decisão de quem
     olhou o grupo. */
  const { error: erroReserva, count: reservadas } = await supabase
    .from("report_history")
    .update({ status: "sending" }, { count: "exact" })
    .eq("id", reportId)
    .in("status", ["ready", "failed"]);

  /* ⚠️ `!== 1`, E NÃO `=== 0`. Quando o PATCH falha de verdade — 5xx do
     PostgREST, timeout, conexão caída — `count` volta `null`, e
     `null === 0` é falso: a função seguia para o envio sem ter
     reservado nada. Era fail-open no único caminho em que o banco não
     respondeu, o oposto do que a reserva promete. Um `error` também
     precisa parar aqui: sem reserva, não há envio. */
  if (erroReserva || reservadas !== 1) {
    /* 23505 = o índice `report_history_um_envio_por_periodo` (migration
       74). Significa que OUTRA linha do mesmo cliente e do mesmo
       período já está saindo — a corrida que a reserva por `id` não
       cobria, porque ids diferentes reservam sem se ver. */
    const emCorrida = erroReserva?.code === "23505";
    return {
      ok: false,
      error:
        emCorrida || !erroReserva
          ? "Este período já está sendo enviado agora — confira o grupo antes de tentar de novo."
          : `Não deu para reservar o envio: ${erroReserva.message}`,
    };
  }

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

/**
 * Resolve uma linha presa em 'sending'.
 *
 * ⚠️ NÃO ADIVINHA. Uma função cortada entre gravar 'sending' e receber a
 * resposta da Evolution deixa um estado genuinamente ambíguo: a
 * mensagem pode ter saído. Marcar como falha sozinho faria alguém
 * reenviar por cima de um relatório entregue; marcar como enviado
 * deixaria o cliente sem nada. Quem sabe é quem abre o grupo e olha.
 *
 * Por isso são DUAS saídas explícitas, e nenhuma delas é o padrão.
 */
export async function resolverEnvioPreso(
  reportId: string,
  decisao: "chegou" | "nao-chegou",
): Promise<ResultadoEnvio> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (isDemoMode) return { ok: false, error: "Modo demo: sem envio real." };

  const supabase = await createSupabaseServerClient();

  /* Condicionado a 'sending' pelo mesmo motivo da reserva: se outra aba
     já resolveu, esta não desfaz. */
  /* ⚠️ SÓ SE ESTIVER PRESA DE VERDADE. 'sending' também é o estado de
     um envio LEGÍTIMO em andamento: sem esta janela, um clique em "Não
     chegou" numa aba velha arrancava a reserva de quem estava enviando
     naquele instante, devolvia a linha para 'failed' — que a reserva
     aceita — e abria caminho para o envio em dobro. A mesma definição
     de "preso" usada em `listarPendentes`. */
  const limitePreso = new Date(
    Date.now() - MINUTOS_PRESO * 60_000,
  ).toISOString();

  const { count } = await supabase
    .from("report_history")
    .update(
      decisao === "chegou"
        ? {
            status: "sent",
            delivered_at: new Date().toISOString(),
            error_message:
              "Marcado como entregue à mão: o envio foi interrompido e alguém confirmou no grupo.",
          }
        : {
            status: "failed",
            error_message:
              "Envio interrompido no meio. Marcado como não entregue por quem conferiu o grupo.",
          },
      { count: "exact" },
    )
    .eq("id", reportId)
    .eq("status", "sending")
    .lt("updated_at", limitePreso);

  if (count !== 1) {
    return {
      ok: false,
      error:
        "Esta linha não está mais presa — ou alguém já resolveu, ou o envio voltou a andar. Recarregue a fila.",
    };
  }

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
   * Os MESMOS totais, inteiros, no formato que `computeKpi` come.
   *
   * Existe para a estação montar a prévia da mensagem com
   * `kpisDoTemplate` — a mesma função que monta os cartões do PDF. Os
   * campos achatados acima continuam servindo aos cartões da tela; este
   * serve ao texto que vai ao cliente, e ele não pode ser derivado de
   * uma segunda conta.
   */
  totais: MetricTotals;
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
      /* Inteiro, com `campanhas` e `isolado` — é o que carrega o selo
         "(de 1 campanha)" para a prévia da mensagem. Achatar aqui foi o
         que obrigou a tela a recalcular, e recalcular foi o que fez a
         legenda discordar do anexo. */
      totais,
      linhas: metricas.length,
    },
  };
}
