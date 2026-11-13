"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import {
  checklistDoCliente,
  progresso,
  type ItemDoOnboarding,
} from "@/lib/onboarding/checklist";
import type { Client } from "@/types/database";

export type Resultado = { ok: true } | { ok: false; error: string };

/* =====================================================================
   Checklist de onboarding
   ---------------------------------------------------------------------
   Toda escrita passa por `alterar`: lê a lista atual DO BANCO, aplica a
   mudança de um item e grava a lista inteira. Ler do banco, e não
   confiar na lista que a tela tem, é o que impede um clique de apagar o
   que outra pessoa marcou minutos antes com a tela aberta.

   shortcut: dois cliques no MESMO segundo em itens diferentes ainda
   podem se sobrescrever (ler-alterar-gravar sem trava). Se virar
   problema, mover para uma tabela com uma linha por item.

   Permissão é a do RLS de `clients` (update para quem enxerga a conta).
   O `.select("id")` depois do update distingue "recusado" de "salvo":
   sem ele, os dois voltam sem erro e com zero linhas.
   ===================================================================== */

async function alterar(
  clientId: string,
  mudar: (itens: ItemDoOnboarding[], autor: string) => ItemDoOnboarding[] | string,
): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role === "client") return { ok: false, error: "Sem permissão." };

  const autor = user.full_name ?? "Alguém";

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const c = demoClients.find((x) => x.id === clientId);
    if (!c) return { ok: false, error: "Cliente não encontrado." };
    const novo = mudar(checklistDoCliente(c), autor);
    if (typeof novo === "string") return { ok: false, error: novo };
    c.onboarding_checklist = novo;
    revalidatePath("/onboarding");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("clients")
    .select("onboarding_checklist")
    .eq("id", clientId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: erroLeitura.message };
  if (!atual) return { ok: false, error: "Cliente não encontrado ou sem permissão." };

  const novo = mudar(checklistDoCliente(atual as Pick<Client, "onboarding_checklist">), autor);
  if (typeof novo === "string") return { ok: false, error: novo };

  const { data, error } = await supabase
    .from("clients")
    .update({ onboarding_checklist: novo })
    .eq("id", clientId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Sem permissão para editar este cliente." };

  revalidatePath("/onboarding");
  return { ok: true };
}

const id = z.string().min(1);

export async function marcarItem(input: {
  clientId: string;
  itemId: string;
  feito: boolean;
}): Promise<Resultado> {
  const p = z.object({ clientId: id, itemId: id, feito: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dados inválidos." };

  return alterar(p.data.clientId, (itens, autor) => {
    if (!itens.some((i) => i.id === p.data.itemId)) return "Item não encontrado.";
    return itens.map((i) =>
      i.id !== p.data.itemId
        ? i
        : p.data.feito
          ? { ...i, done: true, done_at: new Date().toISOString(), done_by: autor }
          : { ...i, done: false, done_at: null, done_by: null },
    );
  });
}

export async function adicionarItem(input: {
  clientId: string;
  label: string;
}): Promise<Resultado> {
  const p = z
    .object({
      clientId: id,
      label: z.string().trim().min(2, "Descreva o item.").max(120, "Máximo de 120 caracteres."),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dados inválidos." };

  return alterar(p.data.clientId, (itens) => [
    ...itens,
    {
      id: crypto.randomUUID(),
      label: p.data.label,
      done: false,
      done_at: null,
      done_by: null,
    },
  ]);
}

export async function removerItem(input: {
  clientId: string;
  itemId: string;
}): Promise<Resultado> {
  const p = z.object({ clientId: id, itemId: id }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dados inválidos." };

  return alterar(p.data.clientId, (itens) => {
    const resto = itens.filter((i) => i.id !== p.data.itemId);
    // Lista vazia faria o progresso travar em 0% sem nada para marcar.
    return resto.length === 0 ? "O checklist precisa de pelo menos um item." : resto;
  });
}

/**
 * Manda o cliente para a página Clientes: status `onboarding` → `active`.
 *
 * O 100% é conferido AQUI, no banco, e não só pelo botão aparecer: a
 * tela pode estar velha, e conta ativa entra no sync e nos relatórios.
 */
export async function concluirOnboarding(input: { clientId: string }): Promise<Resultado> {
  const p = z.object({ clientId: id }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role === "client") return { ok: false, error: "Sem permissão." };

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const c = demoClients.find((x) => x.id === p.data.clientId);
    if (!c) return { ok: false, error: "Cliente não encontrado." };
    if (progresso(checklistDoCliente(c)) < 100) return { ok: false, error: "Ainda há itens pendentes." };
    c.status = "active";
    revalidatePath("/onboarding");
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("clients")
    .select("status, onboarding_checklist")
    .eq("id", p.data.clientId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: erroLeitura.message };
  if (!atual) return { ok: false, error: "Cliente não encontrado ou sem permissão." };
  if (atual.status !== "onboarding") return { ok: false, error: "Este cliente já saiu do onboarding." };
  if (progresso(checklistDoCliente(atual as Pick<Client, "onboarding_checklist">)) < 100) {
    return { ok: false, error: "Ainda há itens pendentes." };
  }

  const { data, error } = await supabase
    .from("clients")
    .update({ status: "active" })
    .eq("id", p.data.clientId)
    .eq("status", "onboarding")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Sem permissão para editar este cliente." };

  revalidatePath("/onboarding");
  revalidatePath("/clientes");
  return { ok: true };
}
