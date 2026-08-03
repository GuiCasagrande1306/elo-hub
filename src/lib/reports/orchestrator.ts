import "server-only";

import { isDemoMode, serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientBySlug, getReportTemplates } from "@/lib/data";
import { buildReportPayload, buildWhatsAppSummary } from "./payload";
import { renderReportPdf } from "./pdf/render";
import { getWhatsAppProvider } from "@/lib/whatsapp";
import type { ReportStatus } from "@/types/database";

/* =====================================================================
   Orquestrador de relatório
   ---------------------------------------------------------------------
   Pipeline:

     queued → generating → ready → sending → sent
                  ↓           ↓        ↓
                failed     failed   failed

   Três princípios que sustentam a operação:

   1. CADA TRANSIÇÃO É PERSISTIDA antes de a etapa começar. Se o processo
      morrer no meio, o registro em `report_history` mostra exatamente
      onde parou — não sobra relatório em limbo silencioso.

   2. O PDF É GERADO ANTES DE QUALQUER ENVIO. Nunca se avisa o cliente
      sobre um arquivo que pode não existir.

   3. FALHA NO ENVIO NÃO DESTRÓI O PDF. O status volta para 'failed' com
      a mensagem do provedor, mas `storage_path` continua válido: dá para
      reenviar sem gerar de novo.

   Sobre execução em segundo plano: a geração leva de 2 a 10 segundos e
   cabe no tempo de uma requisição. Quando a carteira crescer, o ponto de
   corte natural é enfileirar após `queued` — o restante do pipeline já
   está escrito como uma função que recebe o `reportId` e continua.
   ===================================================================== */

export interface GenerateReportInput {
  clientSlug: string;
  templateId?: string;
  periodStart: string;
  periodEnd: string;
  insights?: string;
  nextSteps?: string[];
  /** 'whatsapp' dispara ao cliente; 'none' apenas gera e arquiva. */
  deliver: "whatsapp" | "none";
  /** Sobrescreve o telefone do cadastro. */
  recipient?: string;
}

export interface GenerateReportResult {
  ok: boolean;
  reportId: string | null;
  status: ReportStatus;
  downloadUrl?: string;
  whatsappMessageId?: string;
  error?: string;
  /** Presente só em modo demo, onde não há Storage. */
  pdf?: Buffer;
}

