"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { dataNoBrasil } from "@/lib/date-br";
import {
  LIMITE_DA_LISTA,
  SECOES_DE_CAMPOS,
  SECOES_DE_LISTA,
  ehSecaoDeCampos,
  ehSecaoDeLista,
  limparValores,
  type FichaDoCliente,
  type ItemDaFicha,
} from "@/lib/clientes/ficha";

export type Resultado = { ok: true } | { ok: false; error: string };

/* =====================================================================
   Ficha do cliente — escrita
   ---------------------------------------------------------------------
   Toda escrita passa por `alterarFicha`: lê a ficha atual DO BANCO,
   muda UMA seção e grava. Ler do banco, e não confiar no que a tela
   tem, impede que salvar o Mapa do Negócio apague uma regra que outra
   pessoa acabou de criar.

   shortcut: duas gravações no MESMO instante ainda podem se sobrescrever
   (ler-alterar-gravar sem trava). Se virar problema, mover a seção para
   tabela própria, como foi feito com a linha do tempo.

   Permissão: a do RLS de `clients` (update para quem enxerga a conta).
   ===================================================================== */

const PAGINA = "/clientes/[slug]";

async function alterarFicha(
  clientId: string,
  mudar: (ficha: FichaDoCliente, autor: string) => FichaDoCliente | string,
): Promise<Resultado> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role === "client") return { ok: false, error: "Sem permissão." };
  const autor = user.full_name ?? "Alguém";

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const c = demoClients.find((x) => x.id === clientId);
    if (!c) return { ok: false, error: "Cliente não encontrado." };
    const nova = mudar(c.ficha ?? {}, autor);
    if (typeof nova === "string") return { ok: false, error: nova };
    c.ficha = nova;
    revalidatePath(PAGINA, "page");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("clients")
    .select("ficha")
    .eq("id", clientId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, error: erroLeitura.message };
  if (!atual) return { ok: false, error: "Cliente não encontrado ou sem permissão." };

  const nova = mudar((atual.ficha ?? {}) as FichaDoCliente, autor);
  if (typeof nova === "string") return { ok: false, error: nova };

  // `.select("id")` distingue "recusado pelo RLS" (zero linhas) de "salvo".
  const { data, error } = await supabase
    .from("clients")
    .update({ ficha: nova })
    .eq("id", clientId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Sem permissão para editar este cliente." };

  revalidatePath(PAGINA, "page");
  return { ok: true };
}

const id = z.string().min(1).max(100);
const valores = z.record(z.string(), z.unknown());

export async function salvarCampos(input: {
  clientId: string;
  secao: string;
  valores: Record<string, string>;
}): Promise<Resultado> {
  const p = z.object({ clientId: id, secao: z.string(), valores }).safeParse(input);
  if (!p.success || !ehSecaoDeCampos(p.data.secao)) return { ok: false, error: "Dados inválidos." };
  const secao = p.data.secao;
  const limpo = limparValores(SECOES_DE_CAMPOS[secao], p.data.valores);

  return alterarFicha(p.data.clientId, (ficha) => ({ ...ficha, [secao]: limpo }));
}

/** Cria (sem `id`) ou substitui (com `id`) um item de lista. */
export async function salvarItem(input: {
  clientId: string;
  secao: string;
  item: Record<string, string>;
}): Promise<Resultado> {
  const p = z.object({ clientId: id, secao: z.string(), item: valores }).safeParse(input);
  if (!p.success || !ehSecaoDeLista(p.data.secao)) return { ok: false, error: "Dados inválidos." };
  const secao = p.data.secao;
  const definicao = SECOES_DE_LISTA[secao];
  const limpo = limparValores(definicao, p.data.item);

  // O primeiro campo é o que identifica o item (regra, nome, pendência...).
  if (!limpo[definicao[0].chave]) return { ok: false, error: `Preencha "${definicao[0].rotulo}".` };

  const itemId = typeof p.data.item.id === "string" && p.data.item.id ? p.data.item.id : null;

  return alterarFicha(p.data.clientId, (ficha, autor) => {
    const lista = ficha[secao] ?? [];
    if (itemId) {
      const existente = lista.find((i) => i.id === itemId);
      if (!existente) return "Item não encontrado. Recarregue a página.";
      return {
        ...ficha,
        [secao]: lista.map((i) =>
          i.id === itemId
            ? { ...limpo, id: i.id, criado_por: i.criado_por ?? autor, criado_em: i.criado_em ?? "" }
            : i,
        ),
      };
    }
    if (lista.length >= LIMITE_DA_LISTA) return "Limite de itens atingido.";
    const novo: ItemDaFicha = {
      ...limpo,
      id: crypto.randomUUID(),
      criado_por: autor,
      criado_em: dataNoBrasil(new Date()),
    };
    return { ...ficha, [secao]: [...lista, novo] };
  });
}

export async function removerItem(input: {
  clientId: string;
  secao: string;
  itemId: string;
}): Promise<Resultado> {
  const p = z.object({ clientId: id, secao: z.string(), itemId: id }).safeParse(input);
  if (!p.success || !ehSecaoDeLista(p.data.secao)) return { ok: false, error: "Dados inválidos." };
  const secao = p.data.secao;

  return alterarFicha(p.data.clientId, (ficha) => ({
    ...ficha,
    [secao]: (ficha[secao] ?? []).filter((i) => i.id !== p.data.itemId),
  }));
}

/* =====================================================================
   Linha do tempo (`client_timeline`)
   ===================================================================== */

const entrada = z.object({
  clientId: id,
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  kind: z.enum(["reuniao", "mensagem", "decisao"]),
  title: z.string().trim().min(2, "Dê um título.").max(200, "Título longo demais."),
  body: z.string().trim().max(5000, "Texto longo demais.").optional(),
});

export async function registrarNaLinhaDoTempo(
  input: z.input<typeof entrada>,
): Promise<Resultado> {
  const p = entrada.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role === "client") return { ok: false, error: "Sem permissão." };

  const linha = {
    client_id: p.data.clientId,
    occurred_on: p.data.occurredOn,
    kind: p.data.kind,
    title: p.data.title,
    body: p.data.body || null,
  };

  if (isDemoMode) {
    const { demoLinhaDoTempo } = await import("@/lib/mock/data");
    demoLinhaDoTempo.push({
      ...linha,
      id: crypto.randomUUID(),
      created_by: user.id,
      created_at: new Date().toISOString(),
      autor: { id: user.id, full_name: user.full_name },
    });
    revalidatePath(PAGINA, "page");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("client_timeline")
    .insert({ ...linha, created_by: user.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PAGINA, "page");
  return { ok: true };
}

export async function apagarDaLinhaDoTempo(input: { id: string }): Promise<Resultado> {
  const p = z.object({ id }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (user.role === "client") return { ok: false, error: "Sem permissão." };

  if (isDemoMode) {
    const { demoLinhaDoTempo } = await import("@/lib/mock/data");
    const i = demoLinhaDoTempo.findIndex((e) => e.id === p.data.id);
    if (i >= 0) demoLinhaDoTempo.splice(i, 1);
    revalidatePath(PAGINA, "page");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("client_timeline")
    .delete()
    .eq("id", p.data.id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Sem permissão para apagar." };

  revalidatePath(PAGINA, "page");
  return { ok: true };
}
