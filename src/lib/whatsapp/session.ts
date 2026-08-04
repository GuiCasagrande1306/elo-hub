import "server-only";

import {
  evolutionFetch,
  evolutionMediaBody,
  evolutionRequest,
  isGroupJid,
  normalizePhone,
} from "./index";
import { serverEnv } from "@/lib/env";

/* =====================================================================
   WhatsApp pessoal — uma instância por usuário
   ---------------------------------------------------------------------
   Uma instância da Evolution é UMA conexão com UM celular. Não dá para
   vários usuários compartilharem: quem parear por último derruba o
   anterior. Então cada pessoa tem a sua.

   O NOME DA INSTÂNCIA É DERIVADO DO ID DO USUÁRIO, não guardado numa
   tabela. Isso não é economia de código — é a garantia de autorização:
   o servidor calcula o nome a partir da sessão, então não existe
   parâmetro de entrada capaz de apontar para a instância de outra
   pessoa. Sem tabela, não há policy para escrever errado.

   A chave global da Evolution NUNCA chega ao browser. Toda chamada passa
   por uma rota nossa, que primeiro resolve quem está logado.
   ===================================================================== */

/** Prefixo que distingue instância pessoal da instância da agência. */
const PREFIXO = "user-";

/** Instância pessoal de um usuário. Determinístico e derivado da sessão. */
export function instanceNameFor(userId: string): string {
  return `${PREFIXO}${userId}`;
}

export type ConnectionState =
  | "open"        // pareado e pronto
  | "connecting"  // aguardando leitura do QR
  | "close"       // existe, mas desconectado
  | "absent";     // instância ainda não criada

export interface SessionStatus {
  state: ConnectionState;
  /** Número pareado, quando conectado. */
  phone?: string;
  profileName?: string;
}

interface InstanceNode {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  ownerJid?: string;
  profileName?: string;
  instance?: InstanceNode;
}

/** A resposta muda de formato entre versões: às vezes o objeto vem
    envelopado em `instance`, às vezes cru. */
function achar(lista: unknown, nome: string): InstanceNode | null {
  const itens = Array.isArray(lista) ? lista : [lista];

  for (const bruto of itens) {
    const item = (bruto ?? {}) as InstanceNode;
    const node = item.instance ?? item;
    if ((node.name ?? node.instanceName) === nome) return node;
  }

  return null;
}

export async function getSessionStatus(userId: string): Promise<SessionStatus> {
  const resposta = await evolutionFetch("GET", "instance/fetchInstances");
  if (!resposta.success) return { state: "absent" };

  const node = achar(resposta.data, instanceNameFor(userId));
  if (!node) return { state: "absent" };

  const bruto = (node.connectionStatus ?? "").toLowerCase();

  return {
    state:
      bruto === "open" ? "open" : bruto === "connecting" ? "connecting" : "close",
    // ownerJid vem como `5548999110022@s.whatsapp.net`.
    phone: node.ownerJid?.split("@")[0],
    profileName: node.profileName,
  };
}

export interface PairingResult {
  success: boolean;
  /** PNG em data URI, pronto para <img src>. */
  qrDataUri?: string;
  /** Alternativa a escanear: código digitado no celular. */
  pairingCode?: string;
  state?: ConnectionState;
  error?: string;
}

/**
 * Cria a instância se não existir e devolve o QR.
 *
 * Idempotente de propósito: a tela chama isto tanto no primeiro
 * pareamento quanto ao pedir QR novo depois que o anterior expirou
 * (~40s), e as duas situações são indistinguíveis para quem clicou.
 */
export async function startPairing(userId: string): Promise<PairingResult> {
  const nome = instanceNameFor(userId);
  const atual = await getSessionStatus(userId);

  if (atual.state === "open") return { success: true, state: "open" };

  if (atual.state === "absent") {
    // `instance/create` é a exceção: o nome vai NO CORPO e a URL não
    // leva sufixo. Usar o helper que anexa a instância gera
    // /instance/create/<nome>, que a Evolution responde com 404.
    const criada = await evolutionFetch("POST", "instance/create", {
      instanceName: nome,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });

    if (!criada.success) return { success: false, error: criada.error };

    const qr = extrairQr(criada.data);
    if (qr) return { success: true, ...qr, state: "connecting" };
  }

  const resposta = await evolutionFetch(
    "GET",
    `instance/connect/${encodeURIComponent(nome)}`,
  );

  if (!resposta.success) return { success: false, error: resposta.error };

  const qr = extrairQr(resposta.data);

  // Sem QR normalmente significa que conectou entre a checagem e esta
  // chamada — corrida comum quando o usuário lê rápido.
  return qr
    ? { success: true, ...qr, state: "connecting" }
    : { success: true, state: "open" };
}

