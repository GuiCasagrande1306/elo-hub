"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { getClients, getReports } from "@/lib/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { buildGroupCaption } from "@/lib/reports/payload";
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
}

/**
 * Relatórios gerados e ainda não enviados.
 *
 * A leitura passa por `getReports`, que usa RLS: um colaborador só vê
 * os relatórios das contas dele. A tela não filtra nada à mão.
 */
export async function listarPendentes(): Promise<EnvioPendente[]> {
  const [reports, clients] = await Promise.all([getReports(), getClients()]);

  return reports
    .filter((r) => r.status === "ready" || r.status === "failed")
    .map((report) => {
      const client = clients.find((c) => c.id === report.client_id);
      return client ? { report, client } : null;
    })
    .filter((x): x is EnvioPendente => x !== null);
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

  const legenda =
    linha.snapshot && typeof linha.snapshot === "object"
      ? buildGroupCaption(linha.snapshot as never)
      : `Segue o relatório de performance de ${(client as Client).name}.`;

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
  /* Cadência do envio. 'weekly' usa `reportWeekday` e janela de 7 dias;
     'monthly' usa `reportDay` e janela de 30. */
  frequency: z.enum(["monthly", "weekly"]),
  /** 0=domingo a 6=sábado, como `Date.getDay()`. */
  reportWeekday: z.number().int().min(0).max(6).nullable(),
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
  reportDay: number | null;
  frequency: "monthly" | "weekly";
  reportWeekday: number | null;
  enabled: boolean;
  whatsapp: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = agendaSchema.safeParse(input);
  if (!parsed.success) {
    /* A mensagem do zod em vez de uma genérica: "Dia ou destino
       inválido" não diz QUAL dos dois, e foi exatamente o que mascarou
       este bug — o id é que estava sendo recusado, não o dia. */
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const { clientId, reportDay, frequency, reportWeekday, enabled, whatsapp } =
    parsed.data;

  const semQuando =
    frequency === "weekly" ? reportWeekday === null : reportDay === null;

  /* LIGADO SEM DIA NUNCA DISPARA. O job procura `report_day = <dia de
     hoje>`, então um cliente marcado como ativo e sem dia fica para
     sempre em silêncio, parecendo configurado. Recusar aqui é o que
     impede a tela de mostrar "pronto" para quem não está. */
  if (enabled && semQuando) {
    return {
      ok: false,
      error:
        frequency === "weekly"
          ? "Escolha o dia da semana antes de ligar o automático."
          : "Escolha o dia do envio antes de ligar o automático.",
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
      alvo.report_frequency = frequency;
      alvo.report_weekday = reportWeekday;
      alvo.report_enabled = enabled;
      alvo.whatsapp_phone = whatsapp || null;
    }
    revalidatePath("/relatorios");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* A coluna da OUTRA cadência vai a null: deixar o valor antigo
     guardado faria a linha parecer agendada duas vezes para quem lesse o
     banco, e a constraint permite os dois preenchidos. */
  const completo = {
    report_day: frequency === "monthly" ? reportDay : null,
    report_frequency: frequency,
    report_weekday: frequency === "weekly" ? reportWeekday : null,
    report_enabled: enabled,
    whatsapp_phone: whatsapp || null,
  };

  let { error } = await supabase
    .from("clients")
    .update(completo)
    .eq("id", clientId);

  /* 42703 = coluna inexistente. Acontece entre o deploy e a migration 40:
     sem este caminho, gravar a agenda falharia para TODO mundo, inclusive
     os mensais que já funcionavam — uma tela que funcionava pararia por
     causa de um recurso novo que ninguém ainda usa.

     Repete sem os campos novos e avisa quem escolheu semanal, em vez de
     dizer "salvo" para um agendamento que não existe no banco. */
  if (error?.code === "42703") {
    const retorno = await supabase
      .from("clients")
      .update({
        report_day: reportDay,
        report_enabled: enabled,
        whatsapp_phone: whatsapp || null,
      })
      .eq("id", clientId);

    error = retorno.error;

    if (!error && frequency === "weekly") {
      return {
        ok: false,
        error:
          "O envio semanal ainda não está disponível neste banco. O destino foi salvo; rode a migration 40 para liberar a cadência semanal.",
      };
    }
  }

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
  revalidatePath("/clientes");
  return { ok: true };
}
