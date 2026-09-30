"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import { problemasDoFluxo, podePublicar } from "@/lib/elochat/validacao";

/* =====================================================================
   Server Actions do EloChat
   ---------------------------------------------------------------------
   Nenhuma checa permissão à mão: todas usam a chave ANON com o JWT de
   quem está logado, então quem decide é a policy `elochat_flows_write`
   — que exige admin. A mesma regra vale se alguém chamar a action por
   fora da interface.

   ⚠️ SALVAR NÃO É PUBLICAR, E PUBLICAR NÃO É DISPARAR. Três estados
   diferentes, e confundi-los é como alguém acha que a automação está
   rodando quando não está:

     salvar    grava o rascunho. Nada acontece no Instagram.
     publicar  marca o fluxo como o válido daquele cliente e valida o
               grafo. CONTINUA sem disparar — o motor não existe.
     disparar  não existe ainda.

   A tela diz isso em texto. Está repetido aqui porque quem lê este
   arquivo pode não ter lido aquela.
   ===================================================================== */

export type ResultadoDoFluxo =
  | { ok: true; flowId: string }
  | { ok: false; error: string };

/* Tetos de tamanho. Server Action é endpoint HTTP público: sem limite,
   um payload de dez megabytes de JSONB entra no banco de um cliente.
   Duzentos nós é muito mais do que qualquer fluxo real de direct. */
const MAX_NOS = 200;
const MAX_ARESTAS = 400;

const noSchema = z.object({
  id: z.string().min(1).max(80),
  position: z.object({ x: z.number(), y: z.number() }),
  type: z.string().max(40).optional(),
  data: z
    .object({
      blockId: z.string().min(1).max(40),
      titulo: z.string().max(120).optional(),
      texto: z.string().max(4000).optional(),
      botoes: z
        .array(z.object({ id: z.string().max(80), label: z.string().max(80) }))
        .max(3)
        .optional(),
      cartoes: z
        .array(
          z.object({
            id: z.string().max(80),
            titulo: z.string().max(120),
            subtitulo: z.string().max(200).optional(),
            botao: z.string().max(80),
          }),
        )
        .max(10)
        .optional(),
    })
    .passthrough(),
});

const arestaSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(80),
  target: z.string().min(1).max(80),
  sourceHandle: z.string().max(80).nullable().optional(),
  targetHandle: z.string().max(80).nullable().optional(),
});

const salvarSchema = z.object({
  /* ⚠️ NÃO É `.uuid()`, e a razão é o modo demonstração: os clientes de
     `mock/data.ts` têm id "c-verdi", não UUID, e a validação estrita
     recusava toda gravação ali com "Escolha um cliente" — mensagem que
     mandava procurar um seletor que já estava preenchido.

     Nada se perde: em produção a coluna é `uuid` com chave estrangeira
     para `clients`, então um id malformado é recusado pelo banco, com o
     motivo subindo por `traduzir`. O tipo da coluna é a guarda de
     verdade; o Zod aqui só evita string vazia. */
  clientId: z.string().min(1, "Escolha um cliente."),
  /** Ausente na primeira gravação. */
  flowId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1, "Dê um nome ao fluxo.").max(120),
  nodes: z.array(noSchema).max(MAX_NOS, `No máximo ${MAX_NOS} blocos.`),
  edges: z.array(arestaSchema).max(MAX_ARESTAS),
});

