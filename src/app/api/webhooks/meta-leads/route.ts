import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notificarNovoLead } from "@/lib/leads/notificacao";
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
  const { leadgen_id, page_id, form_id } = value;

  if (!leadgen_id || !page_id) {
    console.warn("[meta-leads] leadgen_id ou page_id ausente:", value);
    return "ignorado";
  }

  const supabase = createSupabaseAdminClient();

  /* ── 1. Identificar o cliente pela página ──────────────────────── */
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

  const client = clientRow as {
    id: string;
    name: string;
    lead_notify_phone: string | null;
    whatsapp_phone: string | null;
  };

  /* ── 2. Buscar dados do lead na Graph API ──────────────────────── */
  const leadData = await buscarLeadNaGraph(client.id, page_id, leadgen_id);

  /* ── 3. Funil padrão do cliente ────────────────────────────────── */
  const pipelineId = await garantirFunil(client.id, supabase);
  if (!pipelineId) {
    console.error(`[meta-leads] sem funil para cliente ${client.id}`);
    return "ignorado";
  }

  /* Primeira etapa do tipo 'aberto' */
  const { data: stageRow } = await supabase
    .from("lead_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("kind", "aberto")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stageRow) {
    console.error(`[meta-leads] sem etapa aberta no funil ${pipelineId}`);
    return "ignorado";
  }

  const stageId = (stageRow as { id: string }).id;

  /* ── 4. Contato ────────────────────────────────────────────────── */
  const contactName = leadData?.nome ?? "Lead Meta Ads";
  const contactPhone = leadData?.telefone ?? null;
  const contactEmail = leadData?.email ?? null;

  let contactId: string | null = null;

  if (contactPhone) {
    const { data: existente } = await supabase
      .from("lead_contacts")
      .select("id")
      .eq("client_id", client.id)
      .eq("phone", contactPhone)
      .maybeSingle();

    if (existente) {
      contactId = (existente as { id: string }).id;
    }
  }

  if (!contactId) {
    const { data: novoContato, error: contactErr } = await supabase
      .from("lead_contacts")
      .insert({
        client_id: client.id,
        name: contactName,
        phone: contactPhone,
        email: contactEmail,
      })
      .select("id")
      .single();

    if (contactErr) {
      console.error("[meta-leads] erro ao criar contato:", contactErr.message);
    } else {
      contactId = (novoContato as { id: string }).id;
    }
  }

  /* ── 5. Deal ───────────────────────────────────────────────────── */
  const titulo = contactName !== "Lead Meta Ads"
    ? contactName
    : leadData?.formName
      ? `Lead · ${leadData.formName}`
      : "Lead Meta Ads";

  const { error: dealErr } = await supabase.from("lead_deals").insert({
    client_id: client.id,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: contactId,
    title: titulo,
    source: "meta_ads",
    external_id: leadgen_id,
    position: Date.now(),
    value_cents: 0,
    created_by: null,
  });

  if (dealErr) {
    /* external_id único: se a entrega chegar duas vezes, ignora a segunda. */
    if (dealErr.code === "23505") return "ignorado";
    console.error("[meta-leads] erro ao criar deal:", dealErr.message);
    return "ignorado";
  }

  /* ── 6. Notificação ────────────────────────────────────────────── */
  const notifyPhone = client.lead_notify_phone ?? client.whatsapp_phone;

  if (notifyPhone) {
    await notificarNovoLead(notifyPhone, {
      clientName: client.name,
      contactName: contactName !== "Lead Meta Ads" ? contactName : null,
      contactPhone,
      contactEmail,
      formName: leadData?.formName ?? null,
      campaignName: leadData?.campaignName ?? null,
      extras: leadData?.extras,
    });
  }

  return "processado";
}

/* ─── Graph API ─────────────────────────────────────────────────────── */

interface LeadFields {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  extras: Record<string, string>;
}

async function buscarLeadNaGraph(
  clientId: string,
  pageId: string,
  leadgenId: string,
): Promise<LeadFields | null> {
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

function extrairCampos(
  fieldData: { name: string; values: string[] }[],
  adName: string | null,
): LeadFields {
  const mapa: Record<string, string> = {};

  for (const campo of fieldData) {
    const valor = campo.values[0] ?? "";
    if (valor) mapa[campo.name.toLowerCase()] = valor;
  }

  /* Mapeamento dos nomes padrão do Meta para os nossos campos */
  const nome =
    mapa["full_name"] ??
    mapa["nome"] ??
    (mapa["first_name"] && mapa["last_name"]
      ? `${mapa["first_name"]} ${mapa["last_name"]}`.trim()
      : mapa["first_name"] ?? mapa["last_name"] ?? null);

  const telefone = normalizePhone(
    mapa["phone_number"] ?? mapa["telefone"] ?? mapa["phone"] ?? null,
  );

  const email = mapa["email"] ?? null;

  /* Campos extras: tudo que não é nome/telefone/email */
  const CAMPOS_PADRÃO = new Set([
    "full_name", "nome", "first_name", "last_name",
    "phone_number", "telefone", "phone", "email",
  ]);

  const extras: Record<string, string> = {};
  for (const campo of fieldData) {
    const k = campo.name.toLowerCase();
    if (!CAMPOS_PADRÃO.has(k)) {
      const v = campo.values[0];
      if (v) extras[campo.name] = v;
    }
  }

  return {
    nome,
    telefone,
    email,
    formName: null,
    campaignName: adName,
    extras,
  };
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  /* Remove +55 do prefixo internacional se já está lá */
  const clean = digits.startsWith("55") && digits.length > 11
    ? digits.slice(2)
    : digits;
  if (clean.length < 10 || clean.length > 11) return null;
  return clean;
}

/* ─── Funil padrão ──────────────────────────────────────────────────── */

async function garantirFunil(
  clientId: string,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<string | null> {
  /* Tenta achar um padrão existente */
  const { data: existente } = await supabase
    .from("lead_pipelines")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_default", true)
    .maybeSingle();

  if (existente) return (existente as { id: string }).id;

  /* Cria via RPC — a mesma que a tela usa, por isso existe em `public` */
  const { data, error } = await supabase.rpc("criar_funil_padrao", {
    p_client: clientId,
  });

  if (error) {
    console.error("[meta-leads] criar_funil_padrao:", error.message);
    return null;
  }

  return (data as string | null) ?? null;
}
