"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseCurrencyToCents } from "@/lib/format";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/* =====================================================================
   Escrita do CRM
   ---------------------------------------------------------------------
   TODA escrita pelo cliente de SESSÃO. Nenhuma linha aqui usa
   service_role, e isso é deliberado: a separação entre as bases de dois
   clientes é a policy, não um `where` que alguém lembra de escrever.

   Medido em 22/08/2026: um usuário de cliente tentando gravar um lead na
   empresa de outro recebe HTTP 403 do próprio Postgres. Se estas ações
   usassem service_role, esse 403 viraria um insert bem-sucedido.
   ===================================================================== */

export type Resultado<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

const id = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Funil                                                               */
/* ------------------------------------------------------------------ */

/**
 * Garante o funil inicial da empresa.
 *
 * Idempotente do lado do banco: chamar de novo devolve o que já existe.
 * A tela chama ao abrir, então uma empresa nunca vê um quadro sem
 * colunas — que é o estado mais confuso possível num CRM.
 */
export async function garantirFunil(clientId: string): Promise<Resultado<{ pipelineId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("criar_funil_padrao", {
    p_client: clientId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true, dados: { pipelineId: data as string } };
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

const novoLead = z.object({
  clientId: id,
  pipelineId: id,
  stageId: id,
  title: z.string().trim().min(1, "Dê um nome ao lead.").max(200),
  /* Texto e não número: o campo aceita "1.250,00" e a conversão mora
     num lugar só. Number() em "1.250,00" devolve NaN, e NaN gravado
     vira zero silencioso — o pior desfecho num campo de dinheiro. */
  value: z.string().trim().default(""),
  source: z
    .enum([
      "manual", "meta_ads", "google_ads", "whatsapp",
      "instagram", "site", "indicacao", "telefone", "outro",
    ])
    .default("manual"),
  contactName: z.string().trim().max(200).default(""),
  contactPhone: z.string().trim().max(30).default(""),
  contactEmail: z.string().trim().max(200).default(""),
});

/* O DINHEIRO É CONVERTIDO POR `parseCurrencyToCents`, de `lib/format`.
   Havia aqui uma segunda implementação, `centavosDoTexto`, com as
   mesmas regras escritas de outro jeito — e um módulo `"use server"`
   nem pode exportar função síncrona, então ela quebrava o build. Duas
   funções para a mesma borda divergem no primeiro ajuste, e a que
   divergisse aqui gravaria o valor errado do lead. Um parser de
   dinheiro no sistema, e é o que já formatava. */

/** Só dígitos — ver a nota do índice único em `lead_contacts`. */
function apenasDigitos(t: string): string | null {
  const d = t.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export async function criarLead(
  input: z.input<typeof novoLead>,
): Promise<Resultado<{ dealId: string }>> {
  const parsed = novoLead.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const v = parsed.data;
  const cents = parseCurrencyToCents(v.value);
  if (cents === null) {
    return { ok: false, error: "Valor inválido. Use algo como 1.250,00." };
  }

  const supabase = await createSupabaseServerClient();

  /* --- contato: reaproveita quem já existe pelo telefone ----------- */
  let contactId: string | null = null;
  const telefone = v.contactPhone ? apenasDigitos(v.contactPhone) : null;

  if (v.contactPhone && !telefone) {
    return { ok: false, error: "Telefone inválido. Use DDD + número." };
  }

  if (v.contactName || telefone || v.contactEmail) {
    if (telefone) {
      const { data: existente } = await supabase
        .from("lead_contacts")
        .select("id")
        .eq("client_id", v.clientId)
        .eq("phone", telefone)
        .maybeSingle();

      contactId = existente?.id ?? null;
    }

    if (!contactId) {
      const { data: criado, error } = await supabase
        .from("lead_contacts")
        .insert({
          client_id: v.clientId,
          name: v.contactName || v.title,
          phone: telefone,
          email: v.contactEmail || null,
        })
        .select("id")
        .single();

      if (error) return { ok: false, error: `Contato: ${error.message}` };
      contactId = criado.id;
    }
  }

  /* --- posição: entra no TOPO da coluna ---------------------------- */
  const { data: primeiro } = await supabase
    .from("lead_deals")
    .select("position")
    .eq("stage_id", v.stageId)
    .order("position")
    .limit(1)
    .maybeSingle();

  const position = (primeiro?.position ?? 1000) - 1000;

  const { data: deal, error } = await supabase
    .from("lead_deals")
    .insert({
      client_id: v.clientId,
      pipeline_id: v.pipelineId,
      stage_id: v.stageId,
      contact_id: contactId,
      title: v.title,
      value_cents: cents,
      source: v.source,
      created_by: user.id,
      position,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true, dados: { dealId: deal.id } };
}

const mover = z.object({
  dealId: id,
  stageId: id,
  position: z.number().int(),
  /** `true` quando a etapa de destino fecha o negócio. */
  fecha: z.boolean().default(false),
});

/**
 * O arrastar.
 *
 * `closed_at` acompanha a etapa: mover para Ganho ou Perdido carimba a
 * data, e voltar para uma etapa aberta apaga. Sem isso, um negócio
 * reaberto continuaria contando como fechado no relatório do mês.
 */
export async function moverLead(
  input: z.input<typeof mover>,
): Promise<Resultado> {
  const parsed = mover.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const { dealId, stageId, position, fecha } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("lead_deals")
    .update({
      stage_id: stageId,
      position,
      closed_at: fecha ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

const edicao = z.object({
  dealId: id,
  title: z.string().trim().min(1).max(200).optional(),
  value: z.string().trim().optional(),
  ownerId: z.string().nullable().optional(),
  lostReason: z.string().trim().max(300).nullable().optional(),
});

export async function atualizarLead(
  input: z.input<typeof edicao>,
): Promise<Resultado> {
  const parsed = edicao.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const v = parsed.data;
  const campos: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (v.title !== undefined) campos.title = v.title;
  if (v.ownerId !== undefined) campos.owner_id = v.ownerId || null;
  if (v.lostReason !== undefined) campos.lost_reason = v.lostReason || null;

  if (v.value !== undefined) {
    const cents = parseCurrencyToCents(v.value);
    if (cents === null) return { ok: false, error: "Valor inválido." };
    campos.value_cents = cents;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_deals").update(campos).eq("id", v.dealId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

export async function excluirLead(dealId: string): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_deals").delete().eq("id", dealId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Notas                                                               */
/* ------------------------------------------------------------------ */

export async function adicionarNota(input: {
  dealId: string;
  body: string;
}): Promise<Resultado> {
  const texto = input.body.trim();
  if (!texto) return { ok: false, error: "Escreva algo." };
  if (texto.length > 4000) return { ok: false, error: "Nota longa demais." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_notes").insert({
    deal_id: input.dealId,
    body: texto,
    author_id: user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

export async function carregarNotas(dealId: string): Promise<
  Resultado<{ id: string; body: string; created_at: string; author: { full_name: string } | null }[]>
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_notes")
    .select("id, body, created_at, author:profiles(full_name)")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };

  return { ok: true, dados: (data ?? []) as never };
}

/* ------------------------------------------------------------------ */
/* Tarefas                                                             */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ `dueAt` CHEGA EM ISO COM FUSO, montado no navegador.
 *
 * O campo da tela é um `datetime-local`, que entrega "2026-08-25T14:00"
 * — sem fuso nenhum. Converter isso aqui com `new Date(...)` usaria o
 * relógio do servidor, que na Vercel é UTC: a tarefa marcada para as 14h
 * viraria 11h de Brasília, três horas antes, silenciosamente.
 *
 * Quem sabe o fuso da pessoa é o navegador dela. Então a conversão mora
 * lá, e o que trafega já é instante absoluto.
 */
const novaTarefa = z.object({
  dealId: id,
  title: z.string().trim().min(1, "Descreva a tarefa.").max(200),
  dueAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Escolha uma data e um horário."),
  assigneeId: z.string().nullable().default(null),
});

export async function criarTarefa(
  input: z.input<typeof novaTarefa>,
): Promise<Resultado> {
  const parsed = novaTarefa.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const v = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("lead_tasks").insert({
    deal_id: v.dealId,
    title: v.title,
    due_at: v.dueAt,
    assignee_id: v.assigneeId || null,
    created_by: user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

/**
 * Concluir e DESconcluir pela mesma porta.
 *
 * Marcar a caixa errada é o engano mais comum de lista de tarefa, e uma
 * ação que só sabe concluir transforma um clique acidental em algo que
 * exige apagar e recadastrar — perdendo prazo e responsável.
 */
export async function alternarTarefa(
  taskId: string,
  feita: boolean,
): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("lead_tasks")
    .update({ done_at: feita ? new Date().toISOString() : null })
    .eq("id", taskId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

export async function excluirTarefa(taskId: string): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_tasks").delete().eq("id", taskId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/crm");
  return { ok: true };
}

export interface TarefaDoLead {
  id: string;
  title: string;
  due_at: string;
  done_at: string | null;
  assignee: { full_name: string } | null;
}

export async function carregarTarefas(
  dealId: string,
): Promise<Resultado<TarefaDoLead[]>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_tasks")
    /* Chave estrangeira nomeada: `lead_tasks` aponta para `profiles`
       duas vezes (`assignee_id` e `created_by`), e o embed ambíguo é
       recusado. Mesmo caso de `lead_deals` — ver a nota em
       `lib/crm/queries.ts`. `lead_notes` não precisa: lá só existe
       `author_id`. */
    .select("id, title, due_at, done_at, assignee:profiles!lead_tasks_assignee_id_fkey(full_name)")
    .eq("deal_id", dealId)
    /* Pendente primeiro e, dentro dela, a mais próxima de vencer — que
       é a ordem em que a pessoa vai agir. Concluída fica abaixo como
       histórico, não some: sumir esconderia o que já foi feito e o
       mesmo contato seria cobrado duas vezes. */
    .order("done_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true });

  if (error) return { ok: false, error: error.message };

  return { ok: true, dados: (data ?? []) as never };
}
