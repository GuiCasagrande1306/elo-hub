"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode, serverEnv } from "@/lib/env";
import { apenasDigitos, MOTIVOS_DESCARTE } from "@/lib/leads/vocabulario";
import { notificarNovoLead } from "@/lib/leads/notificacao";
import { tokenDaPagina } from "@/lib/leads/token-da-pagina";
import { extrairCampos } from "@/lib/leads/registrar-lead-meta";
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LeadStageKind } from "@/types/database";

/* =====================================================================
   Server Actions do CRM de leads
   ---------------------------------------------------------------------
   Nenhuma checa permissão à mão. Todas usam a chave ANON com o JWT de
   quem está logado, então quem autoriza é a RLS — a mesma regra vale se
   alguém chamar a action por fora da interface. É a única forma de isto
   ser seguro com usuário de CLIENTE logado: a tela não é a fronteira.

   Toda entrada passa por Zod. Server Action é endpoint HTTP público, e
   o payload não é confiável só por ter saído de um componente nosso.

   ⚠️ `updated_at` É ESCRITO À MÃO, e não deveria precisar.
   `app.touch_updated_at()` existe desde a migration 1 e está ligado em
   quase toda tabela do sistema — mas a migration 56, que criou as
   `lead_*`, não criou os triggers. Sem escrever aqui, a coluna
   congelaria no `default now()` da inserção e "atualizado há 3 minutos"
   mentiria para sempre. O conserto de verdade é uma migration com os
   seis `create trigger`; enquanto ela não existe, isto mantém a coluna
   honesta sem exigir que ninguém rode SQL para a tela funcionar.
   ===================================================================== */

export type ActionResult = { ok: true } | { ok: false; error: string };

const MOTIVOS = MOTIVOS_DESCARTE.map((m) => m.id) as [string, ...string[]];

const FONTES = [
  "manual",
  "meta_ads",
  "google_ads",
  "whatsapp",
  "instagram",
  "site",
  "indicacao",
  "telefone",
  "outro",
] as const;

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/**
 * O tipo e o dono de uma etapa.
 *
 * O CLIENTE MANDA O `stage_id`, E O SERVIDOR NÃO ACREDITA NO RESTO. A
 * tela sabe se a coluna de destino é 'ganho' ou 'perdido', mas mandar
 * esse dado junto deixaria a aplicação decidir se um lead conta como
 * ganho — e é a partir daí que sai a taxa de aproveitamento que o
 * cliente lê. Uma consulta a mais por movimento é barata; um número de
 * conversão que a interface pode forjar não é.
 *
 * A leitura passa pela RLS de `lead_stages`, então uma etapa de outro
 * cliente simplesmente não é encontrada.
 */
async function lerEtapa(
  stageId: string,
): Promise<{ kind: LeadStageKind; pipeline_id: string } | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("lead_stages")
    .select("kind, pipeline_id")
    .eq("id", stageId)
    .maybeSingle();

  return (data as { kind: LeadStageKind; pipeline_id: string } | null) ?? null;
}

/**
 * O contato do lead, reaproveitando quem já existe.
 *
 * `lead_contacts` tem índice único parcial em (client_id, phone). Um
 * `upsert` com `onConflict` não serve: o Postgres só infere um índice
 * PARCIAL quando o ON CONFLICT repete a mesma cláusula WHERE, e o
 * PostgREST não tem como expressá-la. Ler antes e decidir é mais
 * verboso e é previsível — que é o que importa numa tabela cujo motivo
 * de existir é a segunda compra da mesma pessoa cair no mesmo contato.
 *
 * Sem telefone não há como deduplicar, então cria sempre. É o
 * comportamento honesto: dois "João" sem telefone podem ser dois Joões.
 */
