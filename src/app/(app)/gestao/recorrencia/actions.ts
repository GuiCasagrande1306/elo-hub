"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

import { materializarMes, isMesValido } from "@/lib/finance/recurrence";
import type { ResultadoMaterializacao } from "@/lib/finance/recurrence";

/* =====================================================================
   Recorrência — contratos e despesas fixas
   ---------------------------------------------------------------------
   Como nas ações de baixa, quem barra colaborador é a policy
   `app.is_admin()` no banco: uma segunda checagem de papel aqui criaria
   duas fontes de verdade sobre permissão, e a que fica desatualizada é
   sempre a da aplicação.

   A EXCEÇÃO é `gerarLancamentosDoMes`, que roda com `service_role` e
   portanto ATRAVESSA o RLS. Ali a checagem é obrigatória — sem ela,
   qualquer sessão autenticada emitiria as cobranças do mês.
   ===================================================================== */

export type Resultado<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

function erroDeBanco(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "Apenas administradores podem alterar o financeiro.";
  }
  return error.message;
}

/* ------------------------------------------------------------------ */
/* Contrato do cliente: honorário + dia de vencimento                  */
/* ------------------------------------------------------------------ */

const contratoSchema = z.object({
  clientId: z.string().uuid(),
  /* Centavos já convertidos no cliente por `parseCurrencyToCents`. Zero
     é permitido e significa "sem honorário" — o job pula. */
  monthlyFeeCents: z.number().int().min(0).max(100_000_000),
  /* `null` = contrato sem cobrança recorrente. 28 é o teto pelo mesmo
     motivo do banco: fevereiro. */
  billingDay: z.number().int().min(1).max(28).nullable(),
});

export async function salvarContrato(input: {
  clientId: string;
  monthlyFeeCents: number;
  billingDay: number | null;
}): Promise<Resultado> {
  const parsed = contratoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valor ou dia de cobrança inválido." };
  }

  const { clientId, monthlyFeeCents, billingDay } = parsed.data;

  if (isDemoMode) {
    const { demoClientFinancials } = await import("@/lib/mock/data");
    const atual = demoClientFinancials.find((f) => f.client_id === clientId);
    if (atual) {
      atual.monthly_fee_cents = monthlyFeeCents;
      atual.billing_day = billingDay;
    } else {
      demoClientFinancials.push({
        client_id: clientId,
        monthly_fee_cents: monthlyFeeCents,
        tax_id: null,
        billing_day: billingDay,
      });
    }
    revalidatePath("/gestao/recorrencia");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `upsert` porque nem todo cliente tem linha em `client_financials` —
     a tabela nasceu depois da carteira, e quem foi cadastrado antes
     entrou sem contrato. Um `update` puro afetaria zero linhas e
     devolveria sucesso silencioso. */
  const { error } = await supabase.from("client_financials").upsert(
    {
      client_id: clientId,
      monthly_fee_cents: monthlyFeeCents,
      billing_day: billingDay,
    },
    { onConflict: "client_id" },
  );

  if (error) return { ok: false, error: erroDeBanco(error) };

  revalidatePath("/gestao/recorrencia");
  revalidatePath("/gestao");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Contrato da agência: um valor que cobre todos os clientes dela       */
/* ------------------------------------------------------------------ */

const contratoAgenciaSchema = z.object({
  /* Nome e não uuid: é assim que a agência é chaveada em
     `agency_contracts` e em `clients.agency_partner`. O `enum` recusa
     nome fora da lista, que é o que impede um contrato órfão — uma
     linha "Bagno" nunca casaria com os clientes de "Bagano" e o mês
     sairia sem a cobrança dos 11. */
  /* Texto pelo mesmo motivo do formulário de cliente: a lista virou
     cadastro, e um enum compilado recusaria agência criada depois do
     deploy. */
  agency: z.string().trim().min(1),
  monthlyFeeCents: z.number().int().min(0).max(100_000_000),
  billingDay: z.number().int().min(1).max(28).nullable(),
});

export async function salvarContratoDeAgencia(input: {
  agency: string;
  monthlyFeeCents: number;
  billingDay: number | null;
}): Promise<Resultado> {
  const parsed = contratoAgenciaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Agência, valor ou dia de cobrança inválido." };
  }

  const { agency, monthlyFeeCents, billingDay } = parsed.data;

  /* A agência PRÓPRIA não cobra de si mesma. Quem é a própria vem do
     cadastro (`is_own`), não de um nome fixo: com a tela de Agências,
     renomear a conta da casa faria a comparação por literal parar de
     bater e liberaria um contrato que não deveria existir.

     A checagem é no banco porque esta ação é pública para qualquer
     sessão de admin — o formulário nem oferece essa linha. */
  if (!isDemoMode) {
    const checagem = await createSupabaseServerClient();
    const { data: propria } = await checagem
      .from("agency_contracts")
      .select("agency")
      .eq("is_own", true)
      .maybeSingle();

    if (propria?.agency === agency) {
      return {
        ok: false,
        error:
          "Cliente da agência própria é cobrado direto, não por contrato de agência.",
      };
    }
  }

  if (isDemoMode) {
    const { demoAgencyContracts } = await import("@/lib/mock/data");
    const atual = demoAgencyContracts.find((a) => a.agency === agency);
    if (atual) {
      atual.monthly_fee_cents = monthlyFeeCents;
      atual.billing_day = billingDay;
    } else {
      demoAgencyContracts.push({
        agency,
        monthly_fee_cents: monthlyFeeCents,
        billing_day: billingDay,
        notes: null,
      });
    }
    revalidatePath("/gestao/recorrencia");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `upsert` pela mesma razão de `salvarContrato`: a migration semeia só
     as agências que já tinham cliente na carteira, e parceria nova chega
     sem linha. */
  const { error } = await supabase.from("agency_contracts").upsert(
    {
      agency,
      monthly_fee_cents: monthlyFeeCents,
      billing_day: billingDay,
    },
    { onConflict: "agency" },
  );

  if (error) return { ok: false, error: erroDeBanco(error) };

  revalidatePath("/gestao/recorrencia");
  revalidatePath("/gestao");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Despesas recorrentes                                                */
/* ------------------------------------------------------------------ */

const CATEGORIAS_DESPESA = [
  "salary",
  "contractor",
  "software",
  "office",
  "tax",
  "ad_spend",
  "other",
] as const;

const despesaSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(2).max(120),
  category: z.enum(CATEGORIAS_DESPESA),
  amountCents: z.number().int().positive().max(100_000_000),
  billingDay: z.number().int().min(1).max(28),
});

