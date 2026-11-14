"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { dataNoBrasil } from "@/lib/date-br";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { segundaDaSemana } from "@/lib/cs/semana";
import { ROTINA } from "@/lib/cs/rotina";

export type Resultado = { ok: true } | { ok: false; error: string };

const COLUNAS = ["relatorio_seg", "mensagem_qua", "mensagem_sex", "reuniao_preparada"] as const;

async function quem() {
  const user = await getCurrentUser();
  if (!user) return { erro: "Sessão expirada. Entre novamente." } as const;
  if (user.role === "client") return { erro: "Sem permissão." } as const;
  return { user } as const;
}

/** Marca/desmarca uma coluna da tabela da semana (relatório, mensagens, reunião preparada). */
export async function marcarNaSemana(input: {
  clientId: string;
  coluna: (typeof COLUNAS)[number];
  valor: boolean;
}): Promise<Resultado> {
  const p = z
    .object({ clientId: z.string().min(1).max(100), coluna: z.enum(COLUNAS), valor: z.boolean() })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Dados inválidos." };
  const q = await quem();
  if ("erro" in q) return { ok: false, error: q.erro as string };

  // A semana é a de HOJE, calculada aqui: a tela pode estar aberta desde sexta.
  const semana = segundaDaSemana(dataNoBrasil(new Date()));

  if (isDemoMode) {
    const { demoCsSemana } = await import("@/lib/mock/data");
    let linha = demoCsSemana.find((m) => m.client_id === p.data.clientId && m.semana === semana);
    if (!linha) {
      linha = {
        client_id: p.data.clientId,
        semana,
        relatorio_seg: false,
        mensagem_qua: false,
        mensagem_sex: false,
        reuniao_preparada: false,
      };
      demoCsSemana.push(linha);
    }
    linha[p.data.coluna] = p.data.valor;
    revalidatePath("/cs");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("cs_semana").upsert(
    {
      client_id: p.data.clientId,
      semana,
      [p.data.coluna]: p.data.valor,
      updated_by: q.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,semana" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/cs");
  return { ok: true };
}

/** Marca/desmarca um item manual da rotina da semana de quem está logado. */
export async function marcarRotina(input: { item: string; feito: boolean }): Promise<Resultado> {
  const p = z
    .object({ item: z.string().refine((i) => ROTINA.some((r) => r.id === i && !r.auto)), feito: z.boolean() })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Item inválido." };
  const q = await quem();
  if ("erro" in q) return { ok: false, error: q.erro as string };

  const semana = segundaDaSemana(dataNoBrasil(new Date()));

  if (isDemoMode) {
    const { demoCsRotina } = await import("@/lib/mock/data");
    const i = demoCsRotina.findIndex(
      (r) => r.profile_id === q.user.id && r.semana === semana && r.item === p.data.item,
    );
    if (p.data.feito && i < 0) demoCsRotina.push({ profile_id: q.user.id, semana, item: p.data.item });
    if (!p.data.feito && i >= 0) demoCsRotina.splice(i, 1);
    revalidatePath("/cs");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = p.data.feito
    ? await supabase
        .from("cs_rotina")
        .upsert({ profile_id: q.user.id, semana, item: p.data.item }, { onConflict: "profile_id,semana,item" })
    : await supabase
        .from("cs_rotina")
        .delete()
        .eq("profile_id", q.user.id)
        .eq("semana", semana)
        .eq("item", p.data.item);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/cs");
  return { ok: true };
}