async function resolverContato(args: {
  clientId: string;
  name: string;
  phone: string | null;
  email: string | null;
}): Promise<{ id: string } | { erro: string }> {
  const supabase = await createSupabaseServerClient();

  if (args.phone) {
    const { data: existente } = await supabase
      .from("lead_contacts")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("phone", args.phone)
      .maybeSingle();

    if (existente) {
      /* Não sobrescreve o nome do contato antigo com o que veio agora:
         quem já está no funil há três meses tem o nome conferido por
         alguém, e um formulário novo traz "joao" em caixa baixa. Só
         completa o que falta. */
      await supabase
        .from("lead_contacts")
        .update({
          ...(args.email ? { email: args.email } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", (existente as { id: string }).id);

      return { id: (existente as { id: string }).id };
    }
  }

  const { data, error } = await supabase
    .from("lead_contacts")
    .insert({
      client_id: args.clientId,
      name: args.name,
      phone: args.phone,
      email: args.email,
    })
    .select("id")
    .single();

  if (error) return { erro: traduzir(error) };
  return { id: (data as { id: string }).id };
}

/* ------------------------------------------------------------------ */
/* Criar                                                               */
/* ------------------------------------------------------------------ */

const criarSchema = z.object({
  clientId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().trim().min(1, "Dê um nome ao lead.").max(200),
  contactName: z.string().trim().max(200).nullable(),
  /* Telefone chega COM MÁSCARA da tela e é normalizado abaixo — o banco
     só aceita dígitos. Ver `apenasDigitos`. */
  contactPhone: z.string().trim().max(60).nullable(),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
  source: z.enum(FONTES),
  valueCents: z.number().int().min(0),
  ownerId: z.string().min(1).nullable(),
});

export async function criarLead(
  input: z.input<typeof criarSchema>,
): Promise<{ ok: true; dealId: string } | { ok: false; error: string }> {
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const v = parsed.data;

  /* Telefone digitado que não vira número válido é ERRO, não silêncio.
     Gravar `null` faria o lead entrar sem o único dado que permite
     ligar para ele, e ninguém perceberia até tentar. */
  const telefone = v.contactPhone ? apenasDigitos(v.contactPhone) : null;
  if (v.contactPhone && !telefone) {
    return { ok: false, error: "Telefone inválido. Use DDD + número." };
  }

  if (isDemoMode) {
    const { boardDemo } = await import("@/lib/mock/leads");
    const board = boardDemo(v.clientId);
    const agora = new Date().toISOString();
    const id = `l-demo-${Date.now()}`;

    board.leads.unshift({
      id,
      client_id: v.clientId,
      pipeline_id: v.pipelineId,
      stage_id: v.stageId,
      contact_id: v.contactName ? `ct-${id}` : null,
      title: v.title,
      value_cents: v.valueCents,
      source: v.source,
      owner_id: v.ownerId,
      position: Date.now(),
      closed_at: null,
      lost_reason: null,
      external_id: null,
      created_by: user.id,
      created_at: agora,
      updated_at: agora,
      contact: v.contactName
        ? {
            id: `ct-${id}`,
            client_id: v.clientId,
            name: v.contactName,
            phone: telefone,
            email: v.contactEmail,
            notes: null,
            created_at: agora,
            updated_at: agora,
          }
        : null,
      owner: null,
      noteCount: 0,
      openTasks: [],
    });

    revalidatePath("/leads");
    return { ok: true, dealId: id };
  }

  const etapa = await lerEtapa(v.stageId);
  if (!etapa) return { ok: false, error: "Etapa não encontrada." };
  if (etapa.pipeline_id !== v.pipelineId) {
    return { ok: false, error: "Essa etapa não pertence a este funil." };
  }

  let contactId: string | null = null;
  if (v.contactName) {
    const contato = await resolverContato({
      clientId: v.clientId,
      name: v.contactName,
      phone: telefone,
      email: v.contactEmail,
    });
    if ("erro" in contato) return { ok: false, error: contato.erro };
    contactId = contato.id;
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("lead_deals")
    .insert({
      client_id: v.clientId,
      pipeline_id: v.pipelineId,
      stage_id: v.stageId,
      contact_id: contactId,
      title: v.title,
      value_cents: v.valueCents,
      source: v.source,
      owner_id: v.ownerId,
      /* Topo da coluna. O quadro ordena por posição decrescente, então
         o maior valor aparece primeiro — lead novo tem que estar onde a
         pessoa olha, não no fim de uma lista rolável. */
      position: Date.now(),
      closed_at: etapa.kind === "aberto" ? null : new Date().toISOString(),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true, dealId: (data as { id: string }).id };
}

/* ------------------------------------------------------------------ */
/* Mover no funil                                                      */
/* ------------------------------------------------------------------ */

const moverSchema = z.object({
  dealId: z.string().min(1),
  stageId: z.string().min(1),
  position: z.number().finite(),
  /** Só quando a etapa de destino é do tipo 'perdido'. */
  lostReason: z.enum(MOTIVOS).nullable().optional(),
});

export async function moverLead(
  input: z.input<typeof moverSchema>,
): Promise<ActionResult> {
  const parsed = moverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Movimento inválido." };

  const { dealId, stageId, position, lostReason } = parsed.data;

  if (isDemoMode) {
    const { acharLeadDemo, boardDemo } = await import("@/lib/mock/leads");
    const alvo = acharLeadDemo(dealId);
    if (!alvo) return { ok: false, error: "Lead não encontrado." };

    const etapa = boardDemo(alvo.client_id).stages.find((e) => e.id === stageId);
    if (!etapa) return { ok: false, error: "Etapa não encontrada." };
    if (etapa.kind === "perdido" && !lostReason) {
      return { ok: false, error: "Diga por que o lead foi descartado." };
    }

    alvo.stage_id = stageId;
    alvo.position = position;
    alvo.closed_at = etapa.kind === "aberto" ? null : new Date().toISOString();
    alvo.lost_reason = etapa.kind === "perdido" ? (lostReason ?? null) : null;
    alvo.updated_at = new Date().toISOString();

    revalidatePath("/leads");
    return { ok: true };
  }

  const etapa = await lerEtapa(stageId);
  if (!etapa) return { ok: false, error: "Etapa não encontrada." };

  /* Descarte SEM MOTIVO é recusado aqui, e não no banco: `lost_reason`
     é `text` anulável na migration 56, então o Postgres aceitaria de
     bom grado. A regra é do produto — é o motivo que transforma a fila
     de descartados em decisão de mídia, e sem ele o registro não
     responde nada. */
  if (etapa.kind === "perdido" && !lostReason) {
    return { ok: false, error: "Diga por que o lead foi descartado." };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("lead_deals")
    .update({
      stage_id: stageId,
      position,
      /* `closed_at` marca o fim, e é limpo ao reabrir: um lead que
         voltou para "Em conversa" com data de fechamento entraria no
         relatório do mês como fechado e aberto ao mesmo tempo. */
      closed_at: etapa.kind === "aberto" ? null : new Date().toISOString(),
      lost_reason: etapa.kind === "perdido" ? (lostReason ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível mover: o lead não existe mais." };
  }

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Editar                                                              */
/* ------------------------------------------------------------------ */

const editarSchema = z.object({
  dealId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  valueCents: z.number().int().min(0).optional(),
  source: z.enum(FONTES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
});

export async function atualizarLead(
  input: z.input<typeof editarSchema>,
): Promise<ActionResult> {
  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { dealId, ...v } = parsed.data;

  const patch = {
    ...(v.title !== undefined ? { title: v.title } : {}),
    ...(v.valueCents !== undefined ? { value_cents: v.valueCents } : {}),
    ...(v.source !== undefined ? { source: v.source } : {}),
    ...(v.ownerId !== undefined ? { owner_id: v.ownerId } : {}),
  };

  if (Object.keys(patch).length === 0) return { ok: true };

  if (isDemoMode) {
    const { acharLeadDemo } = await import("@/lib/mock/leads");
    const alvo = acharLeadDemo(dealId);
    if (!alvo) return { ok: false, error: "Lead não encontrado." };
    Object.assign(alvo, patch);
    alvo.updated_at = new Date().toISOString();
    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `select` depois do update para distinguir "recusado pela policy" de
     "id não existe": sem ele, os dois voltam com zero linhas e nenhum
     erro, e a tela diria "salvo" sem ter salvado. */
  const { data, error } = await supabase
    .from("lead_deals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", dealId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível salvar: o lead não existe mais." };
  }

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Contato                                                             */
/* ------------------------------------------------------------------ */

const contatoSchema = z.object({
  dealId: z.string().min(1),
  clientId: z.string().min(1),
  contactId: z.string().min(1).nullable(),
  name: z.string().trim().min(1, "O contato precisa de um nome.").max(200),
  phone: z.string().trim().max(60).nullable(),
  email: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido."),
});

/**
 * Grava o contato do lead — criando, atualizando ou vinculando.
 *
 * Um lead pode nascer sem contato (formulário sem telefone), então esta
 * action cobre os três casos com a mesma porta: se o lead já tem
 * contato, atualiza; se não tem, procura por telefone e reaproveita, ou
 * cria e vincula.
 */
export async function salvarContato(
  input: z.input<typeof contatoSchema>,
): Promise<ActionResult> {
  const parsed = contatoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const v = parsed.data;

  const telefone = v.phone ? apenasDigitos(v.phone) : null;
  if (v.phone && !telefone) {
    return { ok: false, error: "Telefone inválido. Use DDD + número." };
  }

  if (isDemoMode) {
    const { acharLeadDemo } = await import("@/lib/mock/leads");
    const alvo = acharLeadDemo(v.dealId);
    if (!alvo) return { ok: false, error: "Lead não encontrado." };
    const agora = new Date().toISOString();

    alvo.contact = {
      id: alvo.contact?.id ?? `ct-${v.dealId}`,
      client_id: v.clientId,
      name: v.name,
      phone: telefone,
      email: v.email,
      notes: alvo.contact?.notes ?? null,
      created_at: alvo.contact?.created_at ?? agora,
      updated_at: agora,
    };
    alvo.contact_id = alvo.contact.id;
    alvo.updated_at = agora;

    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  if (v.contactId) {
    const { error } = await supabase
      .from("lead_contacts")
      .update({
        name: v.name,
        phone: telefone,
        email: v.email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", v.contactId);

    if (error) return { ok: false, error: traduzir(error) };
    revalidatePath("/leads");
    return { ok: true };
  }

  const contato = await resolverContato({
    clientId: v.clientId,
    name: v.name,
    phone: telefone,
    email: v.email,
  });
  if ("erro" in contato) return { ok: false, error: contato.erro };

  const { error } = await supabase
    .from("lead_deals")
    .update({ contact_id: contato.id, updated_at: new Date().toISOString() })
    .eq("id", v.dealId);

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Anotação                                                            */
/* ------------------------------------------------------------------ */

const notaSchema = z.object({
  dealId: z.string().min(1),
  body: z.string().trim().min(1, "Escreva alguma coisa.").max(4000),
});

export async function anotarNoLead(
  input: z.input<typeof notaSchema>,
): Promise<ActionResult> {
  const parsed = notaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const { dealId, body } = parsed.data;

  if (isDemoMode) {
    const { acharLeadDemo, notasDemo } = await import("@/lib/mock/leads");
    notasDemo.unshift({
      id: `n-${Date.now()}`,
      deal_id: dealId,
      author_id: user.id,
      body,
      created_at: new Date().toISOString(),
      author: { id: user.id, full_name: user.full_name },
    });
    const alvo = acharLeadDemo(dealId);
    if (alvo) alvo.noteCount += 1;

    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("lead_notes")
    .insert({ deal_id: dealId, body, author_id: user.id });

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Tarefa                                                              */
/* ------------------------------------------------------------------ */

const tarefaSchema = z.object({
  dealId: z.string().min(1),
  title: z.string().trim().min(1, "O que precisa ser feito?").max(200),
  /* Data pura da tela; vira instante no fuso do Brasil abaixo.
     `due_at` é NOT NULL na migration — tarefa de CRM sem data é
     lembrete que ninguém lembra. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha uma data."),
  assigneeId: z.string().min(1).nullable().optional(),
});

export async function criarTarefaDoLead(
  input: z.input<typeof tarefaSchema>,
): Promise<ActionResult> {
  const parsed = tarefaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const { dealId, title, dueDate, assigneeId } = parsed.data;

  /* MEIO-DIA DE BRASÍLIA, não meia-noite. Uma tarefa marcada para
     "amanhã" gravada como `2026-09-09T00:00:00-03:00` vira 03:00 UTC —
     e qualquer leitura que arredonde para o dia UTC a joga para o dia
     seguinte. O meio-dia sobrevive a três horas de fuso em qualquer
     direção. Mesmo critério de `formatDueDate` e `estadoDaAcao`. */
  const dueAt = new Date(`${dueDate}T12:00:00-03:00`).toISOString();

  if (isDemoMode) {
    const { acharLeadDemo, tarefasDemo } = await import("@/lib/mock/leads");
    const tarefa = {
      id: `t-${Date.now()}`,
      deal_id: dealId,
      title,
      due_at: dueAt,
      assignee_id: assigneeId ?? null,
      done_at: null,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    tarefasDemo.push(tarefa);

    const alvo = acharLeadDemo(dealId);
    if (alvo) {
      alvo.openTasks = [...alvo.openTasks, { id: tarefa.id, title, due_at: dueAt }].sort(
        (a, b) => a.due_at.localeCompare(b.due_at),
      );
    }

    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_tasks").insert({
    deal_id: dealId,
    title,
    due_at: dueAt,
    assignee_id: assigneeId ?? null,
    created_by: user.id,
  });

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true };
}

const concluirSchema = z.object({
  taskId: z.string().min(1),
  feita: z.boolean(),
});

export async function concluirTarefaDoLead(
  input: z.input<typeof concluirSchema>,
): Promise<ActionResult> {
  const parsed = concluirSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const { taskId, feita } = parsed.data;

  if (isDemoMode) {
    const { acharLeadDemo, tarefasDemo } = await import("@/lib/mock/leads");
    const tarefa = tarefasDemo.find((t) => t.id === taskId);
    if (!tarefa) return { ok: false, error: "Tarefa não encontrada." };

    tarefa.done_at = feita ? new Date().toISOString() : null;

    const alvo = acharLeadDemo(tarefa.deal_id);
    if (alvo) {
      alvo.openTasks = tarefasDemo
        .filter((t) => t.deal_id === tarefa.deal_id && !t.done_at)
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at }));
    }

    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("lead_tasks")
    .update({ done_at: feita ? new Date().toISOString() : null })
    .eq("id", taskId);

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Excluir                                                             */
/* ------------------------------------------------------------------ */

/**
 * Apaga o lead de vez.
 *
 * Existe para o lead cadastrado errado — duplicata óbvia, teste, dedo
 * torto. NÃO é o caminho para lead ruim: esse tem que ir para
 * "Descartado" com motivo, porque a contagem de descarte por
 * segmentação é o que justifica o módulo inteiro. Apagar some com a
 * evidência.
 *
 * As anotações e tarefas caem junto por `on delete cascade`; o CONTATO
 * fica, e de propósito: ele pertence ao cliente, não ao lead, e pode
 * estar em outro negócio.
 */
export async function excluirLead(dealId: string): Promise<ActionResult> {
  if (!dealId) return { ok: false, error: "Lead inválido." };

  if (isDemoMode) {
    const { quadrosDemo } = await import("@/lib/mock/leads");
    for (const board of quadrosDemo().values()) {
      const i = board.leads.findIndex((l) => l.id === dealId);
      if (i >= 0) board.leads.splice(i, 1);
    }
    revalidatePath("/leads");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_deals").delete().eq("id", dealId);

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/leads");
  return { ok: true };
}

/* ------------------------------------------------------------------ */

/** Histórico da ficha, carregado sob demanda. Ver `getLeadHistory`. */
export async function carregarHistorico(dealId: string) {
  const { getLeadHistory } = await import("@/lib/leads/queries");
  return getLeadHistory(dealId);
}

/* ------------------------------------------------------------------ */

function traduzir(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "O banco recusou a operação. Você pode não ter acesso a esta conta.";
  }
  if (error.code === "23505") {
    /* Índice único de (client_id, phone) em `lead_contacts`. */
    return "Já existe um contato com esse telefone nesta conta.";
  }
  if (error.code === "23514") {
    if (error.message.includes("phone")) {
      return "Telefone fora do formato aceito: use apenas DDD + número.";
    }
    if (error.message.includes("email")) return "E-mail fora do formato aceito.";
    return "Algum campo saiu fora do formato aceito.";
  }
  if (error.code === "PGRST202") {
    /* `criar_funil_padrao` ausente em `public` — a migration 60 é o que
       conserta, e o erro cru ("Searched for the function…") não diz
       isso para ninguém. */
    return "O funil padrão não pôde ser criado. Falta rodar a migration 60 no banco.";
  }
  return error.message;
}

/* ================================================================== */
/* Importar lead do Meta via Graph API (fallback quando webhook falha) */
/* ================================================================== */

export async function importarLeadMeta(input: {
  clientId: string;
  leadgenId: string;
}): Promise<ActionResult & { leadId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Faça login de novo." };
  if (user.role !== "admin") return { ok: false, error: "Apenas administradores podem importar leads." };

  const { clientId, leadgenId } = input;

  if (!leadgenId.trim()) return { ok: false, error: "Informe o ID do lead." };
  if (isDemoMode) return { ok: true };

  const supabase = createSupabaseAdminClient();

  /* 1. Buscar cliente */
  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, lead_notify_phone, whatsapp_phone, meta_page_id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr || !clientRow) {
    return { ok: false, error: "Cliente não encontrado." };
  }

  const client = clientRow as {
    id: string; name: string;
    lead_notify_phone: string | null;
    whatsapp_phone: string | null;
    meta_page_id: string | null;
  };

  /* 2. Token Meta do cliente */
  const { data: intRow } = await supabase
    .from("client_integrations")
    .select("integration_secrets(access_token)")
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const token = (intRow as { integration_secrets: { access_token: string | null } | null } | null)
    ?.integration_secrets?.access_token;

  if (!token) return { ok: false, error: "Token Meta não configurado para este cliente." };

  /* 3. Buscar lead na Graph API */
  const version = serverEnv.metaApiVersion;
  const tokenLeitura =
    (client.meta_page_id ? await tokenDaPagina(token, client.meta_page_id) : null) ?? token;
  const res = await fetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId.trim())}?fields=field_data,created_time,ad_name&access_token=${tokenLeitura}`,
    { signal: AbortSignal.timeout(10_000) },
  ).catch((e: unknown) => {
    throw new Error(`Falha ao contatar Meta: ${e instanceof Error ? e.message : String(e)}`);
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return { ok: false, error: `Graph API: ${err.error?.message ?? res.status}` };
  }

  const data = await res.json() as { field_data?: { name: string; values: string[] }[]; ad_name?: string };
  const fieldData = data.field_data ?? [];

  /* 4. Extrair campos */
  const campos = extrairCampos(fieldData, data.ad_name ?? null);
  const { nome, telefone, email, extras } = campos;

  /* 5. Funil */
  const { data: pipelineRow } = await supabase
    .from("lead_pipelines")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_default", true)
    .maybeSingle();

  let pipelineId: string | null = pipelineRow ? (pipelineRow as { id: string }).id : null;

  if (!pipelineId) {
    const { data: criado, error: pErr } = await supabase.rpc("criar_funil_padrao", { p_client: clientId });
    if (pErr) return { ok: false, error: "Não foi possível criar o funil." };
    pipelineId = criado as string;
  }

  const { data: stageRow } = await supabase
    .from("lead_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("kind", "aberto")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stageRow) return { ok: false, error: "Funil sem etapa inicial." };

  /* 6. Contato */
  let contactId: string | null = null;

  if (telefone) {
    const { data: ex } = await supabase
      .from("lead_contacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("phone", telefone)
      .maybeSingle();
    if (ex) contactId = (ex as { id: string }).id;
  }

  if (!contactId) {
    const { data: novoContato } = await supabase
      .from("lead_contacts")
      .insert({ client_id: clientId, name: nome ?? "Lead Meta Ads", phone: telefone, email })
      .select("id")
      .single();
    contactId = novoContato ? (novoContato as { id: string }).id : null;
  }

  /* 7. Deal */
  const titulo = nome ?? (data.ad_name ? `Lead · ${data.ad_name}` : "Lead Meta Ads");

  const { data: dealRow, error: dealErr } = await supabase
    .from("lead_deals")
    .insert({
      client_id: clientId,
      pipeline_id: pipelineId,
      stage_id: (stageRow as { id: string }).id,
      contact_id: contactId,
      title: titulo,
      source: "meta_ads",
      external_id: leadgenId.trim(),
      position: Date.now(),
      value_cents: 0,
      created_by: null,
    })
    .select("id")
    .single();

  if (dealErr) {
    if (dealErr.code === "23505") return { ok: false, error: "Este lead já foi importado anteriormente." };
    return { ok: false, error: dealErr.message };
  }

  /* 8. Notificação WhatsApp */
  const notifyPhone = client.lead_notify_phone ?? client.whatsapp_phone;
  if (notifyPhone) {
    await notificarNovoLead(notifyPhone, {
      clientName: client.name,
      contactName: nome,
      contactPhone: telefone,
      contactEmail: email,
      campaignName: data.ad_name ?? null,
      extras,
    }).catch(() => { /* silencioso */ });
  }

  revalidatePath("/leads");
  return { ok: true, leadId: (dealRow as { id: string }).id };
}
