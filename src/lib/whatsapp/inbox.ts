import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evolutionFetch } from "./index";

/* =====================================================================
   O que chega pelo WhatsApp, virando linha no banco
   ---------------------------------------------------------------------
   A Evolution empurra um evento por mensagem. Este módulo faz três
   coisas e nenhuma a mais: entende o formato, guarda, e devolve o que
   guardou. Quem decide se o evento é legítimo é o webhook; quem desenha
   a conversa é a tela.

   O FORMATO DA EVOLUTION NÃO É ESTÁVEL. Muda entre versões e entre
   tipos de mensagem: o texto simples vem em `message.conversation`, o
   mesmo texto com link vem em `message.extendedTextMessage.text`, e a
   legenda de uma foto vem em `message.imageMessage.caption`. Toda essa
   variação está confinada em `interpretar` — se um dia um tipo novo
   aparecer, é lá que se conserta, e a mensagem desconhecida vira
   `tipo: 'outro'` com o texto que der para extrair, em vez de sumir.

   SERVICE_ROLE, e é a única porta. As tabelas `wa_*` não têm policy de
   escrita para sessão de usuário — ver a migration 62. Quem chama aqui
   já provou de qual instância veio o evento.
   ===================================================================== */

const PREFIXO_CLIENTE = "cliente-";

/**
 * De qual empresa é esta instância.
 *
 * `null` para as instâncias pessoais (`user-…`) e para a da agência:
 * elas existem para ENVIAR, e o que chega nelas é conversa particular
 * de alguém da equipe. Guardar isso seria gravar a caixa de entrada
 * pessoal de um funcionário num banco da empresa.
 */
