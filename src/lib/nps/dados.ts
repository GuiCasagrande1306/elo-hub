import "server-only";

import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DIMENSOES, trimestreDe, type RespostaNps } from "./regras";

/* O token tem 64 hex (migration 97). Validar o formato antes de ir ao
   banco evita consulta com lixo vindo da URL. */
const TOKEN = /^[0-9a-f]{64}$/;

export interface ClienteDaPesquisa {
  id: string;
  nome: string;
  agencia: string;
}

/** Agência que o cliente enxerga: a parceira quando houver, senão a Elo. */
function nomeDaAgencia(parceira: string | null): string {
  return parceira?.trim() || "Elo Marketing";
}

export async function clienteDaPesquisa(token: string): Promise<ClienteDaPesquisa | null> {
  if (!TOKEN.test(token)) return null;
  if (isDemoMode) return { id: "demo", nome: "Cliente de demonstração", agencia: "Elo Marketing" };

  const { data, error } = await createSupabaseAdminClient()
    .from("clients")
    .select("id, name, agency_partner")
    .eq("nps_token", token)
    .maybeSingle();

  if (error) {
    console.error("[nps] erro ao buscar cliente:", error.message);
    return null;
  }
  if (!data) return null;
  return { id: data.id, nome: data.name, agencia: nomeDaAgencia(data.agency_partner) };
}

const nota = z.number().int().min(1).max(5).nullable();
const texto = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((v) => (v ? v : null));

export const respostaSchema = z.object({
  token: z.string(),
  score: z.number().int().min(0).max(10),
  motivo: texto,
  nota_resultados: nota,
  nota_comunicacao: nota,
  nota_conteudo: nota,
  nota_relatorios: nota,
  nota_estrategia: nota,
  continuidade: z.enum(["sim", "talvez", "nao"]).nullable(),
  melhoria: texto,
  respondente: z.string().trim().max(200).nullable().transform((v) => (v ? v : null)),
});

export async function gravarResposta(
  entrada: unknown,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const parsed = respostaSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, motivo: "Resposta incompleta. Confira a nota de 0 a 10." };

  const { token, ...resposta } = parsed.data;
  const cliente = await clienteDaPesquisa(token);
  if (!cliente) return { ok: false, motivo: "Este link de pesquisa não é válido." };
  if (isDemoMode) return { ok: true };

  const { error } = await createSupabaseAdminClient()
    .from("nps_responses")
    .insert({ ...resposta, client_id: cliente.id, trimestre: trimestreDe() });

  if (error) {
    console.error("[nps] erro ao gravar resposta:", error.message);
    return { ok: false, motivo: "Não foi possível enviar agora. Tente de novo em instantes." };
  }
  return { ok: true };
}

export interface ClienteDoNps {
  id: string;
  nome: string;
  status: string;
  token: string | null;
}

/** Leitura do painel: pela sessão, então a policy só deixa admin ver. */
export async function dadosDoPainelNps(): Promise<{
  respostas: RespostaNps[];
  clientes: ClienteDoNps[];
}> {
  if (isDemoMode) return { respostas: [], clientes: [] };

  const supabase = await createSupabaseServerClient();
  const colunas = [
    "id", "client_id", "trimestre", "score", "motivo", "continuidade",
    "melhoria", "respondente", "submitted_at", ...DIMENSOES.map((d) => d.chave),
  ].join(", ");

  const [respostas, clientes] = await Promise.all([
    supabase.from("nps_responses").select(colunas).order("submitted_at", { ascending: false }),
    supabase.from("clients").select("id, name, status, nps_token").order("name"),
  ]);

  if (respostas.error) throw new Error(`NPS: ${respostas.error.message}`);
  if (clientes.error) throw new Error(`Clientes: ${clientes.error.message}`);

  return {
    respostas: (respostas.data ?? []) as unknown as RespostaNps[],
    clientes: (clientes.data ?? []).map((c) => ({
      id: c.id,
      nome: c.name,
      status: c.status,
      token: c.nps_token ?? null,
    })),
  };
}
