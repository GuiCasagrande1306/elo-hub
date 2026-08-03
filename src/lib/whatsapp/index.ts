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
 * Um JID é o identificador nativo do WhatsApp. Grupos terminam em
 * `@g.us`, contatos individuais em `@s.whatsapp.net` ou `@c.us`.
 */
export function isJid(value: string): boolean {
  return /@(g\.us|s\.whatsapp\.net|c\.us|lid)$/i.test(value.trim());
}

/** O destino é um grupo? */
export function isGroupJid(value: string): boolean {
  return /@g\.us$/i.test(value.trim());
}

/**
 * Normaliza o destino.
 *
 * ⚠️ JID passa INTACTO. A versão anterior desta função aplicava
 * `replace(/\D/g, "")` em tudo, o que transformava
 * `120363000000000000@g.us` em `120363000000000000` — a API recebia o
 * id do grupo como se fosse telefone e o relatório nunca chegava.
 * O bug só apareceu quando grupos entraram no escopo, porque com
 * celular a função sempre funcionou.
 *
 * Para telefone segue valendo E.164 sem "+", completando o DDI 55
 * quando falta — que é o erro mais comum no cadastro do cliente.
 */
export function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (isJid(value)) return value;

  const digits = value.replace(/\D/g, "");
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

/**
 * O corpo do `sendMedia` MUDOU entre as versões da Evolution:
 *
 *   v1: { number, options: { delay, presence },
 *         mediaMessage: { mediatype, fileName, caption, media } }
 *   v2: { number, mediatype, mimetype, media, fileName, caption,
 *         delay, presence }        ← tudo plano
 *
 * Mandar o corpo v1 para uma instância v2 não dá erro claro: o servidor
 * ignora `mediaMessage`, não encontra `media` no topo e responde 400
 * genérico — ou pior, aceita e não envia nada. Por isso a versão é
 * explícita em `EVOLUTION_API_VERSION` em vez de adivinhada.
 */
export type EvolutionVersion = "v1" | "v2";

function evolutionMediaBody(
  version: EvolutionVersion,
  input: {
    number: string;
    media: string;
    fileName: string;
    caption?: string;
    delayMs: number;
  },
): Record<string, unknown> {
  if (version === "v1") {
    return {
      number: input.number,
      options: { delay: input.delayMs, presence: "composing" },
      mediaMessage: {
        mediatype: "document",
        fileName: input.fileName,
        caption: input.caption,
        media: input.media,
      },
    };
  }

  return {
    number: input.number,
    mediatype: "document",
    // `mimetype` é o que faz o WhatsApp mostrar o ícone de PDF em vez
    // de "arquivo desconhecido" na conversa.
    mimetype: "application/pdf",
    media: input.media,
    fileName: input.fileName,
    caption: input.caption,
    delay: input.delayMs,
    presence: "composing",
  };
}

/** Resultado bruto de uma chamada à Evolution. */
export interface EvolutionResult {
  success: boolean;
  /** Corpo da resposta, útil para depurar um envio que "passou". */
  data?: unknown;
  error?: string;
  messageId?: string;
}

/**
 * Chamada crua à Evolution. NUNCA lança: devolve o erro descrito.
 *
 * Todo POST da Evolution tem a mesma forma — `{base}/{rota}/{instância}`
 * com a chave no header `apikey` — então centralizar aqui evita que
 * cada função repita timeout, tratamento de erro e leitura do corpo.
 */
