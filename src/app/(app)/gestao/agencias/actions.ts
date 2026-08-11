"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { parseCurrencyToCents } from "@/lib/format";

/* =====================================================================
   Cadastro de agências
   ---------------------------------------------------------------------
   O que era uma `const` no código virou tabela. Cadastrar uma agência
   nova deixou de exigir deploy.

   ⚠️ O NOME É A CHAVE PRIMÁRIA, e isso governa o que dá para editar.
   `clients.agency_partner` guarda o nome em TEXTO, sem chave estrangeira
   — renomear a agência aqui deixaria os clientes dela apontando para um
   nome que não existe mais, e o seletor os empurraria para outra agência
   no primeiro salvamento. Por isso `renomear` faz as duas escritas na
   ordem certa, e não um simples UPDATE.
   ===================================================================== */

export type AgencyResult = { ok: true } | { ok: false; error: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

const schema = z.object({
  agency: z
    .string()
    .trim()
    .min(2, "Informe o nome da agência.")
    .max(80, "Nome muito longo."),
  monthlyFee: z.string().trim(),
  billingDay: z.string().trim(),
  brandPrimary: z.string().trim(),
  logoUrl: z.string().trim(),
  notes: z.string().trim().max(2000).optional(),
});

async function exigirAdmin(): Promise<AgencyResult | null> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role !== "admin") {
    return { ok: false, error: "Só administrador altera o cadastro de agências." };
  }
  return null;
}

/** Valida e normaliza os campos comuns a criar e editar. */
function normalizar(input: z.infer<typeof schema>):
  | { ok: true; valores: Record<string, unknown> }
  | { ok: false; error: string } {
  const cents = input.monthlyFee === "" ? 0 : parseCurrencyToCents(input.monthlyFee);
  if (cents === null || cents < 0) {
    return { ok: false, error: "Honorário inválido. Use algo como 2.500,00." };
  }

  /* 1 a 28 pelo mesmo motivo das outras datas de cobrança do sistema:
     fevereiro existe, e dia 30 nunca chegaria em fevereiro. */
  const dia = input.billingDay === "" ? null : Number(input.billingDay);
  if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 28)) {
    return { ok: false, error: "Dia de cobrança precisa ser de 1 a 28." };
  }

  if (input.brandPrimary && !HEX.test(input.brandPrimary)) {
    return { ok: false, error: "Cor inválida. Use o formato #1A2B3C." };
  }

  /* SVG é recusado aqui e no banco. O motor padrão de PDF é o react-pdf,
     que não rasteriza vetor — e uma imagem que ele não abre ABORTA o
     documento inteiro, derrubando o relatório do cliente por causa de um
     logo. Barrar na entrada é onde o erro sai barato. */
  if (input.logoUrl) {
    const semQuery = input.logoUrl.split("?")[0].toLowerCase();
    if (!/\.(png|jpe?g|webp)$/.test(semQuery)) {
      return {
        ok: false,
        error: "O logo precisa ser PNG, JPG ou WEBP — SVG quebra a geração do PDF.",
      };
    }
  }

  return {
    ok: true,
    valores: {
      monthly_fee_cents: cents,
      billing_day: dia,
      brand_primary: input.brandPrimary || null,
      logo_url: input.logoUrl || null,
      notes: input.notes?.trim() || null,
    },
  };
}

export async function salvarAgencia(input: {
  agency: string;
  monthlyFee: string;
  billingDay: string;
  brandPrimary: string;
  logoUrl: string;
  notes?: string;
}): Promise<AgencyResult> {
  const barrado = await exigirAdmin();
  if (barrado) return barrado;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const norm = normalizar(parsed.data);
  if (!norm.ok) return norm;

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("agency_contracts")
    .upsert({ agency: parsed.data.agency, ...norm.valores }, { onConflict: "agency" });

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Sem permissão para alterar o cadastro de agências." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/gestao/agencias");
  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Renomeia uma agência, arrastando os clientes junto.
 *
 * DUAS ESCRITAS, nesta ordem: cria a linha nova, move os clientes, apaga
 * a antiga. `clients.agency_partner` é texto sem chave estrangeira —
 * fazer só o UPDATE na tabela de agências deixaria os clientes órfãos,
 * apontando para um nome que sumiu, e o formulário os realocaria para
 * outra agência no primeiro salvamento. Foi exatamente o que o
 * comentário da antiga `const` avisava.
 *
 * Não é transacional: sem RPC, três chamadas do PostgREST não compartilham
 * transação. Por isso a ORDEM é essa — se parar no meio, sobram duas
 * linhas de agência (visível e corrigível) em vez de clientes apontando
 * para o vazio (silencioso).
 */
export async function renomearAgencia(input: {
  de: string;
  para: string;
}): Promise<AgencyResult> {
  const barrado = await exigirAdmin();
  if (barrado) return barrado;

  const de = input.de.trim();
  const para = input.para.trim();

  if (para.length < 2) return { ok: false, error: "Informe o nome novo." };
  if (de === para) return { ok: true };

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { data: atual } = await supabase
    .from("agency_contracts")
    .select("*")
    .eq("agency", de)
    .maybeSingle();

  if (!atual) return { ok: false, error: "Agência não encontrada." };

  const { agency: _ignorado, ...resto } = atual as Record<string, unknown> & {
    agency: string;
  };
  void _ignorado;

  const { error: erroInsert } = await supabase
    .from("agency_contracts")
    .insert({ ...resto, agency: para });

  if (erroInsert) {
    return {
      ok: false,
      error:
        erroInsert.code === "23505"
          ? "Já existe uma agência com esse nome."
          : erroInsert.message,
    };
  }

  const { error: erroClientes } = await supabase
    .from("clients")
    .update({ agency_partner: para })
    .eq("agency_partner", de);

  if (erroClientes) {
    return {
      ok: false,
      error: `A agência nova foi criada, mas os clientes não migraram: ${erroClientes.message}`,
    };
  }

  await supabase.from("agency_contracts").delete().eq("agency", de);

  revalidatePath("/gestao/agencias");
  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Remove uma agência do cadastro.
 *
 * RECUSA SE HOUVER CLIENTE APONTANDO. Apagar a linha deixaria esses
 * clientes com um `agency_partner` que não existe mais — e como a régua
 * de faturamento decide pela agência, eles sairiam da cobrança da
 * parceira sem entrar em lugar nenhum. A mensagem diz quantos são, para
 * a pessoa saber o tamanho do remanejamento antes de decidir.
 */
export async function removerAgencia(agency: string): Promise<AgencyResult> {
  const barrado = await exigirAdmin();
  if (barrado) return barrado;

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("agency_partner", agency);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} cliente${count === 1 ? "" : "s"} ainda aponta${count === 1 ? "" : "m"} para esta agência. Troque a agência deles antes de remover.`,
    };
  }

  const { error } = await supabase
    .from("agency_contracts")
    .delete()
    .eq("agency", agency);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/gestao/agencias");
  revalidatePath("/clientes");
  return { ok: true };
}