export async function generateAndDeliverReport(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  const supabase = await createSupabaseServerClient();

  /* --- 1. Autorização -------------------------------------------------
     Não há checagem manual de permissão: `getClientBySlug` usa o cliente
     com o JWT do usuário, então o RLS já decide. Cliente inacessível
     volta como `null` — indistinguível de inexistente, o que também
     evita vazar a existência da conta. */
  const client = await getClientBySlug(input.clientSlug);
  if (!client) {
    return {
      ok: false,
      reportId: null,
      status: "failed",
      error: "Cliente não encontrado ou sem permissão de acesso.",
    };
  }

  /* --- 2. Template ---------------------------------------------------- */
  const templates = await getReportTemplates();
  const template =
    templates.find((t) => t.id === input.templateId) ??
    templates.find((t) => t.segment === client.segment && t.is_default) ??
    templates.find((t) => t.segment === null && t.is_default) ??
    templates[0];

  if (!template) {
    return {
      ok: false,
      reportId: null,
      status: "failed",
      error: "Nenhum template de relatório configurado.",
    };
  }

  const title = `${client.name} — ${input.periodStart} a ${input.periodEnd}`;

  /* --- 3. Registro de histórico --------------------------------------- */
  let reportId: string;

  if (isDemoMode) {
    reportId = `rh-demo-${Date.now()}`;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("report_history")
      .insert({
        client_id: client.id,
        template_id: template.id,
        title,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status: "queued" satisfies ReportStatus,
        channel: input.deliver === "whatsapp" ? "whatsapp" : null,
        recipient:
          input.deliver === "whatsapp"
            ? (input.recipient ?? client.whatsapp_phone)
            : null,
        generated_by: user?.id,
      })
      .select("id")
      .single();

    // A policy `report_history_insert` exige can_write_client(): um
    // colaborador só-leitura falha exatamente aqui, no banco.
    if (error || !data) {
      return {
        ok: false,
        reportId: null,
        status: "failed",
        error: error?.message ?? "Não foi possível registrar o relatório.",
      };
    }

    reportId = data.id;
  }

  /** Atualiza o status. Silencioso em demo (não há tabela). */
  async function setStatus(status: ReportStatus, patch: Record<string, unknown> = {}) {
    if (isDemoMode) return;
    await supabase
      .from("report_history")
      .update({ status, ...patch })
      .eq("id", reportId);
  }

  try {
    /* --- 4. Congelar os números ------------------------------------- */
    await setStatus("generating");

    const payload = await buildReportPayload({
      client,
      template,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      insights: input.insights,
      nextSteps: input.nextSteps,
    });

    // O snapshot é gravado ANTES do render: se a geração do PDF falhar,
    // os dados do período continuam preservados para diagnóstico e para
    // uma nova tentativa sem reconsultar as plataformas.
    await setStatus("generating", { snapshot: payload });

    /* --- 5. Renderizar ---------------------------------------------- */
    const { buffer, pageCount } = await renderReportPdf(payload, reportId);

    /* --- 6. Demo para por aqui -------------------------------------- */
    if (isDemoMode) {
      return {
        ok: true,
        reportId,
        status: "ready",
        pdf: buffer,
      };
    }

    /* --- 7. Storage --------------------------------------------------
       Upload com service_role: o bucket `report-pdfs` é privado e não
       tem policy de INSERT para usuário final. O caminho começa pelo
       UUID do cliente, que é o que a policy de leitura usa para
       autorizar quem pode baixar. */
    const admin = createSupabaseAdminClient();
    const storagePath = `${client.id}/${reportId}.pdf`;

    const { error: uploadError } = await admin.storage
      .from("report-pdfs")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) throw new Error(`Falha no upload: ${uploadError.message}`);

    // URL assinada de 7 dias: o provedor de WhatsApp precisa BAIXAR o
    // arquivo, então uma URL exigindo sessão não serviria. Prazo curto
    // porque quem tem o link tem o relatório.
    const { data: signed } = await admin.storage
      .from("report-pdfs")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    const downloadUrl = signed?.signedUrl;

    await setStatus("ready", {
      storage_path: storagePath,
      public_url: downloadUrl,
      page_count: pageCount,
      file_size: buffer.byteLength,
    });

    if (input.deliver === "none") {
      return { ok: true, reportId, status: "ready", downloadUrl };
    }

    /* --- 8. WhatsApp -------------------------------------------------- */
    const recipient = input.recipient ?? client.whatsapp_phone;

    if (!recipient) {
      await setStatus("failed", {
        error_message: "Cliente sem telefone de WhatsApp cadastrado.",
      });
      return {
        ok: false,
        reportId,
        status: "failed",
        downloadUrl,
        error: "Cliente sem telefone de WhatsApp cadastrado.",
      };
    }

    if (!downloadUrl) {
      await setStatus("failed", {
        error_message: "Não foi possível assinar a URL do PDF.",
      });
      return {
        ok: false,
        reportId,
        status: "failed",
        error: "Não foi possível assinar a URL do PDF.",
      };
    }

    await setStatus("sending");

    const provider = getWhatsAppProvider();
    const summary = buildWhatsAppSummary(payload);

    // Ordem importa: primeiro o resumo em texto, depois o anexo. Quem lê
    // no celular vê os números sem precisar abrir o PDF — e o documento
    // chega logo abaixo, já com contexto.
    const textResult = await provider.sendText(recipient, summary);

    const docResult = await provider.sendDocument(recipient, {
      url: downloadUrl,
      filename: `${slugify(client.name)}-${input.periodEnd}.pdf`,
      caption: `Relatório ${payload.meta.templateName}`,
    });

    if (!docResult.ok) {
      // O PDF continua íntegro no Storage: `storage_path` não é limpo,
      // então reenviar não exige gerar de novo.
      await setStatus("failed", {
        error_message: `Envio falhou: ${docResult.error ?? textResult.error ?? "erro desconhecido"}`,
      });
      return {
        ok: false,
        reportId,
        status: "failed",
        downloadUrl,
        error: docResult.error ?? textResult.error,
      };
    }

    await setStatus("sent", {
      delivered_at: new Date().toISOString(),
      provider_message_id: docResult.messageId ?? textResult.messageId,
    });

    return {
      ok: true,
      reportId,
      status: "sent",
      downloadUrl,
      whatsappMessageId: docResult.messageId,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado na geração.";

    await setStatus("failed", { error_message: message });

    return { ok: false, reportId, status: "failed", error: message };
  }
}

/** Nome de arquivo seguro: sem acento, sem espaço, sem barra. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    // Escape unicode em vez do caractere literal: a faixa de diacríticos
    // combinantes é invisível no editor e some em copy-paste.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export { serverEnv };