export async function salvarDespesa(input: {
  id?: string;
  description: string;
  category: string;
  amountCents: number;
  billingDay: number;
}): Promise<Resultado> {
  const parsed = despesaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const { id, description, category, amountCents, billingDay } = parsed.data;

  if (isDemoMode) {
    const { demoRecurringExpenses } = await import("@/lib/mock/finance");
    const alvo = id ? demoRecurringExpenses.find((d) => d.id === id) : null;
    if (alvo) {
      Object.assign(alvo, {
        description,
        category,
        amount_cents: amountCents,
        billing_day: billingDay,
      });
    } else {
      demoRecurringExpenses.unshift({
        id: `re-${Date.now()}`,
        description,
        category,
        amount_cents: amountCents,
        billing_day: billingDay,
        is_active: true,
        created_at: new Date().toISOString().slice(0, 10),
      });
    }
    revalidatePath("/gestao/recorrencia");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const linha = {
    description,
    category,
    amount_cents: amountCents,
    billing_day: billingDay,
  };

  const { error } = id
    ? await supabase.from("recurring_expenses").update(linha).eq("id", id)
    : await supabase.from("recurring_expenses").insert(linha);

  if (error) return { ok: false, error: erroDeBanco(error) };

  revalidatePath("/gestao/recorrencia");
  return { ok: true };
}

/**
 * Liga e desliga a despesa.
 *
 * NÃO existe exclusão nesta tela, e é deliberado: apagar a assinatura
 * cancelada faria os meses já materializados perderem a referência do
 * que os originou. Desligar tira do próximo mês e preserva o passado.
 */
export async function alternarDespesa(
  id: string,
  ativa: boolean,
): Promise<Resultado> {
  if (isDemoMode) {
    const { demoRecurringExpenses } = await import("@/lib/mock/finance");
    const alvo = demoRecurringExpenses.find((d) => d.id === id);
    if (alvo) alvo.is_active = ativa;
    revalidatePath("/gestao/recorrencia");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ is_active: ativa })
    .eq("id", id);

  if (error) return { ok: false, error: erroDeBanco(error) };

  revalidatePath("/gestao/recorrencia");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Materialização manual                                               */
/* ------------------------------------------------------------------ */

/**
 * Emite os lançamentos previstos de um mês, sob demanda.
 *
 * O cron já faz isso todo dia; este botão existe para o primeiro mês (o
 * cron só roda amanhã) e para adiantar o mês seguinte quando alguém
 * quer ver a previsão antes de virar.
 *
 * CHECAGEM DE PAPEL OBRIGATÓRIA aqui: diferente das ações acima, esta
 * chama `materializarMes`, que usa `service_role` e ignora RLS. Sem o
 * `role !== "admin"` abaixo, qualquer colaborador logado emitiria as
 * cobranças da agência.
 */
export async function gerarLancamentosDoMes(
  mes: string,
): Promise<Resultado<ResultadoMaterializacao>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores podem gerar lançamentos." };
  }

  if (!isMesValido(mes)) return { ok: false, error: "Mês inválido." };

  if (isDemoMode) {
    return {
      ok: false,
      error: "Indisponível no modo demonstração: não há banco para gravar.",
    };
  }

  try {
    const dados = await materializarMes(mes);
    revalidatePath("/gestao/recorrencia");
    revalidatePath("/gestao");
    return { ok: true, dados };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao gerar.",
    };
  }
}