function extrairQr(
  dado: unknown,
): { qrDataUri: string; pairingCode?: string } | null {
  const d = (dado ?? {}) as {
    base64?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; pairingCode?: string };
  };

  const base64 = d.base64 ?? d.qrcode?.base64;
  if (!base64) return null;

  return {
    qrDataUri: base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`,
    pairingCode: d.pairingCode ?? d.qrcode?.pairingCode,
  };
}

/** Desconecta o celular sem apagar a instância. */
export async function logoutSession(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const resposta = await evolutionFetch(
    "DELETE",
    `instance/logout/${encodeURIComponent(instanceNameFor(userId))}`,
  );

  return resposta.success
    ? { success: true }
    : { success: false, error: resposta.error };
}

/**
 * Envia texto PELO NÚMERO DO PRÓPRIO USUÁRIO.
 *
 * Diferente de `sendTextMessage`, que usa a instância da agência: aqui o
 * remetente é o celular de quem está logado, e a mensagem aparece na
 * conversa dele como se tivesse sido digitada no aparelho.
 */
export async function sendFromUser(
  userId: string,
  to: string,
  text: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const status = await getSessionStatus(userId);

  if (status.state !== "open") {
    return {
      success: false,
      error:
        status.state === "absent"
          ? "Seu WhatsApp não está conectado. Leia o QR em Configurações."
          : "Sua conexão caiu. Releia o QR em Configurações.",
    };
  }

  const resultado = await evolutionRequest(
    "message/sendText",
    { number: normalizePhone(to), text, delay: 1200 },
    instanceNameFor(userId),
  );

  return {
    success: resultado.success,
    messageId: resultado.messageId,
    error: resultado.error,
  };
}

/**
 * Manda o PDF do relatório PELO CELULAR DO USUÁRIO.
 *
 * ⚠️ O celular precisa PARTICIPAR do grupo de destino. Diferente do
 * envio pela instância da agência, aqui o remetente é a pessoa — e o
 * WhatsApp não deixa ninguém postar num grupo do qual não faz parte.
 * A Evolution devolve isso como erro genérico, então checamos o estado
 * antes e traduzimos a falha depois.
 */
export async function sendReportFromUser(
  userId: string,
  to: string,
  pdfUrl: string,
  caption: string,
  clientName: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const status = await getSessionStatus(userId);

  if (status.state !== "open") {
    return {
      success: false,
      error:
        status.state === "absent"
          ? "Seu WhatsApp não está conectado. Leia o QR em Configurações."
          : "Sua conexão caiu. Releia o QR em Configurações.",
    };
  }

  if (!/^https?:\/\//i.test(pdfUrl)) {
    return {
      success: false,
      error:
        "A URL do PDF precisa ser absoluta: quem baixa o arquivo é o servidor da Evolution, não o navegador.",
    };
  }

  const resultado = await evolutionRequest(
    "message/sendMedia",
    evolutionMediaBody(serverEnv.evolutionApiVersion, {
      number: normalizePhone(to),
      media: pdfUrl,
      fileName: `Relatorio_${nomeDeArquivo(clientName)}.pdf`,
      caption: caption.slice(0, 1024),
      delayMs: 2000,
    }),
    instanceNameFor(userId),
  );

  if (!resultado.success) {
    const dica =
      isGroupJid(to) && /not.*found|exists|invalid/i.test(resultado.error ?? "")
        ? " Verifique se o SEU número participa deste grupo."
        : "";

    return { success: false, error: `${resultado.error}${dica}` };
  }

  return { success: true, messageId: resultado.messageId };
}

/** Nome de arquivo seguro: sem acento, espaço ou barra. */
function nomeDeArquivo(valor: string): string {
  return (
    valor
      .normalize("NFD")
      // Escape unicode, não o caractere literal: a faixa de diacríticos
      // combinantes é invisível no editor e some em copy-paste.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "") || "Cliente"
  );
}