export async function salvarFluxo(
  input: z.input<typeof salvarSchema>,
): Promise<ResultadoDoFluxo> {
  const parsed = salvarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Fluxo inválido." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const v = parsed.data;
  if (isDemoMode) return { ok: true, flowId: v.flowId ?? "demo-fluxo" };

  const supabase = await createSupabaseServerClient();

  /* ⚠️ SALVAR NÃO MEXE EM `status`. Um rascunho salvo por cima de um
     fluxo publicado o manteria publicado com conteúdo novo que ninguém
     revisou — e, quando houver motor, isso trocaria a automação no ar
     sem um ato explícito. Trocar o que está publicado passa por
     `publicarFluxo`. */
  const linha = {
    client_id: v.clientId,
    name: v.name,
    nodes: v.nodes,
    edges: v.edges,
  };

  if (v.flowId) {
    const { data, error } = await supabase
      .from("elochat_flows")
      .update(linha)
      .eq("id", v.flowId)
      .select("id");

    if (error) return { ok: false, error: traduzir(error) };
    /* PostgREST devolve `error: null` quando o update não casa linha
       nenhuma — sem esta checagem, uma gravação barrada pela policy
       sairia como sucesso e o trabalho da pessoa sumiria no F5. */
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar: você tem acesso de escrita nesta conta?" };
    }

    revalidatePath("/elochat");
    return { ok: true, flowId: v.flowId };
  }

  const { data, error } = await supabase
    .from("elochat_flows")
    .insert({ ...linha, created_by: user.id })
    .select("id")
    .single();

  if (error) return { ok: false, error: traduzir(error) };

  revalidatePath("/elochat");
  return { ok: true, flowId: (data as { id: string }).id };
}

const publicarSchema = z.object({
  // Pelo mesmo motivo de `salvarSchema` — ver a nota lá.
  flowId: z.string().min(1),
  nodes: z.array(noSchema).max(MAX_NOS),
  edges: z.array(arestaSchema).max(MAX_ARESTAS),
});

/**
 * Marca o fluxo como o válido daquele cliente.
 *
 * ⚠️ A VALIDAÇÃO RODA AQUI DE NOVO, e não é redundância: a tela já
 * bloqueia o botão, mas Server Action é endpoint HTTP e o payload não
 * é confiável por ter saído de um componente nosso. A regra que mais
 * importa é a do ciclo — um fluxo em laço manda a mesma pessoa em
 * repetição até a conta ser restringida, e é a última coisa que se
 * quer confiando numa checagem de navegador.
 */
export async function publicarFluxo(
  input: z.input<typeof publicarSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = publicarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fluxo inválido." };

  const { flowId, nodes, edges } = parsed.data;

  const problemas = problemasDoFluxo(
    nodes as never,
    edges as never,
  );
  if (!podePublicar(problemas)) {
    const primeiro = problemas.find((p) => p.gravidade === "impede");
    return { ok: false, error: primeiro?.mensagem ?? "O fluxo tem pendências." };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("elochat_flows")
    .update({
      nodes,
      edges,
      status: "publicado",
      published_at: new Date().toISOString(),
    })
    .eq("id", flowId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível publicar: você administra esta conta?" };
  }

  revalidatePath("/elochat");
  return { ok: true };
}

export async function despublicarFluxo(
  flowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  /* `published_at` volta a null junto: o check
     `elochat_flows_carimbo_confere` recusa a linha se os dois
     discordarem, então esquecer um dos campos falha alto em vez de
     deixar um carimbo mentindo sobre um rascunho. */
  const { data, error } = await supabase
    .from("elochat_flows")
    .update({ status: "rascunho", published_at: null })
    .eq("id", flowId)
    .select("id");

  if (error) return { ok: false, error: traduzir(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível despublicar." };
  }

  revalidatePath("/elochat");
  return { ok: true };
}

/**
 * Erro do Postgres em frase de gente.
 *
 * ⚠️ A MENSAGEM CRUA SOBE JUNTO, e é de propósito. Engolir o motivo do
 * banco num texto genérico foi o que fez o "Link do cliente" mandar
 * procurar permissão de usuário quando faltava um GRANT na tabela
 * (migration 84). Quando o caso é conhecido, traduz; quando não é,
 * mostra o que o banco disse em vez de adivinhar.
 */
function traduzir(error: { message: string; code?: string }): string {
  const m = error.message;

  if (m.includes("elochat_flows_um_publicado")) {
    return "Este cliente já tem um fluxo publicado. Despublique o outro antes.";
  }
  if (m.includes("permission denied")) {
    return "Sem permissão para escrever nesta conta. (Se você é admin, pode ser grant faltando no banco.)";
  }
  if (m.includes("elochat_flows_carimbo_confere")) {
    return "Estado e carimbo de publicação discordam — isto é bug, não dado.";
  }

  return m;
}