export async function evolutionRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<EvolutionResult> {
  const base = serverEnv.whatsappEvolutionUrl.replace(/\/$/, "");
  const instance = serverEnv.whatsappEvolutionInstance;
  const key = serverEnv.whatsappToken;

  if (!base || !instance || !key) {
    return {
      success: false,
      error:
        "Evolution API não configurada (EVOLUTION_API_URL, EVOLUTION_INSTANCE_NAME e EVOLUTION_API_KEY).",
    };
  }

  try {
    const response = await fetch(`${base}/${path}/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify(body),
      // Envio de mídia por URL faz o servidor da Evolution BAIXAR o
      // arquivo antes de mandar; 20s é curto para um PDF de relatório.
      signal: AbortSignal.timeout(60_000),
    });

    const data = (await response.json().catch(() => ({}))) as {
      key?: { id?: string };
      message?: string | string[];
      error?: string;
      response?: { message?: string | string[] };
    };

    if (!response.ok) {
      return {
        success: false,
        data,
        error: describeEvolutionError(response.status, data),
      };
    }

    return { success: true, data, messageId: data.key?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de rede.";
    return {
      success: false,
      error: message.includes("timeout")
        ? "Tempo esgotado. A instância pode estar baixando a mídia ou desconectada."
        : message,
    };
  }
}

/**
 * Envia texto puro. `number` aceita telefone (55DDD9...) ou JID de grupo
 * (`...@g.us`) — `normalizePhone` distingue os dois.
 *
 * É o teste mais barato de conectividade: se isto chega, a instância
 * está pareada e a chave está certa. Começar a validação por mídia
 * mistura três causas de falha (conexão, permissão no grupo e download
 * da URL) num erro só.
 */
export async function sendTextMessage(
  number: string,
  text: string,
): Promise<EvolutionResult> {
  return evolutionRequest("message/sendText", {
    number: normalizePhone(number),
    text,
    delay: 1200,
  });
}

/**
 * Envia um documento a partir de uma URL pública.
 *
 * A URL precisa ser alcançável PELO SERVIDOR DA EVOLUTION, não pelo
 * nosso: é ele quem baixa o arquivo. URL assinada de Storage funciona;
 * `localhost` não.
 */
export async function sendMediaMessage(
  number: string,
  mediaUrl: string,
  fileName: string,
  caption?: string,
): Promise<EvolutionResult> {
  return evolutionRequest(
    "message/sendMedia",
    evolutionMediaBody(serverEnv.evolutionApiVersion, {
      number: normalizePhone(number),
      media: mediaUrl,
      fileName,
      caption,
      delayMs: 2000,
    }),
  );
}

function createEvolutionProvider(): WhatsAppProvider {
  // Adapta o resultado da Evolution para a interface comum aos dois
  // provedores — é o que permite ao orquestrador não saber qual está no ar.
  const adaptar = (r: EvolutionResult): SendResult => ({
    ok: r.success,
    messageId: r.messageId,
    error: r.error,
  });

  return {
    name: "evolution",

    async sendText(to, body) {
      return adaptar(await sendTextMessage(to, body));
    },

    async sendDocument(to, doc) {
      return adaptar(
        await sendMediaMessage(to, doc.url, doc.filename, doc.caption),
      );
    },
  };
}

/**
 * Traduz a resposta de erro da Evolution em algo acionável.
 *
 * A API devolve `message` ora como string, ora como array, e os erros
 * mais frequentes em produção têm causa operacional — não de código.
 * Dizer "instância desconectada, leia o QR" poupa meia hora de
 * investigação em cima de um "HTTP 400".
 */
function describeEvolutionError(status: number, data: unknown): string {
  const payload = data as {
    message?: string | string[];
    error?: string;
    response?: { message?: string | string[] };
  };

  const raw =
    payload.response?.message ?? payload.message ?? payload.error ?? "";
  const text = Array.isArray(raw) ? raw.join("; ") : String(raw);

  if (status === 401 || status === 403) {
    return `Chave da Evolution recusada (${status}). Confira EVOLUTION_API_KEY.`;
  }
  if (status === 404) {
    return `Instância "${serverEnv.whatsappEvolutionInstance}" não encontrada (404). Confira EVOLUTION_INSTANCE_NAME.`;
  }
  if (/not.*connect|close|disconnect/i.test(text)) {
    return `Instância desconectada — releia o QR Code no painel da Evolution. (${text})`;
  }
  if (/exists|not.*found|invalid.*(number|jid|group)/i.test(text)) {
    return `Destino inválido ou a instância não participa do grupo. (${text})`;
  }

  return text || `Evolution respondeu ${status}.`;
}

/* ------------------------------------------------------------------ */
/* Envio de relatório para grupo                                       */
/* ------------------------------------------------------------------ */

export interface SendReportResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envia o PDF do relatório para o grupo de WhatsApp do cliente.
 *
 * NUNCA LANÇA EXCEÇÃO — devolve `{ success: false, error }`. É requisito
 * do cron de relatórios: um cliente cujo grupo foi apagado, ou cuja
 * instância caiu, não pode derrubar a fila dos outros. Quem chama trata
 * o resultado e segue.
 *
 * O `groupId` precisa ser o JID completo (`...@g.us`). Aceitar só os
 * dígitos seria conveniente, mas ambíguo: `120363...` sem sufixo é
 * indistinguível de um telefone internacional, e o WhatsApp entregaria
 * a mensagem no lugar errado em silêncio.
 */
export async function sendReportToGroup(
  groupId: string,
  pdfUrl: string,
  captionText: string,
  clientName: string,
): Promise<SendReportResult> {
  if (!isGroupJid(groupId)) {
    const error = `"${groupId}" não é um id de grupo. Use o JID completo, terminando em @g.us.`;
    console.error(`[whatsapp] ${error}`);
    return { success: false, error };
  }

  if (!/^https?:\/\//i.test(pdfUrl)) {
    const error =
      "A URL do PDF precisa ser absoluta e acessível pela Evolution — ela baixa o arquivo do servidor dela, não do nosso.";
    console.error(`[whatsapp] ${error}`);
    return { success: false, error };
  }

  const provider = createEvolutionProvider();

  const result = await provider.sendDocument(groupId, {
    url: pdfUrl,
    filename: `Relatorio_${slugifyFilename(clientName)}.pdf`,
    // O WhatsApp trunca legenda longa; o resumo cabe com folga em 1024.
    caption: captionText.slice(0, 1024),
  });

  if (!result.ok) {
    console.error(
      `[whatsapp] falha ao enviar relatório de ${clientName} para ${groupId}: ${result.error}`,
    );
    return { success: false, error: result.error };
  }

  console.info(
    `[whatsapp] relatório de ${clientName} entregue em ${groupId} (${result.messageId ?? "sem id"})`,
  );
  return { success: true, messageId: result.messageId };
}

/** Nome de arquivo seguro: sem acento, espaço ou barra. */
function slugifyFilename(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "") || "Cliente"
  );
}
