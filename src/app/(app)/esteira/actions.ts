"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import {
  atividadesDaConta,
  type DiaDeAtividade,
} from "@/lib/ads/meta-activities";

const schema = z.object({
  clientId: z.string().min(1),
  notes: z
    .string()
    .trim()
    .min(3, "Descreva o que foi otimizado.")
    .max(4000, "Máximo de 4000 caracteres."),
  reportSent: z.boolean(),
  /* Projeção em texto porque vem de um input: "87,5" precisa virar
     87.5, e deixar o número entrar direto obrigaria o formulário a
     lidar com a vírgula do teclado brasileiro. */
  goalProjection: z.string().trim(),
  /* O DIA A QUE A OBSERVAÇÃO PERTENCE. Opcional: quando não vem, o
     banco carimba hoje no fuso de São Paulo (migration 66). Vem
     preenchido quando a pessoa escreve, hoje, a observação de ontem —
     o bloco de cada dia na esteira permite isso. */
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional(),
});

export type RegisterResult = { ok: true } | { ok: false; error: string };

/**
 * Registra uma rodada da esteira.
 *
 * O autor vem da SESSÃO, não do formulário — a policy de insert exige
 * `collaborator_id = auth.uid()`, então mandar outro id seria recusado
 * pelo banco de qualquer forma. Resolver aqui dá erro legível.
 *
 * A EDIÇÃO existe, mas fica carimbada — ver `atualizarOtimizacao`. O
 * histórico continua servindo de prova porque a correção se identifica
 * como correção, em vez de passar por original.
 */
