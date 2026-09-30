"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import { oQueFalta, type DealParaPortao } from "@/lib/crm/portoes";
import type { ActivityKind, DealStage } from "@/types/database";

/**
 * Server Actions do CRM comercial.
 *
 * Nenhuma checa permissão à mão. Todas usam o cliente com a chave ANON e
 * o JWT de quem está logado, então quem decide é a RLS — a mesma regra
 * continua valendo se alguém chamar a action por fora da interface.
 *
 * Toda entrada passa por Zod: Server Action é endpoint HTTP público, e o
 * payload não é confiável só por ter saído de um componente nosso.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const ETAPAS = [
  "novo",
  "contato",
  "reuniao",
  "proposta",
  "negociacao",
  "ganho",
  "perdido",
] as const;

const ORIGENS = [
  "indicacao",
  "instagram",
  "trafego_pago",
  "prospeccao",
  "site",
  "evento",
  "outro",
] as const;

const SERVICOS = [
  "trafego",
  "social",
  "site",
  "combo",
  "outro",
] as const;

const MOTIVOS = [
  "preco",
  "timing",
  "concorrente",
  "sem_retorno",
  "nao_qualificado",
  "outro",
] as const;

const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .nullable();

/* ------------------------------------------------------------------ */
/* Criar                                                               */
/* ------------------------------------------------------------------ */

/**
 * Criar custa UM campo: a empresa.
 *
 * ⚠️ ESTA É A MUDANÇA QUE O MÓDULO INTEIRO EXISTE PARA FAZER. O schema
 * anterior exigia um título composto à mão ("Pizzaria Dom Léo — gestão
 * de tráfego") mais seis campos, e o resultado medido foram 44 dias no
 * ar com zero negócios. Telefone e origem entram se quem digitou tiver
 * à mão; o resto é cobrado adiante, pelos portões, na etapa em que
 * aquilo importa.
 */
const criarSchema = z.object({
  company: z.string().trim().min(1, "Diga o nome da empresa.").max(200),
  contactPhone: z.string().trim().max(60).nullable().optional(),
  origem: z.enum(ORIGENS).optional(),
});

