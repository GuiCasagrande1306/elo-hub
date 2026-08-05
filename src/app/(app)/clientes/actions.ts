"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CLIENT_SEGMENTS,
  clientSettingsSchema,
  parseCurrencyToCents,
  newClientSchema,
  toClientPayload,
  type NewClientValues,
} from "@/lib/validation/client";
import type { Client } from "@/types/database";

/**
 * Cadastro de novo cliente.
 *
 * Delega para a função `create_client_with_setup`, que grava cliente,
 * meta e integrações numa ÚNICA transação. Três inserts separados daqui
 * deixariam lixo permanente se o segundo falhasse — um cliente sem meta
 * ou sem integração, que ninguém percebe até o card aparecer vazio.
 *
 * A RPC é SECURITY INVOKER, então cada INSERT lá dentro continua sob
 * RLS: um colaborador recebe violação de policy em vez de criar conta.
 * Não há checagem de papel aqui de propósito — quem barra é o banco.
 */
export type CreateClientResult =
  | { ok: true; client: Pick<Client, "id" | "name" | "slug"> }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createClientAction(
  input: NewClientValues,
): Promise<CreateClientResult> {
  // Revalida no servidor: Server Action é endpoint HTTP público, o
  // payload não é confiável só por ter vindo do nosso formulário.
  const parsed = newClientSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: z_flatten(parsed.error),
    };
  }

  const values = parsed.data;

  if (isDemoMode) {
    const { demoClients, demoGoals } = await import("@/lib/mock/data");
    const slug = slugify(
      values.name,
      demoClients.map((c) => c.slug),
    );
    // Um id só: calcular `Date.now()` duas vezes devolveria um id
    // diferente do que foi gravado se o milissegundo virasse no meio.
    const id = `c-${Date.now()}`;
    const payload = toClientPayload(values);

    demoClients.push({
      id,
      name: values.name,
      legal_name: null,
      slug,
      segment: values.segment,
      status: values.status,
      logo_url: null,
      brand_primary: values.brandPrimary ?? null,
      brand_secondary: null,
      brand_font: null,
      website: values.website ?? null,
      contact_name: values.contactName ?? null,
      contact_email: values.contactEmail ?? null,
      whatsapp_phone: values.whatsappPhone ?? null,
      persona: {},
      contract_start: new Date().toISOString().slice(0, 10),
      // Cliente novo entra sem envio automático: o dia é combinado em
      // contrato, e ligar por padrão mandaria relatório para um grupo
      // que talvez ainda nem exista.
      report_day: null,
      report_enabled: false,
      optimization_day: values.optimizationDay
        ? Number(values.optimizationDay)
        : null,
      owner_id: "u-admin",
      created_at: new Date().toISOString(),
    });

    // A RPC cria a meta na mesma transação; o modo demo precisa fazer o
    // mesmo, senão o usuário preenche orçamento e resultados e o card
    // aparece dizendo "definir meta do período".
    if (payload.p_planned_budget_cents > 0 || payload.p_planned_results > 0) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      demoGoals.push({
        id: `g-${id}`,
        client_id: id,
        period_start: iso(start),
        period_end: iso(end),
        planned_budget_cents: payload.p_planned_budget_cents,
        planned_results: payload.p_planned_results,
        executed_budget_cents_override: null,
        executed_results_override: null,
        override_reason: null,
        notes: null,
        created_at: iso(now),
      });
    }

    revalidatePath("/clientes");
    return { ok: true, client: { id, name: values.name, slug } };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .rpc("create_client_with_setup", toClientPayload(values))
    .single();

  if (error) {
    // 42501 = violação de policy. Traduzimos porque a mensagem crua do
    // Postgres não diz nada a quem está preenchendo um formulário.
    if (error.code === "42501") {
      return {
        ok: false,
        error: "Apenas administradores podem cadastrar clientes.",
      };
    }
    return { ok: false, error: error.message };
  }

  const client = data as Client;

  // A listagem também recebe o evento de Realtime (`clients` está na
  // publicação), mas revalidar garante o dado novo mesmo se o socket
  // tiver caído — o cliente precisa aparecer, não "geralmente aparecer".
  revalidatePath("/clientes");
  revalidatePath("/");

  return {
    ok: true,
    client: { id: client.id, name: client.name, slug: client.slug },
  };
}

/* ------------------------------------------------------------------ */