export function clientIdDaInstancia(instancia: string): string | null {
  if (!instancia.startsWith(PREFIXO_CLIENTE)) return null;

  const id = instancia.slice(PREFIXO_CLIENTE.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export type TipoDeMensagem =
  | "texto"
  | "imagem"
  | "audio"
  | "video"
  | "documento"
  | "sticker"
  | "localizacao"
  | "contato"
  | "sistema"
  | "outro";

export interface MensagemInterpretada {
  waId: string;
  jid: string;
  ehGrupo: boolean;
  deMim: boolean;
  nome: string | null;
  tipo: TipoDeMensagem;
  texto: string | null;
  enviadaEm: string;
  midia: { base64: string | null; mime: string | null; nome: string | null } | null;
}

/* O que a Evolution manda, na parte que nos interessa. Tudo opcional:
   confiar em campo obrigatório de payload alheio é como este tipo de
   integração quebra em produção, num tipo de mensagem que ninguém
   testou. */
interface EventoBruto {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  messageTimestamp?: number | string;
  messageType?: string;
  message?: Record<string, unknown> | null;
}

interface Midia {
  caption?: string;
  mimetype?: string;
  fileName?: string;
  base64?: string;
}

/** Um mapa de "chave do objeto de mensagem" para o nosso tipo. */
const TIPOS: [string, TipoDeMensagem][] = [
  ["imageMessage", "imagem"],
  ["audioMessage", "audio"],
  ["videoMessage", "video"],
  ["documentMessage", "documento"],
  ["documentWithCaptionMessage", "documento"],
  ["stickerMessage", "sticker"],
  ["locationMessage", "localizacao"],
  ["liveLocationMessage", "localizacao"],
  ["contactMessage", "contato"],
  ["contactsArrayMessage", "contato"],
];

/**
 * O evento cru virando algo que o banco aceita.
 *
 * `null` quando não é mensagem de conversa: recibo de leitura, aviso de
 * protocolo, atualização de status. Eles chegam pelo mesmo evento e não
 * pertencem a nenhuma thread.
 */
export function interpretar(bruto: EventoBruto): MensagemInterpretada | null {
  const jid = bruto.key?.remoteJid ?? "";
  const waId = bruto.key?.id ?? "";

  if (!jid || !waId) return null;

  /* O "status" do WhatsApp são as histórias de 24h de todo mundo da
     agenda. Chegam pelo mesmo webhook e não são conversa com ninguém —
     guardá-las encheria o banco com o cotidiano dos contatos do
     cliente. */
  if (jid === "status@broadcast") return null;

  const conteudo = bruto.message ?? {};

  // Mensagem de protocolo: apagar, editar, sincronizar chave.
  if ("protocolMessage" in conteudo || "senderKeyDistributionMessage" in conteudo) {
    return null;
  }

  const par = TIPOS.find(([chave]) => chave in conteudo);
  const tipo: TipoDeMensagem = par ? par[1] : temTexto(conteudo) ? "texto" : "outro";

  const midiaBruta = par
    ? ((conteudo[par[0]] as Midia | undefined) ?? undefined)
    : undefined;

  return {
    waId,
    jid,
    ehGrupo: jid.endsWith("@g.us"),
    deMim: Boolean(bruto.key?.fromMe),
    nome: bruto.pushName?.trim() || null,
    tipo,
    texto: extrairTexto(conteudo, midiaBruta),
    enviadaEm: instante(bruto.messageTimestamp),
    midia: par
      ? {
          /* `base64` só vem quando o webhook foi configurado com
             `base64: true`. Quando não vem, o webhook busca depois —
             ver `baixarMidia`. */
          base64: midiaBruta?.base64 ?? (conteudo.base64 as string | undefined) ?? null,
          mime: midiaBruta?.mimetype ?? null,
          nome: midiaBruta?.fileName ?? null,
        }
      : null,
  };
}

function temTexto(conteudo: Record<string, unknown>): boolean {
  return "conversation" in conteudo || "extendedTextMessage" in conteudo;
}

function extrairTexto(
  conteudo: Record<string, unknown>,
  midia: Midia | undefined,
): string | null {
  const direto = conteudo.conversation;
  if (typeof direto === "string" && direto.trim()) return direto;

  const estendido = (conteudo.extendedTextMessage as { text?: string } | undefined)?.text;
  if (estendido?.trim()) return estendido;

  // Legenda de foto e vídeo é texto para todos os efeitos de leitura.
  if (midia?.caption?.trim()) return midia.caption;

  return null;
}

/**
 * O carimbo do WhatsApp vem em SEGUNDOS, não milissegundos.
 *
 * Multiplicar errado joga a mensagem para 1970 e ela some do fim da
 * thread — que é onde a pessoa está olhando. Ausente ou absurdo, cai no
 * agora: mensagem sem data na posição errada é pior que uma com data
 * aproximada.
 */
function instante(carimbo: number | string | undefined): string {
  const n = typeof carimbo === "string" ? Number(carimbo) : carimbo;

  if (!n || !Number.isFinite(n) || n <= 0) return new Date().toISOString();

  const ms = n > 1e12 ? n : n * 1000;
  const data = new Date(ms);

  return Number.isNaN(data.getTime()) ? new Date().toISOString() : data.toISOString();
}

/* ------------------------------------------------------------------ */
/* Gravação                                                            */
/* ------------------------------------------------------------------ */

export interface Guardada {
  conversaId: string;
  mensagemId: string;
  novaConversa: boolean;
}

/**
 * Guarda a mensagem, criando a conversa se for a primeira.
 *
 * IDEMPOTENTE. A Evolution reentrega o evento quando a resposta demora,
 * e o `unique (conversa_id, wa_id)` da migration 62 é o que impede a
 * thread de encher de duplicatas. Reentrega devolve a linha existente
 * em vez de erro — para o webhook, gravar duas vezes precisa ser tão
 * bem-sucedido quanto gravar uma.
 */
export async function guardarMensagem(
  clientId: string,
  instancia: string,
  msg: MensagemInterpretada,
): Promise<Guardada | { erro: string }> {
  const admin = createSupabaseAdminClient();

  /* --- a conversa -------------------------------------------------- */
  const { data: existente } = await admin
    .from("wa_conversas")
    .select("id, nome")
    .eq("client_id", clientId)
    .eq("jid", msg.jid)
    .maybeSingle();

  const novaConversa = !existente;
  let conversaId: string;

  if (existente) {
    conversaId = existente.id as string;

    if (!existente.nome && !msg.deMim && msg.nome) {
      // O nome só aparece em algumas mensagens; aproveita a primeira.
      await admin.from("wa_conversas").update({ nome: msg.nome }).eq("id", conversaId);
    }
  } else {
    const { data, error } = await admin
      .from("wa_conversas")
      .insert({
        client_id: clientId,
        jid: msg.jid,
        /* O `pushName` de uma mensagem QUE EU MANDEI é o meu nome, não o
           do outro lado. Usá-lo batizaria a conversa com o nome do
           próprio cliente. */
        nome: msg.deMim ? null : msg.nome,
        eh_grupo: msg.ehGrupo,
      })
      .select("id")
      .single();

    if (error) return { erro: `conversa: ${error.message}` };
    conversaId = data.id as string;
  }

  /* --- a mídia ----------------------------------------------------- */
  let midiaPath: string | null = null;

  if (msg.midia) {
    midiaPath = await guardarMidia(admin, clientId, conversaId, instancia, msg);
  }

  /* --- a mensagem -------------------------------------------------- */
  const { data, error } = await admin
    .from("wa_mensagens")
    .insert({
      conversa_id: conversaId,
      /* Preenchido de qualquer forma pelo gatilho, a partir da conversa
         — mandar aqui só evita um `not null` violado antes de ele
         rodar. Ver a nota na migration 62. */
      client_id: clientId,
      wa_id: msg.waId,
      de_mim: msg.deMim,
      tipo: msg.tipo,
      texto: msg.texto,
      midia_path: midiaPath,
      midia_mime: msg.midia?.mime ?? null,
      midia_nome: msg.midia?.nome ?? null,
      enviada_em: msg.enviadaEm,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = a mesma mensagem já estava lá. Reentrega, não falha.
    if (error.code === "23505") {
      const { data: jaTem } = await admin
        .from("wa_mensagens")
        .select("id")
        .eq("conversa_id", conversaId)
        .eq("wa_id", msg.waId)
        .maybeSingle();

      return jaTem
        ? { conversaId, mensagemId: jaTem.id, novaConversa: false }
        : { erro: "mensagem duplicada sem linha correspondente" };
    }

    return { erro: `mensagem: ${error.message}` };
  }

  return { conversaId, mensagemId: data.id, novaConversa };
}

/* ------------------------------------------------------------------ */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * O arquivo, do WhatsApp para o nosso bucket.
 *
 * PRECISA SER AGORA. A mídia da Evolution vive no contêiner dela e some
 * quando ele reinicia — o Railway reinicia sozinho. Guardar só a
 * referência produziria uma conversa cheia de áudios que não tocam.
 *
 * Falha aqui NÃO derruba a mensagem: devolve `null` e a linha entra com
 * o tipo certo e sem arquivo. Uma thread dizendo "🎤 Áudio" sem poder
 * tocar ainda conta a história; uma mensagem que não existe, não.
 */
async function guardarMidia(
  admin: Admin,
  clientId: string,
  conversaId: string,
  instancia: string,
  msg: MensagemInterpretada,
): Promise<string | null> {
  let base64 = msg.midia?.base64 ?? null;

  if (!base64) {
    /* Sem base64 no payload, pede à Evolution. `convertToMp4: false`
       porque a conversão é lenta e o webhook tem que responder rápido —
       o áudio de voz toca em ogg no navegador. */
    const resposta = await evolutionFetch(
      "POST",
      `chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`,
      { message: { key: { id: msg.waId } }, convertToMp4: false },
      20_000,
    );

    if (!resposta.success) return null;

    const dados = resposta.data as { base64?: string } | undefined;
    base64 = dados?.base64 ?? null;
  }

  if (!base64) return null;

  const limpo = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(limpo, "base64");
  } catch {
    return null;
  }

  if (bytes.length === 0) return null;

  /* O caminho começa pelo uuid da empresa — é o que a policy do Storage
     compara. Ver a migration 62. */
  const caminho = `${clientId}/${conversaId}/${msg.waId}${extensao(msg)}`;

  const { error } = await admin.storage
    .from("whatsapp-media")
    .upload(caminho, bytes, {
      contentType: msg.midia?.mime ?? "application/octet-stream",
      upsert: true,
    });

  return error ? null : caminho;
}

/** Extensão a partir do mime, com queda para o nome original. */
function extensao(msg: MensagemInterpretada): string {
  const nome = msg.midia?.nome ?? "";
  const doNome = nome.includes(".") ? nome.slice(nome.lastIndexOf(".")) : "";
  if (doNome.length > 1 && doNome.length <= 6) return doNome;

  const mime = msg.midia?.mime ?? "";
  const mapa: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
  };

  return mapa[mime.split(";")[0]] ?? "";
}
