import "server-only";

import { serverEnv } from "@/lib/env";

/* =====================================================================
   Distribuição por WhatsApp
   ---------------------------------------------------------------------
   Dois provedores, mesma interface:

   cloud_api (oficial, Meta)
     + número não corre risco de bloqueio; é a via suportada
     − fora da janela de 24h desde a última mensagem do cliente, só é
       possível iniciar conversa com TEMPLATE APROVADO. Isso não é
       detalhe: relatório mensal quase sempre cai fora da janela, então
       o fluxo real é template primeiro, documento depois.

   evolution (não oficial)
     + envia texto livre, sem aprovação de template
     − opera sobre o WhatsApp Web; o número pode ser banido. Aceitável
       para número secundário, arriscado para o número principal da
       agência.

   A escolha é por variável de ambiente. O orquestrador não sabe qual
   está ativo.
   ===================================================================== */

export interface WhatsAppDocument {
  /** URL pública ou assinada que o provedor vai baixar. */
  url: string;
  filename: string;
  /** Legenda do anexo (limite ~1024 caracteres na Cloud API). */
  caption?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<SendResult>;
  sendDocument(to: string, doc: WhatsAppDocument): Promise<SendResult>;
}

/**
 * Normaliza para E.164 sem "+", que é o formato que ambas as APIs
 * aceitam. Número brasileiro digitado sem DDI é o erro mais comum no
 * cadastro do cliente — completamos com 55.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  return serverEnv.whatsappProvider === "evolution"
    ? createEvolutionProvider()
    : createCloudApiProvider();
}

/* ------------------------------------------------------------------ */
/* Cloud API (oficial)                                                 */
/* ------------------------------------------------------------------ */

function createCloudApiProvider(): WhatsAppProvider {
  const base = `https://graph.facebook.com/${serverEnv.metaApiVersion}`;

  async function post(payload: Record<string, unknown>): Promise<SendResult> {
    const phoneId = serverEnv.whatsappPhoneNumberId;
    const token = serverEnv.whatsappToken;

    if (!phoneId || !token) {
      return {
        ok: false,
        error:
          "WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TOKEN não configurados (.env.local).",
      };
    }

    try {
      const response = await fetch(`${base}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        // Sem timeout, uma instabilidade da Meta prenderia o job
        // indefinidamente e o relatório ficaria travado em "enviando".
        signal: AbortSignal.timeout(20_000),
      });

      const data = (await response.json()) as {
        messages?: { id: string }[];
        error?: { message?: string };
      };

      if (!response.ok) {
        return {
          ok: false,
          error: data.error?.message ?? `HTTP ${response.status}`,
        };
      }

      return { ok: true, messageId: data.messages?.[0]?.id };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha de rede.",
      };
    }
  }

  return {
    name: "cloud_api",

    async sendText(to, body) {
      // ⚠️ Só entrega dentro da janela de 24h. Fora dela a Meta rejeita
      // e é preciso abrir a conversa com `sendTemplate`.
      return post({
        to: normalizePhone(to),
        type: "text",
        text: { preview_url: false, body },
      });
    },

    async sendDocument(to, doc) {
      return post({
        to: normalizePhone(to),
        type: "document",
        document: {
          link: doc.url,
          filename: doc.filename,
          caption: doc.caption?.slice(0, 1024),
        },
      });
    },
  };
}

/**
 * Abre a conversa com template aprovado.
 *
 * Isolado do provider porque é conceito exclusivo da API oficial: é o
 * que torna legal mandar relatório para quem não escreveu nas últimas
 * 24 horas. As variáveis do template entram na ordem em que aparecem
 * no corpo aprovado.
 */
export async function sendTemplateMessage(
  to: string,
  variables: string[],
): Promise<SendResult> {
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "relatorio_mensal";
  const language = process.env.WHATSAPP_TEMPLATE_LANG ?? "pt_BR";

  const phoneId = serverEnv.whatsappPhoneNumberId;
  const token = serverEnv.whatsappToken;

  if (!phoneId || !token) {
    return { ok: false, error: "WhatsApp Cloud API não configurada." };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${serverEnv.metaApiVersion}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalizePhone(to),
          type: "template",
          template: {
            name: templateName,
            language: { code: language },
            components: [
              {
                type: "body",
                parameters: variables.map((text) => ({ type: "text", text })),
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    const data = (await response.json()) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };

    return response.ok
      ? { ok: true, messageId: data.messages?.[0]?.id }
      : { ok: false, error: data.error?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha de rede.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Evolution API (não oficial)                                         */
/* ------------------------------------------------------------------ */

function createEvolutionProvider(): WhatsAppProvider {
  const base = serverEnv.whatsappEvolutionUrl.replace(/\/$/, "");
  const instance = serverEnv.whatsappEvolutionInstance;
  const key = serverEnv.whatsappToken;

  async function post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<SendResult> {
    if (!base || !instance) {
      return { ok: false, error: "Evolution API não configurada." };
    }

    try {
      const response = await fetch(`${base}/${path}/${instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      const data = (await response.json()) as {
        key?: { id?: string };
        message?: string;
      };

      return response.ok
        ? { ok: true, messageId: data.key?.id }
        : { ok: false, error: data.message ?? `HTTP ${response.status}` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Falha de rede.",
      };
    }
  }

  return {
    name: "evolution",

    async sendText(to, body) {
      return post("message/sendText", {
        number: normalizePhone(to),
        text: body,
      });
    },

    async sendDocument(to, doc) {
      return post("message/sendMedia", {
        number: normalizePhone(to),
        mediatype: "document",
        mimetype: "application/pdf",
        media: doc.url,
        fileName: doc.filename,
        caption: doc.caption,
      });
    },
  };
}
