import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extrairCampos, registrarLeadMeta, type ClienteDoLead } from "./registrar-lead-meta";
import { tokenDaPagina } from "./token-da-pagina";

/* =====================================================================
   Busca periódica de leads nos formulários do Meta
   ---------------------------------------------------------------------
   Existe porque o app do Meta não está publicado: em modo
   Desenvolvimento o webhook só recebe teste, nunca lead de anúncio
   real. Aqui o Elo Hub pergunta ao Meta, em vez de esperar o aviso.

   A JANELA é larga de propósito (horas, não minutos): se o gatilho
   falhar por um tempo, a próxima rodada recupera o que ficou para
   trás. Lead já gravado é pulado pelo `external_id`, então repetir a
   janela não duplica nada nem reenvia aviso.
   ===================================================================== */

interface LeadDoFormulario {
  id: string;
  created_time: string;
  ad_name?: string;
  field_data?: { name: string; values: string[] }[];
}

export interface ResumoDoCliente {
  cliente: string;
  formularios: number;
  encontrados: number;
  criados: number;
  erro?: string;
}

type Graph<T> = { ok: true; data: T } | { ok: false; erro: string };

async function graph<T>(url: string): Promise<Graph<T>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok || json.error) return { ok: false, erro: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "falha de rede" };
  }
}

export async function buscarLeadsNovosDoMeta(janelaHoras: number): Promise<ResumoDoCliente[]> {
  const supabase = createSupabaseAdminClient();
  const base = `https://graph.facebook.com/${serverEnv.metaApiVersion}`;
  const desde = Math.floor(Date.now() / 1000) - janelaHoras * 3600;

  const { data: clientes, error } = await supabase
    .from("clients")
    .select("id, name, lead_notify_phone, whatsapp_phone, meta_page_id")
    .not("meta_page_id", "is", null);

  if (error) return [{ cliente: "—", formularios: 0, encontrados: 0, criados: 0, erro: error.message }];

  const resumo: ResumoDoCliente[] = [];

  for (const linha of clientes ?? []) {
    const client = linha as ClienteDoLead & { meta_page_id: string };
    const r: ResumoDoCliente = { cliente: client.name, formularios: 0, encontrados: 0, criados: 0 };
    resumo.push(r);

    const { data: intRow } = await supabase
      .from("client_integrations")
      .select("integration_secrets(access_token)")
      .eq("client_id", client.id)
      .eq("platform", "meta_ads")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const token = (intRow as { integration_secrets: { access_token: string | null } | null } | null)
      ?.integration_secrets?.access_token;
    if (!token) { r.erro = "sem token Meta"; continue; }

    const tokenPagina = await tokenDaPagina(token, client.meta_page_id);
    if (!tokenPagina) { r.erro = "quem autorizou o Meta não administra a página"; continue; }
    const t = encodeURIComponent(tokenPagina);

    const forms = await graph<{ data: { id: string; name: string }[] }>(
      `${base}/${client.meta_page_id}/leadgen_forms?fields=id,name&limit=100&access_token=${t}`,
    );
    if (!forms.ok) { r.erro = `formulários: ${forms.erro}`; continue; }
    r.formularios = forms.data.data.length;

    const filtro = encodeURIComponent(
      JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]),
    );

    for (const form of forms.data.data) {
      const leads = await graph<{ data: LeadDoFormulario[] }>(
        `${base}/${form.id}/leads?fields=id,created_time,ad_name,field_data&limit=100&filtering=${filtro}&access_token=${t}`,
      );
      if (!leads.ok) { r.erro = `leads de "${form.name}": ${leads.erro}`; continue; }

      /* Mais antigo primeiro: o grupo recebe os avisos na ordem em que
         as pessoas preencheram. */
      const ordenados = [...leads.data.data].sort((a, b) => a.created_time.localeCompare(b.created_time));
      r.encontrados += ordenados.length;

      for (const lead of ordenados) {
        const campos = extrairCampos(lead.field_data ?? [], lead.ad_name ?? null, form.name);
        const res = await registrarLeadMeta(supabase, client, lead.id, campos);
        if (res === "criado") r.criados++;
      }
    }
  }

  return resumo;
}
