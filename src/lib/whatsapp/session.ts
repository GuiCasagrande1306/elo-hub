import "server-only";

import { unstable_cache } from "next/cache";

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

export interface WhatsAppGroup {
  id: string;
  name: string;
}

export type GroupsResult =
  | { ok: true; groups: WhatsAppGroup[]; cached: boolean }
  | { ok: false; error: string };

/* =====================================================================
   Cache da listagem de grupos
   ---------------------------------------------------------------------
   `fetchAllGroups` pede metadados grupo a grupo à Meta, que responde
   `rate-overlimit` quando insiste — medido: 107s numa chamada bem
   sucedida e vários estouros de 90s. É a chamada mais cara do sistema, e
   abrir o formulário duas vezes não pode custar duas varreduras.

   DOIS NÍVEIS, porque resolvem problemas diferentes:

   1. DATA CACHE do Next (`unstable_cache`), 10 minutos. É o que faltava:
      o cache anterior era um Map de módulo, que vive dentro de UMA
      instância da função. Num painel de quatro pessoas a instância
      quase sempre está fria, então na prática o cache raramente
      acertava — cada abertura do formulário pagava a varredura inteira.
      O Data Cache é compartilhado entre instâncias e sobrevive a
      deploy.

   2. ÚLTIMA LISTA BOA em memória, sem prazo. Serve para um caso que o
      Data Cache não cobre: quando a Evolution falha, a entrada expirada
      dele não é acessível. Nome de grupo muda raramente e id não muda
      nunca, então uma lista velha vale muito mais que uma tela de erro.

   Falha NÃO é cacheada. A função lança em vez de devolver `ok:false`
   justamente por isso: o Next não grava promessa rejeitada, e o "Tentar
   de novo" volta a consultar de verdade em vez de reler o erro por dez
   minutos.
   ===================================================================== */

const GRUPOS_TTL_S = 600;

/** Última lista boa conhecida, por instância. Sem prazo de validade. */
const ultimaListaBoa = new Map<string, WhatsAppGroup[]>();

/** Tag do Data Cache, para invalidar sob demanda. */
const tagDeGrupos = (nome: string) => `whatsapp-groups:${nome}`;

/** Erro com mensagem já pronta para a tela. */
class GruposIndisponiveis extends Error {}

/**
 * A varredura em si, memoizada no Data Cache.
 *
 * `userId` entra como argumento e não é lido de `cookies()` — API de
 * requisição dentro de escopo cacheado não é suportada.
 */
function buscarGrupos(userId: string, nome: string) {
  return unstable_cache(
    async (): Promise<WhatsAppGroup[]> => {
      const status = await getSessionStatus(userId);
      if (status.state !== "open") {
        throw new GruposIndisponiveis(
          "Conecte seu WhatsApp em Configurações para listar os grupos.",
        );
      }

      /* 45s, não 20s. O tempo desta chamada é ERRÁTICO, não alto:
         medimos 8,8s para 281 grupos, e 110s para 231 numa hora em que
         a Meta estava limitando. Com o corte em 20s, boa parte das
         chamadas que iam terminar bem virava "não foi possível listar"
         — e o usuário ficava sem lista e sem como descobrir o JID, que
         não aparece em canto nenhum do WhatsApp.

         45s cabe no teto de 60s da função (`maxDuration` da rota) com
         folga para a sessão e a serialização. Não resolve os 110s; para
         esses existe a tabela `whatsapp_groups`. */
      const resposta = await evolutionFetch(
        "GET",
        `group/fetchAllGroups/${encodeURIComponent(nome)}?getParticipants=false`,
        undefined,
        45_000,
      );

      if (!resposta.success) {
        throw new GruposIndisponiveis(
          /timeout|tempo/i.test(resposta.error ?? "")
            ? "O WhatsApp está limitando a listagem de grupos agora. Tente de novo em alguns minutos ou cole o ID manualmente."
            : (resposta.error ?? "Não foi possível listar os grupos."),
        );
      }

      const bruto = resposta.data;
      const lista = Array.isArray(bruto)
        ? bruto
        : ((bruto as { groups?: unknown[] })?.groups ?? []);

      return (lista as Record<string, unknown>[])
        .map((g) => ({
          id: String(g.id ?? ""),
          name: String(g.subject ?? g.name ?? "").trim() || "(sem nome)",
        }))
        .filter((g) => g.id.endsWith("@g.us"))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
    ["whatsapp-groups", nome],
    { revalidate: GRUPOS_TTL_S, tags: [tagDeGrupos(nome)] },
  )();
}

/**
 * Grupos de que o CELULAR DO USUÁRIO participa.
 *
 * Tem que ser a instância dele, não a da agência: só dá para postar em
 * grupo do qual se é membro, então listar os grupos de outra conta
 * ofereceria destinos que o envio recusaria depois.
 */
export async function fetchAllGroups(userId: string): Promise<GroupsResult> {
  const nome = instanceNameFor(userId);

  try {
    const grupos = await buscarGrupos(userId, nome);
    ultimaListaBoa.set(nome, grupos);
    return { ok: true, groups: grupos, cached: false };
  } catch (erro) {
    const anterior = ultimaListaBoa.get(nome);
    if (anterior) return { ok: true, groups: anterior, cached: true };

    return {
      ok: false,
      error:
        erro instanceof GruposIndisponiveis
          ? erro.message
          : "Não foi possível listar os grupos.",
    };
  }
}

/* NÃO EXISTE INVALIDAÇÃO SOB DEMANDA, e é decisão, não esquecimento.
   O botão "Tentar de novo" do formulário só aparece depois de um ERRO,
   e erro nunca chega ao cache — então ele já refaz a consulta de
   verdade sem precisar invalidar nada.

   Sobraria o caso "acabei de criar um grupo e quero vê-lo agora", que
   não paga o próprio custo: medimos `revalidateTag(tag, {expire:0})`
   provocando DUAS recomputações e não uma (a entrada gravada logo após
   a invalidação ainda é lida como obsoleta), e aqui cada recomputação é
   uma varredura de até 107s numa API que já está limitando. O grupo
   novo aparece quando os 10 minutos vencem, e até lá o campo aceita o
   JID colado à mão — que é o caminho confiável de qualquer forma.

   `updateTag`, que expira de imediato sem esse efeito, só pode ser
   chamado de Server Action; esta é uma Route Handler. */

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
