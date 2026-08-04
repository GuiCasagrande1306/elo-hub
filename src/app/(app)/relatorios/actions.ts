"use server";

import { revalidatePath } from "next/cache";

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
