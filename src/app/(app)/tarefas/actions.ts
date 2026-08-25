"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { diaBRComoInstante, hojeComoInstante } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TaskPriority, TaskStatus } from "@/types/database";

/**
 * Server Actions do módulo de tarefas.
 *
 * Nenhuma delas checa permissão à mão — e isso é intencional. Todas
 * usam o cliente com a chave ANON e o JWT do usuário, então o UPDATE
 * atinge zero linhas quando a policy não autoriza. É a diferença entre
 * "a aplicação decidiu não deixar" e "o banco não deixou": a segunda
 * continua valendo se alguém chamar a action por fora da interface.
 *
 * Toda entrada passa por Zod antes de tocar o banco. Server Action é
 * endpoint HTTP público — o payload não é confiável só por ter saído
 * de um componente nosso.
 */

const statusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
]);

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * O que vem do `<input type="date">` é um DIA — "2026-08-14" —, mas
 * `due_date` é `timestamptz`. Gravar a string crua deixa o Postgres
 * completar a hora com o fuso da sessão (UTC), e o prazo cai às 21h do
 * dia anterior em São Paulo.
 *
 * Aqui a data vira meio-dia de Brasília antes de descer para o banco.
 * `null` continua `null` — tarefa sem prazo é caso legítimo, e não pode
 * virar "hoje" por acidente de normalização.
 *
 * Aceita ISO completo sem mexer: se um dia outra tela mandar um instante
 * de verdade, ele passa direto em vez de ser remontado errado.
 */
function prazoParaInstante(valor: string | null): string | null {
  if (valor === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? diaBRComoInstante(valor) : valor;
}

/* ------------------------------------------------------------------ */
/* Mover no Kanban                                                     */
/* ------------------------------------------------------------------ */

const moveSchema = z.object({
  taskId: z.string().min(1),
  status: statusSchema,
  position: z.number().finite(),
});

/**
 * Move a tarefa de coluna e/ou reordena.
 *
 * `position` é fracionária: soltar um card entre dois vizinhos grava a
 * média das duas posições. Um único UPDATE, em vez de reescrever o
 * índice de toda a coluna — o que, com Realtime ligado, geraria uma
 * tempestade de eventos para cada usuário conectado.
 */
export async function moveTask(input: {
  taskId: string;
  status: TaskStatus;
  position: number;
}): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const { taskId, status, position } = parsed.data;

  if (isDemoMode) {
    const { demoTasks } = await import("@/lib/mock/data");
    const task = demoTasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      task.position = position;
      task.completed_at = status === "done" ? new Date().toISOString() : null;
      if (status === "done") task.progress = 100;
    }
    revalidatePath("/tarefas");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status, position })
    .eq("id", taskId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tarefas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Editar campos da tarefa                                             */
/* ------------------------------------------------------------------ */

const updateSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  dueDate: z.string().nullable().optional(),
  criticality: z.number().int().min(1).max(10).optional(),
  colorTag: z
    .enum(["rosa", "laranja", "ambar", "verde", "azul", "roxo", "cinza"])
    .nullable()
    .optional(),
  /* Vincular a conta depois da criação. Antes o cliente só entrava no
     momento em que a tarefa nascia, e herdado do filtro ativo — quem
     criava sem filtro ficava com a tarefa órfã e sem conserto na
     lista. */
  clientId: z.string().min(1).nullable().optional(),
});

