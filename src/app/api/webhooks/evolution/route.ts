import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import {
  clientIdDaInstancia,
  guardarMensagem,
  interpretar,
} from "@/lib/whatsapp/inbox";

/* =====================================================================
   A porta por onde a mensagem entra
   ---------------------------------------------------------------------
   A Evolution chama este endereço a cada evento. É uma porta ABERTA na
   internet: quem chama é um contêiner do Railway, sem cookie, sem
   sessão e sem usuário. Então a autorização é um segredo combinado,
   gravado na instância no momento do pareamento e conferido aqui.

   FALHA FECHADA. Sem `EVOLUTION_WEBHOOK_SECRET` configurado, nada
   entra. Um webhook que aceita tudo quando a variável falta é como se
   grava mensagem forjada na conversa de um cliente — e ninguém
   descobre, porque a tela mostra exatamente o que foi gravado.

   RESPONDE 200 QUASE SEMPRE, e isso é de propósito. A Evolution
   reentrega o que não recebeu 2xx, e reentregar não conserta mensagem
   de tipo desconhecido nem instância que não é de cliente — só produz
   uma fila que nunca esvazia. Erro de verdade (banco fora do ar) devolve
   500 para a reentrega valer a pena.

   ⚠️ O CONTEÚDO É DE TERCEIRO. O que passa por aqui são mensagens dos
   clientes do nosso cliente. Nada de texto de mensagem em log — nem em
   erro. O que se registra é instância, tipo e id; nunca o que foi dito.
   ===================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Entrega {
  event?: string;
  instance?: string;
  data?: unknown;
}

export async function POST(request: NextRequest) {
  const segredo = serverEnv.evolutionWebhookSecret;

  if (!segredo) {
    console.error(
      "[evolution] EVOLUTION_WEBHOOK_SECRET não configurado — entrega recusada.",
    );
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  /* `authorization` porque é o cabeçalho que a Evolution grava sem
     esforço no `webhook/set` — conferido no contêiner em 23/08/2026. */
  const enviado = request.headers.get("authorization") ?? "";

  if (enviado !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const corpo = (await request.json().catch(() => null)) as Entrega | null;
  if (!corpo) return NextResponse.json({ ok: true, ignorado: "corpo inválido" });

  const evento = (corpo.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = corpo.instance ?? "";

  /* Só conversa de CLIENTE entra. Instância pessoal de alguém da equipe
     também dispara evento, e o que chega nela é a caixa de entrada
     particular de um funcionário — ver `clientIdDaInstancia`. */
  const clientId = clientIdDaInstancia(instancia);
  if (!clientId) return NextResponse.json({ ok: true, ignorado: "instância" });

  if (evento !== "messages.upsert") {
    return NextResponse.json({ ok: true, ignorado: evento });
  }

  /* Ora um objeto, ora um array de um item — depende da versão e do
     `byEvents`. Tratar os dois custa uma linha. */
  const itens = Array.isArray(corpo.data) ? corpo.data : [corpo.data];

  let guardadas = 0;
  let ignoradas = 0;

  for (const item of itens) {
    const msg = interpretar((item ?? {}) as Parameters<typeof interpretar>[0]);

    if (!msg) {
      ignoradas += 1;
      continue;
    }

    const r = await guardarMensagem(clientId, instancia, msg);

    if ("erro" in r) {
      /* Uma mensagem que não gravou é a única coisa que justifica pedir
         reentrega. O texto fica de fora do log — só o motivo técnico. */
      console.error(`[evolution] ${instancia} · ${msg.tipo} · ${r.erro}`);
      return NextResponse.json({ error: "Falha ao gravar." }, { status: 500 });
    }

    guardadas += 1;
  }

  return NextResponse.json({ ok: true, guardadas, ignoradas });
}

/**
 * GET para diagnóstico — diz se a porta existe e está configurada, e
 * nada além disso.
 *
 * Sem autenticação de propósito, porque não revela nada: a resposta é a
 * mesma para qualquer pessoa e não menciona instância, cliente nem
 * mensagem. Existe porque "o webhook está no ar?" é a primeira pergunta
 * quando uma mensagem não aparece, e ela não deveria exigir abrir o
 * painel da Vercel.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    configurado: Boolean(serverEnv.evolutionWebhookSecret),
  });
}
