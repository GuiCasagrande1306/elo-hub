import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  extrairCampos,
  registrarLeadMeta,
  type CamposDoLead,
  type ClienteDoLead,
} from "@/lib/leads/registrar-lead-meta";
import { tokenDaPagina } from "@/lib/leads/token-da-pagina";

/* =====================================================================
   Webhook de Lead Ads do Meta
   =====================================================================
   Recebe leads de formulários nativos do Facebook/Instagram.

   FLUXO:
   1. Meta envia GET com hub.challenge para verificar o endpoint.
   2. Após verificado, Meta envia POST para cada lead novo:
        { entry: [{ id: pageId, changes: [{ field: "leadgen", value: {
            leadgen_id, page_id, form_id, ... } }] }] }
   3. Buscamos o lead na Graph API para obter nome, telefone, e-mail.
   4. Inserimos no CRM (lead_contacts + lead_deals).
   5. Enviamos WhatsApp para lead_notify_phone, se configurado.

   TOKEN DE VERIFICAÇÃO: string livre definida por você no painel do app
   Meta (Webhooks → Produtos → Leadgen → Editar assinatura). Grave como
   META_LEADS_VERIFY_TOKEN no .env.local e na Vercel.

   FALHA FECHADA: sem META_LEADS_VERIFY_TOKEN nada entra. Igual ao
   webhook da Evolution.

   RESPONDE 200 QUASE SEMPRE: o Meta reentrega o que não receber 2xx.
   Reentrega não conserta "não tenho esse cliente" — só gera fila que
   nunca esvazia. Falha real de banco devolve 500.
   ===================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─── GET: verificação de endpoint ─────────────────────────────────── */

export async function GET(request: NextRequest) {
  const verifyToken = serverEnv.metaLeadsVerifyToken;

  if (!verifyToken) {
    return NextResponse.json(
      { error: "META_LEADS_VERIFY_TOKEN não configurado." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Verificação falhou." }, { status: 403 });
}

/* ─── POST: entrega de lead ─────────────────────────────────────────── */

interface MetaLeadgenValue {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time?: number;
}

interface MetaWebhookEntry {
  id: string;
  time?: number;
  changes?: { field: string; value: MetaLeadgenValue }[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export async function POST(request: NextRequest) {
  const verifyToken = serverEnv.metaLeadsVerifyToken;

  if (!verifyToken) {
    console.error("[meta-leads] META_LEADS_VERIFY_TOKEN não configurado.");
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  let body: MetaWebhookBody | null = null;
  try {
    body = (await request.json()) as MetaWebhookBody;
  } catch {
    return NextResponse.json({ ok: true, ignorado: "corpo inválido" });
  }

  /* O Meta pode mandar outros objetos (page, instagram_account…) */
  if (body?.object !== "page") {
    return NextResponse.json({ ok: true, ignorado: body?.object ?? "objeto desconhecido" });
  }

  const entries = body.entry ?? [];
  let processados = 0;
  let ignorados = 0;

  for (const entry of entries) {
    const changes = (entry.changes ?? []).filter((c) => c.field === "leadgen");

    for (const change of changes) {
      const resultado = await processarLead(change.value);
      if (resultado === "processado") processados++;
      else ignorados++;
    }
  }

  return NextResponse.json({ ok: true, processados, ignorados });
}

/* ─── Lógica de processamento ───────────────────────────────────────── */

type Resultado = "processado" | "ignorado";

async function processarLead(value: MetaLeadgenValue): Promise<Resultado> {
  const { leadgen_id, page_id } = value;

  if (!leadgen_id || !page_id) {
    console.warn("[meta-leads] leadgen_id ou page_id ausente:", value);
    return "ignorado";
  }

  const supabase = createSupabaseAdminClient();

  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, lead_notify_phone, whatsapp_phone")
    .eq("meta_page_id", page_id)
    .maybeSingle();

  if (clientErr) {
    console.error("[meta-leads] erro ao buscar cliente:", clientErr.message);
    return "ignorado";
  }

  if (!clientRow) {
    console.warn(`[meta-leads] page_id ${page_id} não mapeado a nenhum cliente.`);
    return "ignorado";
  }

  const client = clientRow as ClienteDoLead;
  const campos = await buscarLeadNaGraph(client.id, page_id, leadgen_id);
  const resultado = await registrarLeadMeta(supabase, client, leadgen_id, campos);

  return resultado === "criado" ? "processado" : "ignorado";
}

/* ─── Graph API ─────────────────────────────────────────────────────── */

async function buscarLeadNaGraph(
  clientId: string,
  pageId: string,
  leadgenId: string,
): Promise<CamposDoLead | null> {
  const supabase = createSupabaseAdminClient();

  /* Token do cliente (meta_ads) — integration_secrets não tem RLS */
  const { data: intRow } = await supabase
    .from("client_integrations")
    .select("id, integration_secrets(access_token)")
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const token = (
    intRow as {
      integration_secrets: { access_token: string | null } | null;
    } | null
  )?.integration_secrets?.access_token;

  if (!token) {
    console.warn(`[meta-leads] sem token Meta para cliente ${clientId}`);
    return null;
  }

  const version = serverEnv.metaApiVersion;
  const fields = "field_data,created_time,ad_name,form_id";
  const tokenLeitura = (await tokenDaPagina(token, pageId)) ?? token;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${leadgenId}?fields=${fields}&access_token=${tokenLeitura}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[meta-leads] Graph API erro:", (err as { error?: { message: string } }).error?.message ?? res.status);
      return null;
    }

    const data = (await res.json()) as {
      field_data?: { name: string; values: string[] }[];
      ad_name?: string;
    };

    return extrairCampos(data.field_data ?? [], data.ad_name ?? null);
  } catch (err) {
    console.error("[meta-leads] fetch Graph API falhou:", err instanceof Error ? err.message : err);
    return null;
  }
}
