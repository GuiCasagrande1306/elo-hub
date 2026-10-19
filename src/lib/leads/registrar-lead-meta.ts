import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notificarNovoLead } from "./notificacao";

/* =====================================================================
   Gravar um lead do Meta no CRM do cliente e avisar no WhatsApp
   ---------------------------------------------------------------------
   Um só caminho para as duas portas de entrada: o webhook (quando o
   Meta entrega) e a busca periódica (quando o app ainda não está
   publicado e o Meta não entrega lead real). O aviso só sai quando o
   deal é CRIADO — se as duas portas trouxerem o mesmo lead, o índice
   único de `external_id` barra o segundo e ninguém recebe duas vezes.
   ===================================================================== */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export interface ClienteDoLead {
  id: string;
  name: string;
  lead_notify_phone: string | null;
  whatsapp_phone: string | null;
}

export interface CamposDoLead {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  extras: Record<string, string>;
}

export type ResultadoDoRegistro = "criado" | "duplicado" | "erro";

const CAMPOS_PADRAO = new Set([
  "full_name", "nome", "first_name", "last_name",
  "phone_number", "telefone", "phone", "email",
]);

export function extrairCampos(
  fieldData: { name: string; values: string[] }[],
  adName: string | null,
  formName: string | null = null,
): CamposDoLead {
  const mapa: Record<string, string> = {};
  for (const campo of fieldData) {
    const valor = campo.values?.[0] ?? "";
    if (valor) mapa[campo.name.toLowerCase()] = valor;
  }

  const nome =
    mapa["full_name"] ??
    mapa["nome"] ??
    (mapa["first_name"] && mapa["last_name"]
      ? `${mapa["first_name"]} ${mapa["last_name"]}`.trim()
      : mapa["first_name"] ?? mapa["last_name"] ?? null);

  const extras: Record<string, string> = {};
  for (const campo of fieldData) {
    const v = campo.values?.[0];
    if (v && !CAMPOS_PADRAO.has(campo.name.toLowerCase())) extras[campo.name] = v;
  }

  return {
    nome,
    telefone: normalizarTelefone(mapa["phone_number"] ?? mapa["telefone"] ?? mapa["phone"] ?? null),
    email: mapa["email"] ?? null,
    formName,
    campaignName: adName,
    extras,
  };
}

export function normalizarTelefone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const clean = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (clean.length < 10 || clean.length > 11) return null;
  return clean;
}

export async function registrarLeadMeta(
  supabase: Admin,
  client: ClienteDoLead,
  leadgenId: string,
  campos: CamposDoLead | null,
): Promise<ResultadoDoRegistro> {
  /* Checa antes de criar o contato: sem isso, cada reentrega deixaria
     um contato órfão para trás, mesmo com o deal barrado pelo índice. */
  const { data: jaExiste, error: existeErr } = await supabase
    .from("lead_deals")
    .select("id")
    .eq("client_id", client.id)
    .eq("source", "meta_ads")
    .eq("external_id", leadgenId)
    .maybeSingle();

  if (existeErr) {
    console.error("[meta-leads] erro ao checar duplicidade:", existeErr.message);
    return "erro";
  }
  if (jaExiste) return "duplicado";

  const pipelineId = await garantirFunil(client.id, supabase);
  if (!pipelineId) {
    console.error(`[meta-leads] sem funil para cliente ${client.id}`);
    return "erro";
  }

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
    return "erro";
  }

  const contactName = campos?.nome ?? "Lead Meta Ads";
  const contactPhone = campos?.telefone ?? null;
  const contactEmail = campos?.email ?? null;

  let contactId: string | null = null;

  if (contactPhone) {
    const { data: existente } = await supabase
      .from("lead_contacts")
      .select("id")
      .eq("client_id", client.id)
      .eq("phone", contactPhone)
      .maybeSingle();
    if (existente) contactId = (existente as { id: string }).id;
  }

  if (!contactId) {
    const { data: novoContato, error: contactErr } = await supabase
      .from("lead_contacts")
      .insert({ client_id: client.id, name: contactName, phone: contactPhone, email: contactEmail })
      .select("id")
      .single();

    if (contactErr) console.error("[meta-leads] erro ao criar contato:", contactErr.message);
    else contactId = (novoContato as { id: string }).id;
  }

  const titulo = campos?.nome
    ? campos.nome
    : campos?.formName
      ? `Lead · ${campos.formName}`
      : "Lead Meta Ads";

  const { error: dealErr } = await supabase.from("lead_deals").insert({
    client_id: client.id,
    pipeline_id: pipelineId,
    stage_id: (stageRow as { id: string }).id,
    contact_id: contactId,
    title: titulo,
    source: "meta_ads",
    external_id: leadgenId,
    position: Date.now(),
    value_cents: 0,
    created_by: null,
  });

  if (dealErr) {
    if (dealErr.code === "23505") return "duplicado";
    console.error("[meta-leads] erro ao criar deal:", dealErr.message);
    return "erro";
  }

  const notifyPhone = client.lead_notify_phone ?? client.whatsapp_phone;
  if (notifyPhone) {
    await notificarNovoLead(notifyPhone, {
      clientName: client.name,
      contactName: campos?.nome ?? null,
      contactPhone,
      contactEmail,
      formName: campos?.formName ?? null,
      campaignName: campos?.campaignName ?? null,
      extras: campos?.extras,
    });
  }

  return "criado";
}

async function garantirFunil(clientId: string, supabase: Admin): Promise<string | null> {
  const { data: existente } = await supabase
    .from("lead_pipelines")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_default", true)
    .maybeSingle();

  if (existente) return (existente as { id: string }).id;

  const { data, error } = await supabase.rpc("criar_funil_padrao", { p_client: clientId });
  if (error) {
    console.error("[meta-leads] criar_funil_padrao:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}