export async function registerOptimization(input: {
  clientId: string;
  notes: string;
  reportSent: boolean;
  goalProjection: string;
  dia?: string;
}): Promise<RegisterResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const bruto = parsed.data.goalProjection.replace(",", ".");
  const projecao = bruto === "" ? null : Number(bruto);

  if (projecao !== null && (!Number.isFinite(projecao) || projecao < 0)) {
    return { ok: false, error: "A projeção precisa ser um número positivo." };
  }

  /* A coluna é `numeric(6,2)`: acima de 9999,99 o banco recusa com
     "numeric field overflow", que chegaria cru na tela. Passar de 1000%
     é dedo errado, não leitura — o aviso diz isso. */
  if (projecao !== null && projecao > 1000) {
    return { ok: false, error: "Projeção acima de 1000%. Confira o valor." };
  }

  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    demoOptimizations.unshift({
      id: `op-${Date.now()}`,
      client_id: parsed.data.clientId,
      collaborator_id: user.id,
      notes: parsed.data.notes,
      report_sent: parsed.data.reportSent,
      goal_projection: projecao,
      created_at: new Date().toISOString(),
      dia: parsed.data.dia ?? dataNoBrasil(),
      collaborator: { id: user.id, full_name: user.full_name },
    });
    revalidatePath("/esteira");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("optimization_history").insert({
    client_id: parsed.data.clientId,
    collaborator_id: user.id,
    notes: parsed.data.notes,
    report_sent: parsed.data.reportSent,
    goal_projection: projecao,
    /* Ausente = o default do banco (hoje, em São Paulo). Mandar
       `undefined` explicitamente é o mesmo que não mandar. */
    ...(parsed.data.dia ? { dia: parsed.data.dia } : {}),
  });

  if (error) {
    // 42501 = violação de policy: a pessoa não atende esta conta.
    if (error.code === "42501") {
      return {
        ok: false,
        error: "Você não tem acesso a esta conta para registrar otimização.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/esteira");
  return { ok: true };
}


/* ------------------------------------------------------------------ */

const schemaEdicao = schema.omit({ clientId: true }).extend({
  entryId: z.string().min(1),
});

/**
 * Corrige uma rodada já registrada.
 *
 * QUEM PODE: o autor e o admin — e quem decide é a POLICY, não este
 * código. Repetir a regra aqui criaria dois lugares para ela divergir;
 * o que fazemos é traduzir a recusa do banco (42501) numa frase legível
 * em vez de deixar vazar "new row violates row-level security policy".
 *
 * O QUE NÃO DÁ PARA MUDAR: conta, autoria e data de criação. O trigger
 * `stamp_optimization_edit` devolve os três aos valores originais mesmo
 * que cheguem no payload — mover uma otimização de cliente ou reatribuir
 * autoria seria reescrever a história, não corrigir o texto dela.
 *
 * `edited_at`/`edited_by` também vêm do trigger, pelo mesmo motivo pelo
 * qual o insert não aceita `collaborator_id` do formulário.
 */
export async function atualizarOtimizacao(input: {
  entryId: string;
  notes: string;
  reportSent: boolean;
  goalProjection: string;
}): Promise<RegisterResult> {
  const parsed = schemaEdicao.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const bruto = parsed.data.goalProjection.replace(",", ".");
  const projecao = bruto === "" ? null : Number(bruto);

  if (projecao !== null && (!Number.isFinite(projecao) || projecao < 0)) {
    return { ok: false, error: "A projeção precisa ser um número positivo." };
  }

  /* Mesmo teto do registro: a coluna é `numeric(6,2)` e acima de
     9999,99 o banco recusa com "numeric field overflow". */
  if (projecao !== null && projecao > 1000) {
    return { ok: false, error: "Projeção acima de 1000%. Confira o valor." };
  }

  if (isDemoMode) {
    const { demoOptimizations } = await import("@/lib/mock/data");
    const alvo = demoOptimizations.find((o) => o.id === parsed.data.entryId);
    if (!alvo) return { ok: false, error: "Registro não encontrado." };

    /* A demo espelha a policy: sem isto, a tela de demonstração deixaria
       editar o que a produção recusa, e o botão pareceria quebrado só
       para quem usa de verdade. */
    if (alvo.collaborator_id !== user.id && user.role !== "admin") {
      return { ok: false, error: "Só o autor ou um administrador edita." };
    }

    alvo.notes = parsed.data.notes;
    alvo.report_sent = parsed.data.reportSent;
    alvo.goal_projection = projecao;
    alvo.edited_at = new Date().toISOString();
    alvo.edited_by = user.id;
    revalidatePath("/esteira");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `select` depois do update para distinguir "recusado pela policy" de
     "id não existe": sem ele, os dois casos voltam com zero linhas
     afetadas e nenhum erro, e a tela diria "salvo" sem ter salvado. */
  const { data, error } = await supabase
    .from("optimization_history")
    .update({
      notes: parsed.data.notes,
      report_sent: parsed.data.reportSent,
      goal_projection: projecao,
    })
    .eq("id", parsed.data.entryId)
    .select("id");

  if (error) {
    if (error.code === "42501") {
      return {
        ok: false,
        error: "Só o autor da otimização ou um administrador pode editá-la.",
      };
    }
    return { ok: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Não foi possível editar: o registro não existe ou não é seu.",
    };
  }

  revalidatePath("/esteira");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* O que a Meta registrou na conta                                     */
/* ------------------------------------------------------------------ */

/**
 * O histórico de alterações da conta de anúncios, por dia.
 *
 * SERVICE_ROLE COM CHECAGEM À MÃO, e a ordem importa: primeiro a
 * consulta pela SESSÃO, que é quem decide se esta pessoa enxerga esta
 * conta; só depois o `service_role`, e só para alcançar
 * `integration_secrets`, que tem RLS ligada e zero policies de
 * propósito — nenhuma sessão chega no token.
 *
 * Conta sem Meta vinculada não é erro: é o estado de boa parte da
 * carteira. Devolve a lista vazia com o motivo, e a tela diz isso em
 * vez de mostrar uma falha.
 */
export async function atividadesDoCliente(
  clientId: string,
  desdeDias = 30,
): Promise<
  | { ok: true; dias: DiaDeAtividade[] }
  | { ok: false; error: string; semConta?: boolean }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();
  const { data: visivel } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (!visivel) return { ok: false, error: "Cliente não encontrado." };

  const admin = createSupabaseAdminClient();
  const { data: integracao } = await admin
    .from("client_integrations")
    .select("external_account_id, integration_secrets(access_token)")
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .maybeSingle();

  const conta = integracao?.external_account_id as string | undefined;
  const token = (
    integracao as { integration_secrets?: { access_token?: string } } | null
  )?.integration_secrets?.access_token;

  if (!conta || !token) {
    return {
      ok: false,
      semConta: true,
      error: "Esta conta ainda não tem Meta Ads vinculado.",
    };
  }

  return atividadesDaConta(conta, token, desdeDias);
}
