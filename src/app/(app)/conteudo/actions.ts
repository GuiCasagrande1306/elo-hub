"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import {
  blocosSchema,
  carimbosSchema,
  STATUS_BRIEF,
} from "@/lib/content/blocks";

/* =====================================================================
   Server Actions dos briefs de conteúdo
   ---------------------------------------------------------------------
   Nenhuma checa permissão à mão. Todas escrevem pelo cliente com a
   chave ANON carregando o JWT de quem chamou, então quem autoriza é a
   policy do Postgres — uma action chamada por fora da interface bate na
   mesma parede.

   A exceção anotada é `publicarLink`, que gera o token: ali a escrita
   continua passando pela RLS, mas o VALOR do token nunca vem do
   cliente. Ver o comentário na função.

   Zod em toda entrada: Server Action é endpoint HTTP público, e ter
   saído de um componente nosso não torna o payload confiável.
   ===================================================================== */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

/* `min(1)` e não `uuid()`: no modo demo os ids são `c-verdi`, `brief-1`.
   Exigir uuid faria toda escrita em demo falhar com "dados inválidos". */
const id = z.string().min(1);

const briefSchema = z.object({
  briefId: id.optional(),
  clientId: id,
  titulo: z.string().trim().min(1, "Dê um título ao documento.").max(200),
  /* Vazio vira `null`: string vazia faria o renderizador procurar ""
     dentro do título e destacar o caractere zero. */
  destaque: z.string().trim().max(120).nullish(),
  resumo: z.string().max(2000).default(""),
  carimbos: carimbosSchema.default([]),
  blocos: blocosSchema.default([]),
  status: z.enum(STATUS_BRIEF).default("rascunho"),
});

export type BriefInput = z.input<typeof briefSchema>;

/**
 * Cria ou atualiza um documento.
 *
 * Na ESCRITA o zod roda inteiro e recusa o salvamento — o oposto da
 * leitura, que descarta bloco inválido e segue (ver `lerBlocos`).
 * Aqui ainda dá para consertar; depois de salvo, não.
 */
export async function salvarBrief(
  entrada: BriefInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = briefSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: primeiroErro(parsed.error) };
  }
  const v = parsed.data;

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre de novo." };

  if (isDemoMode) {
    const { salvarBriefDemo } = await import("@/lib/mock/content");
    const salvo = salvarBriefDemo({ ...v, autor: user.id });
    revalidatePath("/conteudo");
    return { ok: true, dados: { id: salvo.id } };
  }

  const supabase = await createSupabaseServerClient();

  const linha = {
    client_id: v.clientId,
    titulo: v.titulo,
    destaque: v.destaque?.trim() ? v.destaque.trim() : null,
    resumo: v.resumo,
    carimbos: v.carimbos,
    blocos: v.blocos,
    status: v.status,
  };

  if (v.briefId) {
    const { error } = await supabase
      .from("content_briefs")
      .update(linha)
      .eq("id", v.briefId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/conteudo");
    revalidatePath(`/conteudo/${v.briefId}`);
    return { ok: true, dados: { id: v.briefId } };
  }

  /* `created_by` explícito: a policy de insert exige que ele seja igual
     a `auth.uid()`. Sem o campo, o insert é recusado pela RLS com uma
     mensagem genérica sobre violação de policy. */
  const { data, error } = await supabase
    .from("content_briefs")
    .insert({ ...linha, created_by: user.id })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/conteudo");
  return { ok: true, dados: { id: data.id as string } };
}

/* ------------------------------------------------------------------ */
/* Link público                                                        */
/* ------------------------------------------------------------------ */

/**
 * 24 bytes — 32 caracteres em base64url.
 *
 * O link vai para o WhatsApp do cliente e fica lá; não expira. Um token
 * curto o bastante para ser varrido por tentativa é o único jeito de
 * alguém de fora chegar ao documento, já que a rota pública não tem
 * outra autenticação.
 */
function novoToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function publicarLink(
  briefId: string,
): Promise<ActionResult<{ token: string }>> {
  const parsed = id.safeParse(briefId);
  if (!parsed.success) return { ok: false, error: "Documento inválido." };

  if (isDemoMode) {
    const { publicarLinkDemo } = await import("@/lib/mock/content");
    const token = publicarLinkDemo(briefId);
    if (!token) return { ok: false, error: "Documento não encontrado." };
    revalidatePath(`/conteudo/${briefId}`);
    return { ok: true, dados: { token } };
  }

  const supabase = await createSupabaseServerClient();

  /* Se já existe token, DEVOLVE O MESMO em vez de gerar outro. Gerar um
     novo a cada clique quebraria em silêncio o link que o cliente já
     tem salvo — e ninguém descobriria até ele reclamar. Trocar o
     endereço é `revogarLink` seguido de `publicarLink`, dois gestos
     distintos e conscientes. */
  const { data: atual, error: erroLeitura } = await supabase
    .from("content_briefs")
    .select("share_token")
    .eq("id", briefId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: erroLeitura.message };
  if (!atual) return { ok: false, error: "Documento não encontrado." };

  const existente = atual.share_token as string | null;
  if (existente) return { ok: true, dados: { token: existente } };

  /* O token é gerado AQUI, com `randomBytes`, e nunca chega pela
     entrada da action. Se viesse do cliente, quem chamasse a action
     escolheria o endereço público do documento — e poderia escolher um
     previsível de propósito. */
  const token = novoToken();

  const { error } = await supabase
    .from("content_briefs")
    .update({ share_token: token, shared_at: new Date().toISOString() })
    .eq("id", briefId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/conteudo/${briefId}`);
  return { ok: true, dados: { token } };
}

export async function revogarLink(briefId: string): Promise<ActionResult> {
  const parsed = id.safeParse(briefId);
  if (!parsed.success) return { ok: false, error: "Documento inválido." };

  if (isDemoMode) {
    const { revogarLinkDemo } = await import("@/lib/mock/content");
    revogarLinkDemo(briefId);
    revalidatePath(`/conteudo/${briefId}`);
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("content_briefs")
    .update({ share_token: null, shared_at: null })
    .eq("id", briefId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/conteudo/${briefId}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Status e ciclo de vida                                              */
/* ------------------------------------------------------------------ */

export async function mudarStatus(
  briefId: string,
  status: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ briefId: id, status: z.enum(STATUS_BRIEF) })
    .safeParse({ briefId, status });

  if (!parsed.success) return { ok: false, error: "Status inválido." };

  if (isDemoMode) {
    const { mudarStatusDemo } = await import("@/lib/mock/content");
    mudarStatusDemo(parsed.data.briefId, parsed.data.status);
    revalidatePath("/conteudo");
    revalidatePath(`/conteudo/${briefId}`);
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("content_briefs")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.briefId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/conteudo");
  revalidatePath(`/conteudo/${briefId}`);
  return { ok: true };
}

/**
 * Duplica um documento para outro cliente (ou o mesmo).
 *
 * É o gesto mais usado depois de o formato existir: a segunda pizzaria
 * não começa da folha em branco, começa da estrutura da primeira. O
 * link público NÃO acompanha a cópia — seria o endereço de um cliente
 * servindo o documento de outro.
 */
export async function duplicarBrief(
  briefId: string,
  clientIdDestino: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({ briefId: id, clientId: id })
    .safeParse({ briefId, clientId: clientIdDestino });

  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre de novo." };

  if (isDemoMode) {
    const { duplicarBriefDemo } = await import("@/lib/mock/content");
    const novo = duplicarBriefDemo(
      parsed.data.briefId,
      parsed.data.clientId,
      user.id,
    );
    if (!novo) return { ok: false, error: "Documento não encontrado." };
    revalidatePath("/conteudo");
    return { ok: true, dados: { id: novo.id } };
  }

  const supabase = await createSupabaseServerClient();

  const { data: origem, error: erroLeitura } = await supabase
    .from("content_briefs")
    .select("titulo, destaque, resumo, carimbos, blocos")
    .eq("id", parsed.data.briefId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, error: erroLeitura.message };
  if (!origem) return { ok: false, error: "Documento não encontrado." };

  const { data, error } = await supabase
    .from("content_briefs")
    .insert({
      client_id: parsed.data.clientId,
      titulo: `${origem.titulo} (cópia)`,
      destaque: origem.destaque,
      resumo: origem.resumo,
      carimbos: origem.carimbos,
      blocos: origem.blocos,
      status: "rascunho",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/conteudo");
  return { ok: true, dados: { id: data.id as string } };
}

/** Apagar é policy de admin — ver a migration. Aqui só se propaga o erro. */
export async function apagarBrief(briefId: string): Promise<ActionResult> {
  const parsed = id.safeParse(briefId);
  if (!parsed.success) return { ok: false, error: "Documento inválido." };

  if (isDemoMode) {
    const { apagarBriefDemo } = await import("@/lib/mock/content");
    apagarBriefDemo(briefId);
    revalidatePath("/conteudo");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("content_briefs")
    .delete({ count: "exact" })
    .eq("id", briefId);

  if (error) return { ok: false, error: error.message };

  /* DELETE barrado por policy não é erro no PostgREST: ele apaga zero
     linhas e responde 204. Sem checar a contagem, a tela diria
     "apagado" e o documento continuaria na lista depois do refresh. */
  if (!count) {
    return {
      ok: false,
      error: "Só um administrador pode apagar. Use o status Arquivado.",
    };
  }

  revalidatePath("/conteudo");
  return { ok: true };
}

/* ------------------------------------------------------------------ */

function primeiroErro(erro: z.ZodError): string {
  const issue = erro.issues[0];
  if (!issue) return "Dados inválidos.";

  /* O caminho ajuda a achar o bloco quebrado num documento de trinta:
     "blocos.7.gancho" diz exatamente onde olhar, e sem isso a mensagem
     seria "Required" sem endereço. */
  const caminho = issue.path.join(".");
  return caminho ? `${caminho}: ${issue.message}` : issue.message;
}