export async function updateTask(input: {
  taskId: string;
  title?: string;
  content?: Record<string, unknown>;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string | null;
  /** 1–10. `priority` é derivada disto por trigger no banco. */
  criticality?: number;
  colorTag?: string | null;
  clientId?: string | null;
}): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const { taskId, dueDate, colorTag, clientId, ...rest } = parsed.data;

  if (isDemoMode) {
    const { demoTasks } = await import("@/lib/mock/data");
    const task = demoTasks.find((t) => t.id === taskId);
    if (task) {
      if (rest.title !== undefined) task.title = rest.title;
      if (rest.priority !== undefined) task.priority = rest.priority;
      if (rest.status !== undefined) task.status = rest.status;
      if (rest.content !== undefined) {
        // O Zod validou como objeto genérico; a forma de documento
        // ProseMirror é garantida pelo editor que produziu o payload.
        task.content = rest.content as unknown as typeof task.content;
      }
      if (dueDate !== undefined) task.due_date = prazoParaInstante(dueDate);
      if (rest.criticality !== undefined) task.criticality = rest.criticality;
      if (colorTag !== undefined) task.color_tag = colorTag;
      if (clientId !== undefined) {
        const { demoClients } = await import("@/lib/mock/data");
        const c = demoClients.find((x) => x.id === clientId) ?? null;
        task.client_id = clientId;
        task.client = c
          ? { id: c.id, name: c.name, brand_primary: c.brand_primary }
          : null;
      }
      task.updated_at = new Date().toISOString();
    }
    revalidatePath("/tarefas");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      ...rest,
      ...(dueDate !== undefined
        ? { due_date: prazoParaInstante(dueDate) }
        : {}),
      ...(colorTag !== undefined ? { color_tag: colorTag } : {}),
      ...(clientId !== undefined ? { client_id: clientId } : {}),
    })
    .eq("id", taskId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tarefas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

export async function toggleChecklistItem(
  itemId: string,
  isDone: boolean,
): Promise<ActionResult> {
  if (isDemoMode) {
    const { demoTasks } = await import("@/lib/mock/data");
    for (const task of demoTasks) {
      const item = task.checklist.find((c) => c.id === itemId);
      if (!item) continue;

      item.is_done = isDone;
      // Espelha a trigger `app.sync_task_progress()` do Postgres.
      const total = task.checklist.length;
      const done = task.checklist.filter((c) => c.is_done).length;
      task.progress = total === 0 ? 0 : Math.round((done / total) * 100);
      break;
    }
    revalidatePath("/tarefas");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_checklist_items")
    .update({ is_done: isDone })
    .eq("id", itemId);

  if (error) return { ok: false, error: error.message };

  // O progresso da tarefa NÃO é recalculado aqui: quem faz isso é a
  // trigger no banco. Assim o número fica correto mesmo quando a linha
  // é alterada por um job, pela API ou direto no SQL editor.
  revalidatePath("/tarefas");
  return { ok: true };
}

const addItemSchema = z.object({
  taskId: z.string().min(1),
  content: z.string().trim().min(1).max(500),
});

export async function addChecklistItem(input: {
  taskId: string;
  content: string;
}): Promise<ActionResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Texto inválido." };

  const { taskId, content } = parsed.data;

  if (isDemoMode) {
    const { demoTasks } = await import("@/lib/mock/data");
    const task = demoTasks.find((t) => t.id === taskId);
    if (task) {
      const last = task.checklist.at(-1)?.position ?? 0;
      task.checklist.push({
        id: `${taskId}-c${Date.now()}`,
        task_id: taskId,
        content,
        is_done: false,
        position: last + 1000,
      });
      const total = task.checklist.length;
      const done = task.checklist.filter((c) => c.is_done).length;
      task.progress = Math.round((done / total) * 100);
    }
    revalidatePath("/tarefas");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { data: last } = await supabase
    .from("task_checklist_items")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("task_checklist_items").insert({
    task_id: taskId,
    content,
    position: (last?.position ?? 0) + 1000,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tarefas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Criar tarefa                                                        */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  clientId: z.string().min(1).nullable(),
  status: statusSchema.default("todo"),
  priority: prioritySchema.default("medium"),
});

export async function createTask(input: {
  title: string;
  clientId: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  /* Devolve o id da tarefa criada: a lista abre o popup de edição em
     seguida, e sem o id ela teria que adivinhar qual das linhas é a
     nova — depois de um revalidate que pode reordenar tudo. */
}): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const { title, clientId, status, priority } = parsed.data;

  if (isDemoMode) {
    const { demoTasks, demoClients, demoCurrentUser } = await import(
      "@/lib/mock/data"
    );
    const client = demoClients.find((c) => c.id === clientId) ?? null;

    demoTasks.unshift({
      id: `t-${Date.now()}`,
      client_id: clientId,
      project_id: null,
      title,
      content: { type: "doc", content: [] },
      status,
      priority,
      criticality: 5,
      color_tag: null,
      tracked_seconds: 0,
      timer_started_at: null,
      position: 0,
      due_date: hojeComoInstante(),
      completed_at: null,
      progress: 0,
      created_by: demoCurrentUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // A trigger `app.autoassign_task_creator()` faz o mesmo no banco:
      // sem isto, um colaborador criaria a tarefa e ela sumiria da tela.
      assignees: [demoCurrentUser],
      checklist: [],
      client: client
        ? { id: client.id, name: client.name, brand_primary: client.brand_primary }
        : null,
      project: null,
      comment_count: 0,
    });

    revalidatePath("/tarefas");
    return { ok: true, taskId: demoTasks[0].id };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Sessão expirada." };

  const { data, error } = await supabase.from("tasks").insert({
    title,
    client_id: clientId,
    status,
    priority,
    criticality: 5,
    color_tag: null,
    /* Nasce com prazo de HOJE, não sem prazo.
       A rotina da agência é diária: o que entra no quadro é o que se
       pretende resolver no dia, e obrigar a abrir o modal para carimbar
       a data que já era a óbvia fazia a maioria das tarefas ficar sem
       prazo nenhum — invisíveis no calendário e fora de qualquer
       cobrança. Quem precisa de outro dia empurra a data no modal, que
       é um clique; quem não precisa não faz nada.

       ⚠️ MEIO-DIA DE BRASÍLIA, via `hojeComoInstante`. Gravar
       "2026-08-14" cru aqui devolveria meia-noite UTC = 21h de ontem em
       São Paulo, e a tarefa nasceria marcada "Atrasada 1d". */
    due_date: hojeComoInstante(),
    // A policy `tasks_insert` exige created_by = auth.uid(): o campo não
    // pode ser forjado para atribuir a tarefa a outra pessoa.
    created_by: user.id,
    position: Date.now(),
  })
    .select("id")
    .single();

  if (error) {
    /* 42501 = recusa de policy. A tradução diz o que fazer, mas PRESERVA
       qual tabela recusou: sem isso, o relato vira "não deixa criar" e
       não dá para distinguir a policy de `tasks` da de `task_assignees`
       — que é exatamente a informação que resolve o caso. A frase crua do
       Postgres nomeia a tabela; guardá-la entre parênteses custa nada e
       poupa uma rodada inteira de investigação. */
    if (error.code === "42501") {
      const tabela = /table "([^"]+)"/.exec(error.message)?.[1];
      return {
        ok: false,
        error:
          "Sem permissão para criar tarefa nesta conta. Avise um administrador" +
          (tabela ? ` — a regra que recusou é a da tabela "${tabela}".` : "."),
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/tarefas");
  return { ok: true, taskId: (data as { id: string }).id };
}

/* ------------------------------------------------------------------ */
/* Cronômetro                                                          */
/* ------------------------------------------------------------------ */

/**
 * Liga o cronômetro da tarefa.
 *
 * `timer_started_at` recebe `now()` do BANCO, não do navegador: relógio
 * de máquina adiantado gravaria tempo negativo ao parar. Por isso a
 * escrita usa a expressão do Postgres e não um ISO montado aqui.
 *
 * Ligar duas vezes é inofensivo — o segundo start reposiciona a âncora,
 * e o tempo entre os dois cliques é desprezível comparado ao estrago de
 * um erro na tela por dois cliques rápidos.
 */
export async function startTaskTimer(
  taskId: string,
): Promise<ActionResult> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tasks")
    .update({ timer_started_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tarefas");
  return { ok: true };
}

/**
 * Para o cronômetro e soma o que correu.
 *
 * Delega para a RPC `stop_task_timer`: a soma precisa do relógio do
 * servidor. Feita aqui com `Date.now()`, um relógio atrasado subtrairia
 * tempo já trabalhado do total.
 */
export async function stopTaskTimer(
  taskId: string,
): Promise<ActionResult> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("stop_task_timer", { p_task: taskId });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tarefas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Responsáveis                                                        */
/* ------------------------------------------------------------------ */

/**
 * Põe ou tira uma pessoa da tarefa.
 *
 * A tabela `task_assignees` sempre foi de MUITOS — chave composta
 * `(task_id, profile_id)` —, e a lista já desenhava três avatares e um
 * contador. O que nunca existiu foi o caminho de escrita: dava para ver
 * vários responsáveis e não dava para pôr o segundo.
 *
 * QUEM PODE. A policy `task_assignees_insert` exige `app.is_admin()`, e
 * a de delete permite que um colaborador se remova de uma tarefa que já
 * enxerga. Não há checagem de papel aqui: quem decide é o banco, e o
 * `.select()` transforma a recusa em mensagem em vez de um "salvo" sobre
 * nada.
 *
 * ⚠️ REMOVER A SI MESMO PODE FAZER A TAREFA SUMIR. Para colaborador, a
 * visibilidade vem de estar em `task_assignees` — sair da última tarefa
 * que o inclui a tira da tela dele. É consequência do modelo de acesso,
 * não bug, mas a interface avisa antes.
 */
export async function toggleTaskAssignee(input: {
  taskId: string;
  profileId: string;
  assign: boolean;
}): Promise<ActionResult> {
  const parsed = z
    .object({
      taskId: z.string().min(1),
      profileId: z.string().min(1),
      assign: z.boolean(),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const { taskId, profileId, assign } = parsed.data;

  if (isDemoMode) {
    const { demoTasks, demoProfiles } = await import("@/lib/mock/data");
    const task = demoTasks.find((t) => t.id === taskId);
    const pessoa = demoProfiles.find((p) => p.id === profileId);
    if (task && pessoa) {
      task.assignees = assign
        ? [...task.assignees.filter((p) => p.id !== profileId), pessoa]
        : task.assignees.filter((p) => p.id !== profileId);
    }
    revalidatePath("/tarefas");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* ⚠️ `ignoreDuplicates`, e não o upsert padrão.
     ------------------------------------------------------------------
     O padrão do `upsert` do PostgREST é `ON CONFLICT DO UPDATE`, e isso
     exige privilégio de UPDATE. `task_assignees` tem grant de
     `select, insert, delete` e NENHUMA policy de update — de propósito:
     a tabela é uma ligação de duas chaves, não há o que corrigir numa
     linha existente. O resultado era `permission denied for table
     task_assignees` ao adicionar alguém, medido em 25/08/2026.

     Dar o grant não resolveria sozinho: sem policy de update, a RLS
     recusaria em seguida. E criar a policy seria abrir escrita numa
     tabela que só precisa de "existe" e "não existe".

     `DO NOTHING` diz o que a operação quer: garantir que a pessoa está
     atribuída. */
  const { data, error } = assign
    ? await supabase
        .from("task_assignees")
        .upsert(
          { task_id: taskId, profile_id: profileId },
          { onConflict: "task_id,profile_id", ignoreDuplicates: true },
        )
        .select("task_id")
    : await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", taskId)
        .eq("profile_id", profileId)
        .select("task_id");

  if (error) return { ok: false, error: error.message };

  /* ZERO LINHAS TEM DOIS SIGNIFICADOS ao atribuir, e confundi-los é o
     que faria a tela acusar falta de permissão para quem só clicou duas
     vezes: `DO NOTHING` também devolve vazio quando a pessoa JÁ estava
     na tarefa. Uma consulta separa os casos.

     Na remoção não há ambiguidade: vazio é recusa. */
  if (!data || data.length === 0) {
    if (assign) {
      const { data: jaEsta } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("task_id", taskId)
        .eq("profile_id", profileId)
        .maybeSingle();

      // Já estava atribuída: o pedido foi atendido antes de chegar.
      if (jaEsta) {
        revalidatePath("/tarefas");
        return { ok: true };
      }
    }

    return {
      ok: false,
      error: assign
        ? "Atribuir tarefa a outra pessoa é restrito a administradores."
        : "Você não pode remover esta pessoa da tarefa.",
    };
  }

  revalidatePath("/tarefas");
  return { ok: true };
}