export async function criarNegocio(
  input: z.input<typeof criarSchema>,
): Promise<{ ok: true; dealId: string } | { ok: false; error: string }> {
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const v = parsed.data;
  const origem = v.origem ?? "outro";

  if (isDemoMode) {
    const { demoDeals, demoStageEvents } = await import("@/lib/mock/data");
    const id = `d-${Date.now()}`;

    demoDeals.unshift({
      id,
      company: v.company,
      service: null,
      referred_by: null,
      contact_name: null,
      contact_phone: v.contactPhone ?? null,
      contact_email: null,
      stage: "novo",
      origem,
      monthly_fee_cents: 0,
      setup_fee_cents: 0,
      owner_id: null,
      owner: null,
      expected_close_date: null,
      next_action: null,
      next_action_at: null,
      lost_reason: null,
      notes: null,
      client_id: null,
      won_at: null,
      lost_at: null,
      position: Date.now(),
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      activityCount: 0,
    });

    /* Espelha o trigger `crm_registra_entrada`: sem o evento de
       criação, o negócio não conta em "quantos entraram este mês". */
    demoStageEvents.push({
      id: `se-${id}-novo`,
      deal_id: id,
      from_stage: null,
      to_stage: "novo",
      changed_by: user.id,
      changed_at: new Date().toISOString(),
    });

    revalidatePath("/comercial");
    return { ok: true, dealId: id };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("crm_deals")
    .insert({
      company: v.company,
      contact_phone: v.contactPhone ?? null,
      origem,
      // A policy de insert exige `created_by = auth.uid()`: a autoria
      // vem da sessão e não pode ser forjada pelo formulário.
      created_by: user.id,
      position: Date.now(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/comercial");
  return { ok: true, dealId: (data as { id: string }).id };
}

/* ------------------------------------------------------------------ */
/* Editar                                                              */
/* ------------------------------------------------------------------ */

const editarSchema = z.object({
  dealId: z.string().min(1),
  company: z.string().trim().min(1, "A empresa não pode ficar sem nome.").max(200).optional(),
  service: z.enum(SERVICOS).nullable().optional(),
  referredBy: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(60).nullable().optional(),
  contactEmail: z.string().trim().max(200).nullable().optional(),
  origem: z.enum(ORIGENS).optional(),
  monthlyFeeCents: z.number().int().min(0).optional(),
  setupFeeCents: z.number().int().min(0).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  expectedCloseDate: dataISO.optional(),
  notes: z.string().max(10_000).nullable().optional(),
  /* PAR OBRIGATÓRIO. O banco tem `crm_deals_next_action_par` para isso,
     mas recusar aqui devolve uma frase legível em vez do texto cru de
     violação de check. */
  nextAction: z.string().trim().max(300).nullable().optional(),
  nextActionAt: dataISO.optional(),
});

export async function atualizarNegocio(
  input: z.input<typeof editarSchema>,
): Promise<ActionResult> {
  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { dealId, ...v } = parsed.data;

  /* Os dois campos da próxima ação andam juntos. Só valido quando um
     deles veio no patch: um update que não menciona nenhum não pode ser
     recusado por causa do estado atual da linha. */
  const mexeuNaAcao = v.nextAction !== undefined || v.nextActionAt !== undefined;
  if (mexeuNaAcao) {
    const temTexto = Boolean(v.nextAction);
    const temData = Boolean(v.nextActionAt);
    if (temTexto !== temData) {
      return {
        ok: false,
        error: "Próxima ação precisa do que fazer E de quando — ou de nenhum dos dois.",
      };
    }
  }

  const patch = {
    ...(v.company !== undefined ? { company: v.company } : {}),
    ...(v.service !== undefined ? { service: v.service } : {}),
    ...(v.referredBy !== undefined ? { referred_by: v.referredBy } : {}),
    ...(v.contactName !== undefined ? { contact_name: v.contactName } : {}),
    ...(v.contactPhone !== undefined ? { contact_phone: v.contactPhone } : {}),
    ...(v.contactEmail !== undefined ? { contact_email: v.contactEmail } : {}),
    ...(v.origem !== undefined ? { origem: v.origem } : {}),
    ...(v.monthlyFeeCents !== undefined
      ? { monthly_fee_cents: v.monthlyFeeCents }
      : {}),
    ...(v.setupFeeCents !== undefined ? { setup_fee_cents: v.setupFeeCents } : {}),
    ...(v.ownerId !== undefined ? { owner_id: v.ownerId } : {}),
    ...(v.expectedCloseDate !== undefined
      ? { expected_close_date: v.expectedCloseDate }
      : {}),
    ...(v.notes !== undefined ? { notes: v.notes } : {}),
    ...(mexeuNaAcao
      ? { next_action: v.nextAction ?? null, next_action_at: v.nextActionAt ?? null }
      : {}),
  };

  if (Object.keys(patch).length === 0) return { ok: true };

  if (isDemoMode) {
    const { demoDeals, demoProfiles } = await import("@/lib/mock/data");
    const alvo = demoDeals.find((d) => d.id === dealId);
    if (!alvo) return { ok: false, error: "Negócio não encontrado." };

    Object.assign(alvo, patch);
    if (v.ownerId !== undefined) {
      const p = demoProfiles.find((x) => x.id === v.ownerId);
      alvo.owner = p
        ? { id: p.id, full_name: p.full_name, avatar_url: p.avatar_url }
        : null;
    }
    alvo.updated_at = new Date().toISOString();
    revalidatePath("/comercial");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `select` depois do update para distinguir "recusado pela policy" de
     "id não existe": sem ele, os dois voltam com zero linhas e nenhum
     erro, e a tela diria "salvo" sem ter salvado. */
  const { data, error } = await supabase
    .from("crm_deals")
    .update(patch)
    .eq("id", dealId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível salvar: o negócio não existe mais." };
  }

  revalidatePath("/comercial");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Mover no funil                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mover é onde o atrito vive — e ele vem junto com o preenchimento.
 *
 * ⚠️ UMA CHAMADA SÓ, e isso não é economia de round-trip: é correção.
 * Gravar os campos primeiro e mover depois deixaria o negócio num
 * estado intermediário se a segunda chamada falhasse — valor de
 * proposta preenchido num cartão que continua em "Reunião", que é
 * exatamente o tipo de linha que faz alguém desconfiar do funil. Os
 * campos que faltam e a etapa nova vão no MESMO update, e o banco
 * avalia os `check` sobre a linha já completa.
 */
const moverSchema = z.object({
  dealId: z.string().min(1),
  stage: z.enum(ETAPAS),
  position: z.number().int(),
  /** O que o portão pediu. Só o que veio é gravado. */
  preencher: z
    .object({
      contactName: z.string().trim().max(200).nullable().optional(),
      contactPhone: z.string().trim().max(60).nullable().optional(),
      contactEmail: z.string().trim().max(200).nullable().optional(),
      ownerId: z.string().min(1).nullable().optional(),
      service: z.enum(SERVICOS).nullable().optional(),
      referredBy: z.string().trim().max(200).nullable().optional(),
      monthlyFeeCents: z.number().int().min(0).optional(),
      setupFeeCents: z.number().int().min(0).optional(),
      expectedCloseDate: dataISO.optional(),
      nextAction: z.string().trim().max(300).nullable().optional(),
      nextActionAt: dataISO.optional(),
      lostReason: z.enum(MOTIVOS).nullable().optional(),
    })
    .optional(),
});

/** Só os campos que vieram, já no vocabulário do banco. */
function colunasDoPreenchimento(
  p: NonNullable<z.infer<typeof moverSchema>["preencher"]>,
): Record<string, unknown> {
  const mapa: [unknown, string][] = [
    [p.contactName, "contact_name"],
    [p.contactPhone, "contact_phone"],
    [p.contactEmail, "contact_email"],
    [p.ownerId, "owner_id"],
    [p.service, "service"],
    [p.referredBy, "referred_by"],
    [p.monthlyFeeCents, "monthly_fee_cents"],
    [p.setupFeeCents, "setup_fee_cents"],
    [p.expectedCloseDate, "expected_close_date"],
    [p.nextAction, "next_action"],
    [p.nextActionAt, "next_action_at"],
  ];

  const saida: Record<string, unknown> = {};
  for (const [valor, coluna] of mapa) {
    if (valor !== undefined) saida[coluna] = valor;
  }
  return saida;
}

export async function moverNegocio(
  input: z.input<typeof moverSchema>,
): Promise<ActionResult> {
  const parsed = moverSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Movimento inválido." };
  }

  const { dealId, stage, position, preencher } = parsed.data;
  const p = preencher ?? {};

  if (isDemoMode) {
    const { demoDeals, demoStageEvents } = await import("@/lib/mock/data");
    const alvo = demoDeals.find((d) => d.id === dealId);
    if (!alvo) return { ok: false, error: "Negócio não encontrado." };

    const depois = { ...alvo, ...paraDeal(alvo, p, stage) };
    const falta = oQueFalta(depois, stage);
    if (falta.length) return { ok: false, error: falta[0].pergunta };

    const anterior = alvo.stage;
    Object.assign(alvo, paraDeal(alvo, p, stage), {
      stage,
      position,
      updated_at: new Date().toISOString(),
    });

    // Espelha o trigger `stamp_crm_deal`.
    if (anterior !== stage) {
      alvo.won_at = stage === "ganho" ? new Date().toISOString() : null;
      alvo.lost_at = stage === "perdido" ? new Date().toISOString() : null;
      if (stage !== "perdido") alvo.lost_reason = null;

      demoStageEvents.push({
        id: `se-${dealId}-${stage}-${Date.now()}`,
        deal_id: dealId,
        from_stage: anterior,
        to_stage: stage,
        changed_by: null,
        changed_at: new Date().toISOString(),
      });
    }

    revalidatePath("/comercial");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* Lê antes de escrever para conferir o portão com a MESMA regra da
     tela. O banco tem os `check` equivalentes e recusaria de qualquer
     jeito — mas com uma mensagem que ninguém deve ver enquanto vende.
     Ver `src/lib/crm/portoes.ts`. */
  const { data: atual, error: erroLeitura } = await supabase
    .from("crm_deals")
    .select(
      "contact_name, contact_phone, contact_email, owner_id, service, " +
        "monthly_fee_cents, setup_fee_cents, expected_close_date, " +
        "next_action, next_action_at, lost_reason, origem, referred_by",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: traduzir(erroLeitura) };
  if (!atual) {
    return { ok: false, error: "Não foi possível mover: o negócio não existe mais." };
  }

  const base = atual as unknown as DealParaPortao;
  const falta = oQueFalta({ ...base, ...paraDeal(base, p, stage) }, stage);
  if (falta.length) return { ok: false, error: falta[0].pergunta };

  const { data, error } = await supabase
    .from("crm_deals")
    .update({
      ...colunasDoPreenchimento(p),
      stage,
      position,
      /* Mandar o motivo só quando é perdido. Em qualquer outra etapa o
         trigger já limpa, mas enviar `null` explicitamente evita
         depender da ordem de avaliação para não bater no check. */
      ...(stage === "perdido"
        ? { lost_reason: p.lostReason ?? base.lost_reason }
        : { lost_reason: null }),
    })
    .eq("id", dealId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível mover: o negócio não existe mais." };
  }

  revalidatePath("/comercial");
  return { ok: true };
}

/**
 * O preenchimento traduzido para o formato que o portão lê.
 *
 * Existe para a checagem rodar sobre a linha COMO ELA VAI FICAR, e não
 * como está. Sem isso, preencher o valor e mover para "Proposta" na
 * mesma ação seria recusado pelo próprio dado que a ação está gravando.
 */
function paraDeal(
  base: DealParaPortao,
  p: NonNullable<z.infer<typeof moverSchema>["preencher"]>,
  stage: DealStage,
): DealParaPortao {
  return {
    ...base,
    contact_name: p.contactName ?? base.contact_name,
    contact_phone: p.contactPhone ?? base.contact_phone,
    contact_email: p.contactEmail ?? base.contact_email,
    owner_id: p.ownerId ?? base.owner_id,
    service: p.service ?? base.service,
    referred_by: p.referredBy ?? base.referred_by,
    monthly_fee_cents: p.monthlyFeeCents ?? base.monthly_fee_cents,
    setup_fee_cents: p.setupFeeCents ?? base.setup_fee_cents,
    expected_close_date: p.expectedCloseDate ?? base.expected_close_date,
    next_action: p.nextAction ?? base.next_action,
    next_action_at: p.nextActionAt ?? base.next_action_at,
    /* Sair de 'perdido' limpa o motivo — é o que o trigger faz, e a
       checagem precisa enxergar a linha do mesmo jeito que o banco. */
    lost_reason:
      stage === "perdido" ? (p.lostReason ?? base.lost_reason) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Linha do tempo                                                      */
/* ------------------------------------------------------------------ */

const atividadeSchema = z.object({
  dealId: z.string().min(1),
  /* 'etapa' fica FORA da lista aceita: aquele tipo é escrito só pelo
     trigger. Aceitá-lo aqui deixaria a aplicação forjar uma mudança de
     etapa que nunca aconteceu, e o histórico deixaria de ser prova. */
  kind: z.enum(["nota", "ligacao", "reuniao", "email", "whatsapp"]),
  body: z.string().trim().min(1, "Escreva alguma coisa.").max(4000),
});

export async function registrarAtividade(
  input: z.input<typeof atividadeSchema>,
): Promise<ActionResult> {
  const parsed = atividadeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const { dealId, kind, body } = parsed.data;

  if (isDemoMode) {
    const { demoActivities, demoDeals } = await import("@/lib/mock/data");
    demoActivities.unshift({
      id: `a-${Date.now()}`,
      deal_id: dealId,
      kind: kind as ActivityKind,
      body,
      created_by: user.id,
      created_at: new Date().toISOString(),
      author: { id: user.id, full_name: user.full_name },
    });
    const alvo = demoDeals.find((d) => d.id === dealId);
    if (alvo) alvo.activityCount += 1;

    revalidatePath("/comercial");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_activities").insert({
    deal_id: dealId,
    kind,
    body,
    created_by: user.id,
  });

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/comercial");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Ganho vira cliente                                                  */
/* ------------------------------------------------------------------ */

const converterSchema = z.object({
  dealId: z.string().min(1),
  /* SEGMENTO E AGÊNCIA NÃO EXISTEM NO NEGÓCIO, e não dá para inventar:
     o segmento decide a unidade da meta e o rótulo de conversão do
     relatório, e a agência decide quem assina o documento e quem fatura.
     Errar qualquer um dos dois é caro e silencioso. Por isso a tela
     pergunta os dois na hora de converter, em vez de chutar um padrão. */
  segment: z.enum(["ecommerce", "delivery", "leads", "local_business"]),
  agencyPartner: z.string().trim().min(1),
});

/**
 * Cria a conta em `clients` a partir de um negócio ganho e amarra os
 * dois por `crm_deals.client_id`.
 *
 * É ATO EXPLÍCITO, não efeito de arrastar o cartão para "Ganho". Mover
 * um cartão é gesto barato e reversível; criar cliente não é — ele passa
 * a aparecer na carteira, na esteira, no faturamento e nos relatórios.
 * Um arraste errado não pode produzir isso.
 *
 * A conta nasce em `onboarding`, nunca em `active`: entre ganhar e
 * começar a operar existe contrato, acesso e configuração de conta de
 * anúncios, e uma conta 'active' sem integração aparece zerada em toda
 * tela de performance.
 */
export async function converterEmCliente(
  input: z.input<typeof converterSchema>,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const parsed = converterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const { dealId, segment, agencyPartner } = parsed.data;

  if (isDemoMode) {
    return {
      ok: false,
      error: "Em modo demo o cadastro de cliente não é criado.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { data: deal, error: erroLeitura } = await supabase
    .from("crm_deals")
    .select("id, company, contact_name, contact_email, contact_phone, stage, client_id, monthly_fee_cents")
    .eq("id", dealId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: traduzir(erroLeitura) };
  if (!deal) return { ok: false, error: "Negócio não encontrado." };

  const d = deal as {
    company: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    stage: DealStage;
    client_id: string | null;
    monthly_fee_cents: number;
  };

  if (d.client_id) {
    return { ok: false, error: "Este negócio já virou cliente." };
  }
  if (d.stage !== "ganho") {
    return { ok: false, error: "Só negócio ganho vira cliente." };
  }

  const { createClientAction } = await import("@/app/(app)/clientes/actions");
  const { newClientDefaults } = await import("@/lib/validation/client");

  /* Reusa o MESMO caminho de cadastro da tela de clientes — inclusive a
     RPC transacional que grava cliente, meta e integrações de uma vez.
     Um insert próprio aqui duplicaria a regra e divergiria dela no
     primeiro campo novo. */
  const criado = await createClientAction({
    ...newClientDefaults,
    // O nome da EMPRESA, com o título do negócio como reserva: o título
    // costuma ser "Empresa — serviço", que ficaria feio na carteira.
    name: d.company.trim().slice(0, 120),
    segment,
    agencyPartner,
    status: "onboarding",
    contactName: d.contact_name ?? "",
    contactEmail: d.contact_email ?? "",
    whatsappPhone: d.contact_phone ?? "",
  });

  if (!criado.ok) return { ok: false, error: criado.error };

  /* Amarra os dois. Se ESTE update falhar, o cliente já existe e o
     negócio fica sem vínculo — o desfecho é um cliente órfão, que é
     visível e corrigível, e não um cliente perdido. Por isso o erro aqui
     é reportado sem desfazer nada. */
  const { error: erroVinculo } = await supabase
    .from("crm_deals")
    .update({ client_id: criado.client.id })
    .eq("id", dealId);

  if (erroVinculo) {
    return {
      ok: false,
      error: `O cliente "${criado.client.name}" foi criado, mas não deu para ligá-lo ao negócio. Avise um administrador.`,
    };
  }

  revalidatePath("/comercial");
  revalidatePath("/clientes");
  return { ok: true, slug: criado.client.slug };
}

/* ------------------------------------------------------------------ */

/**
 * Traduz a recusa do banco numa frase que ajuda quem está na tela.
 *
 * 42501 é violação de RLS; 23514 é violação de `check`. Os dois chegam
 * como texto cru do Postgres, em inglês e citando nome de constraint —
 * inútil para quem está preenchendo um formulário.
 */
function traduzir(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "O banco recusou a operação. Se você não é administrador, alguns atos são restritos.";
  }
  if (error.code === "23514") {
    if (error.message.includes("next_action")) {
      return "Próxima ação precisa do que fazer E de quando.";
    }
    if (error.message.includes("motivo_so_em_perdido")) {
      return "Motivo de perda só vale em negócio perdido.";
    }
    return "Algum campo saiu fora do formato aceito.";
  }
  return error.message;
}

/* ------------------------------------------------------------------ */

/**
 * Linha do tempo de um negócio, para a ficha carregar sob demanda.
 *
 * Não vem no `getDeals` de propósito: são até 200 linhas por negócio, e
 * a tela mostra dezenas de cartões. Trazer tudo de antemão multiplicaria
 * o payload da página por um conteúdo que só é lido quando alguém abre
 * um negócio específico.
 */
export async function carregarAtividades(dealId: string) {
  if (!dealId) return [];
  const { getDealActivities } = await import("@/lib/data");
  return getDealActivities(dealId);
}
