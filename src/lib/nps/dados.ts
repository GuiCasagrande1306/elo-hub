import "server-only";

import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DIMENSOES, trimestreDe, type RespostaNps } from "./regras";

/* O token tem 64 hex (migration 97). Validar o formato antes de ir ao
   banco evita consulta com lixo vindo da URL. */
const TOKEN = /^[0-9a-f]{64}$/;

/* QUEM RESPONDE É QUEM PAGA (16/11/2026). Cliente direto responde pela
   conta dele; cliente de agência parceira NÃO responde — quem paga a Elo
   é a agência, e ela tem link próprio (`agency_contracts.nps_token`,
   migration 108). */
export interface ClienteDaPesquisa {
  tipo: "cliente" | "agencia";
  /** `clients.id`, ou o nome da agência quando `tipo = "agencia"`. */
  id: string;
  nome: string;
  /** Agência avaliada — sempre a própria (Elo). */
  agencia: string;
}

/** Nome da agência da casa (`is_own`). */
async function agenciaPropria(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<string> {
  const { data } = await admin.from("agency_contracts").select("agency").eq("is_own", true).maybeSingle();
  return data?.agency ?? "Elo Marketing";
}

export async function clienteDaPesquisa(token: string): Promise<ClienteDaPesquisa | null> {
  if (!TOKEN.test(token)) return null;
  if (isDemoMode) return { tipo: "cliente", id: "demo", nome: "Cliente de demonstração", agencia: "Elo Marketing" };

  const admin = createSupabaseAdminClient();
  const [propria, cliente, agencia] = await Promise.all([
    agenciaPropria(admin),
    admin.from("clients").select("id, name, agency_partner").eq("nps_token", token).maybeSingle(),
    admin.from("agency_contracts").select("agency, is_own").eq("nps_token", token).maybeSingle(),
  ]);

  if (cliente.error || agencia.error) {
    console.error("[nps] erro ao buscar o link:", (cliente.error ?? agencia.error)?.message);
    return null;
  }

  if (cliente.data) {
    const parceira = cliente.data.agency_partner?.trim();
    // Cliente de parceira: o link antigo deixa de valer — quem responde é a agência.
    if (parceira && parceira !== propria) return null;
    return { tipo: "cliente", id: cliente.data.id, nome: cliente.data.name, agencia: propria };
  }
  if (agencia.data && !agencia.data.is_own) {
    return { tipo: "agencia", id: agencia.data.agency, nome: agencia.data.agency, agencia: propria };
  }
  return null;
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
    .insert({
      ...resposta,
      client_id: cliente.tipo === "cliente" ? cliente.id : null,
      agency: cliente.tipo === "agencia" ? cliente.id : null,
      trimestre: trimestreDe(),
    });

  if (error) {
    console.error("[nps] erro ao gravar resposta:", error.message);
    return { ok: false, motivo: "Não foi possível enviar agora. Tente de novo em instantes." };
  }
  return { ok: true };
}

export interface ClienteDoNps {
  /** `clients.id`, ou `agencia:<nome>` para agência parceira. */
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
    "id", "client_id", "agency", "trimestre", "score", "motivo", "continuidade",
    "melhoria", "respondente", "submitted_at", ...DIMENSOES.map((d) => d.chave),
  ].join(", ");

  const [respostas, clientes, agencias] = await Promise.all([
    supabase.from("nps_responses").select(colunas).order("submitted_at", { ascending: false }),
    supabase.from("clients").select("id, name, status, nps_token, agency_partner").order("name"),
    supabase.from("agency_contracts").select("agency, is_own, nps_token").order("agency"),
  ]);

  if (respostas.error) throw new Error(`NPS: ${respostas.error.message}`);
  if (clientes.error) throw new Error(`Clientes: ${clientes.error.message}`);
  if (agencias.error) throw new Error(`Agências: ${agencias.error.message}`);

  const propria = agencias.data?.find((a) => a.is_own)?.agency ?? "Elo Marketing";
  const idDaAgencia = (nome: string) => `agencia:${nome}`;

  // A agência entra na lista com um id próprio; o painel não precisa saber a diferença.
  const lista: ClienteDoNps[] = [
    ...(clientes.data ?? [])
      .filter((c) => !c.agency_partner?.trim() || c.agency_partner.trim() === propria)
      .map((c) => ({ id: c.id, nome: c.name, status: c.status, token: c.nps_token ?? null })),
    ...(agencias.data ?? [])
      .filter((a) => !a.is_own)
      .map((a) => ({ id: idDaAgencia(a.agency), nome: `${a.agency} (agência parceira)`, status: "active", token: a.nps_token ?? null })),
  ].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    respostas: ((respostas.data ?? []) as unknown as (RespostaNps & { agency: string | null })[]).map((r) =>
      r.agency ? { ...r, client_id: idDaAgencia(r.agency) } : r,
    ),
    clientes: lista,
  };
}