function z_flatten(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/** Espelha a geração de slug da RPC, para o modo demo. */
function slugify(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "cliente";

  let slug = base;
  let suffix = 1;
  while (taken.includes(slug)) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

/* =====================================================================
   Ajustes operacionais do cliente
   ---------------------------------------------------------------------
   O cadastro grava o cliente e nunca mais deixava mudá-lo. Três campos
   precisam ser corrigíveis, e os três decidem o que o cliente recebe:

   • `segment` escolhe o TEMPLATE do relatório. Um delivery cadastrado
     como negócio local recebe um PDF falando de "Contatos" em vez de
     "Pedidos". Antes disto, o único conserto era pelo banco.
   • `whatsapp_phone` é o destino do envio.
   • `report_day` / `report_enabled` decidem se o robô prepara o
     relatório e em que dia — sem tela, o cron nunca dispararia.

   O resto do cadastro continua imutável de propósito: nome e slug
   aparecem em URL e em PDF já entregue, e trocá-los quebra referência.
   ===================================================================== */

export type UpdateClientSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientSettings(input: {
  clientId: string;
  segment: (typeof CLIENT_SEGMENTS)[number];
  whatsappPhone: string;
  reportEnabled: boolean;
  reportDay: number | null;
  optimizationDay: number | null;
}): Promise<UpdateClientSettingsResult> {
  const parsed = clientSettingsSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const values = parsed.data;

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === values.clientId);
    if (!alvo) return { ok: false, error: "Cliente não encontrado." };

    alvo.segment = values.segment;
    alvo.whatsapp_phone = values.whatsappPhone || null;
    alvo.report_enabled = values.reportEnabled;
    alvo.report_day = values.reportDay;
    alvo.optimization_day = values.optimizationDay;

    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  // Sem checagem de papel aqui: a policy `clients_update` exige
  // can_write_client(), então um colaborador só-leitura falha no banco.
  const { error } = await supabase
    .from("clients")
    .update({
      segment: values.segment,
      whatsapp_phone: values.whatsappPhone || null,
      report_enabled: values.reportEnabled,
      report_day: values.reportDay,
      optimization_day: values.optimizationDay,
    })
    .eq("id", values.clientId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/relatorios");
  revalidatePath("/esteira");
  return { ok: true };
}

/**
 * Define a conta de anúncios de uma integração já autorizada.
 *
 * O OAuth grava o token antes de saber QUAL conta usar — a pessoa
 * autoriza o Facebook dela, que pode ter várias contas de anúncio.
 * Este passo fecha o vínculo.
 */
export async function setAdAccountId(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  externalAccountId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const valor = input.externalAccountId.trim();

  if (!valor) {
    return { ok: false, error: "Informe o ID da conta." };
  }

  /* Meta usa `act_<numero>`; Google usa 10 dígitos com ou sem hífen.
     Validar aqui evita uma sincronização que falha só no dia seguinte,
     quando o cron rodar e ninguém estiver olhando. */
  const formatoOk =
    input.platform === "meta_ads"
      ? /^act_\d{6,}$/.test(valor)
      : /^\d{3}-?\d{3}-?\d{4}$/.test(valor);

  if (!formatoOk) {
    return {
      ok: false,
      error:
        input.platform === "meta_ads"
          ? 'A conta do Meta tem o formato "act_123456789".'
          : 'O Customer ID do Google tem 10 dígitos, como "123-456-7890".',
    };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({
      external_account_id:
        input.platform === "google_ads" ? valor.replace(/-/g, "") : valor,
      sync_error: null,
    })
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Marca a conta como pré-paga ou pós-paga.
 *
 * Só conta pré-paga entra no alerta de saldo. O padrão do banco é
 * `postpaid`, então conta nova nasce fora do alerta — errar para o lado
 * do silêncio é melhor que para o do alarme falso, que treina a equipe
 * a ignorar a tela.
 */
export async function setBillingType(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  billingType: "prepaid" | "postpaid";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({ billing_type: input.billingType })
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/**
 * Define a meta do período corrente.
 *
 * `upsert` em `(client_id, period_start)`, que é a chave única da
 * tabela: mexer na meta do mês é editar a linha existente, não empilhar
 * uma nova. Sem isso o card leria a mais antiga e ignoraria a correção.
 *
 * O período é o MÊS CIVIL. Meta de mídia se acerta com fatura, e fatura
 * fecha no mês — deixar o usuário escolher datas soltas criaria metas
 * sobrepostas que nenhum gráfico saberia somar.
 */
export async function setClientGoal(input: {
  clientId: string;
  plannedBudget: string;
  plannedResults: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const orcamento = parseCurrencyToCents(input.plannedBudget);
  const resultados = Number(input.plannedResults.replace(",", "."));

  if (orcamento === null) {
    return { ok: false, error: "Informe o orçamento previsto." };
  }
  if (!Number.isFinite(resultados) || resultados < 0) {
    return { ok: false, error: "Informe a meta de resultados." };
  }

  const agora = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const inicio = iso(new Date(agora.getFullYear(), agora.getMonth(), 1));
  const fim = iso(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));

  if (isDemoMode) {
    const { demoGoals } = await import("@/lib/mock/data");
    const atual = demoGoals.find(
      (g) => g.client_id === input.clientId && g.period_start === inicio,
    );
    if (atual) {
      atual.planned_budget_cents = orcamento;
      atual.planned_results = resultados;
    } else {
      demoGoals.push({
        id: `g-${Date.now()}`,
        client_id: input.clientId,
        period_start: inicio,
        period_end: fim,
        planned_budget_cents: orcamento,
        planned_results: resultados,
        executed_budget_cents_override: null,
        executed_results_override: null,
        override_reason: null,
        notes: null,
        created_at: iso(agora),
      });
    }
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("client_goals").upsert(
    {
      client_id: input.clientId,
      period_start: inicio,
      period_end: fim,
      planned_budget_cents: orcamento,
      planned_results: resultados,
    },
    { onConflict: "client_id,period_start" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Grava a URL da logo do cliente.
 *
 * O upload em si acontece no browser, direto no Storage, sob a policy
 * `storage_brand_write` — que exige `can_write_client` na pasta. Aqui
 * só persistimos a URL resultante; a policy `clients_update` barra
 * quem não pode escrever na conta.
 *
 * `null` remove a referência. O arquivo antigo permanece no bucket de
 * propósito: PDF já entregue aponta para ele, e apagar quebraria a capa
 * de um relatório que o cliente ainda pode abrir.
 */
export async function setClientLogo(input: {
  clientId: string;
  logoUrl: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === input.clientId);
    if (alvo) alvo.logo_url = input.logoUrl;
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("clients")
    .update({ logo_url: input.logoUrl })
    .eq("id", input.clientId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/");
  return { ok: true };
}
