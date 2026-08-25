"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { dataNoBrasil } from "@/lib/date-br";
import { montarAgendamento, partesDoAgendamento } from "@/lib/social/agenda";
import { materializarProgramacao } from "@/lib/social/materializar";
import type { SocialFormat, SocialNetwork } from "@/types/database";

import type { ActionResult } from "./actions";

/* =====================================================================
   Programação semanal — a grade que se repete sozinha
   ---------------------------------------------------------------------
   Actions separadas de `actions.ts` porque aquele arquivo já passa de
   mil linhas e porque estas têm um risco próprio: elas CRIAM E APAGAM
   peça em lote. Tudo aqui gira em torno de uma regra só, e ela está
   repetida em cada função que apaga:

     nunca destruir peça que alguém tocou.

   "Tocada" é qualquer peça que saiu do rascunho, ganhou arte ou recebeu
   comentário. Uma peça gerada e intocada é um espaço reservado; uma
   peça com a arte do cliente dentro é trabalho pago. A diferença entre
   as duas é a diferença entre mexer na grade e perder a semana.

   Como o resto do módulo, nenhuma action checa papel: tudo escreve com
   a chave ANON e o JWT de quem chamou, e a policy do Postgres decide.
   ===================================================================== */

const REDES = ["instagram", "facebook", "tiktok", "youtube"] as const;
const FORMATOS = [
  "video_vertical",
  "video_horizontal",
  "imagem",
  "carrossel",
  "stories",
  "artigo",
] as const;

const id = z.string().min(1);
/* `([01]\d|2[0-3])` e não `[0-2]\d`: o segundo aceita 25:00, que faz
   `montarAgendamento` montar um timestamp que o Postgres recusa — e a
   materialização daquela linha passa a falhar toda semana, longe demais
   de onde o dado entrou para alguém ligar as duas coisas. */
const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida — use HH:MM.");

/* `ok: false as const` e não a anotação `ActionResult`: sem o literal,
   o TypeScript alarga para `boolean` e a constante deixa de servir às
   funções que prometem devolver `dados` no ramo de sucesso. */
const SEM_PROGRAMACAO_EM_DEMO = {
  ok: false as const,
  error: "A programação semanal não existe no modo demonstração.",
};

/* ------------------------------------------------------------------ */
/* Criar e editar uma linha da grade                                   */
/* ------------------------------------------------------------------ */

const linhaSchema = z.object({
  recurrenceId: id.optional(),
  clientId: id,
  weekday: z.number().int().min(0).max(6),
  hora: hora.default("09:00"),
  format: z.enum(FORMATOS).default("video_vertical"),
  title: z.string().trim().max(200).default(""),
  networks: z.array(z.enum(REDES)).min(1).default(["instagram"]),
});

export async function salvarLinhaDaProgramacao(input: {
  recurrenceId?: string;
  clientId: string;
  weekday: number;
  hora?: string;
  format?: SocialFormat;
  title?: string;
  networks?: SocialNetwork[];
}): Promise<ActionResult<{ recurrenceId: string; movidas: number }>> {
  const parsed = linhaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  if (isDemoMode) return SEM_PROGRAMACAO_EM_DEMO;

  const v = parsed.data;
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();

  const campos = {
    client_id: v.clientId,
    weekday: v.weekday,
    hora: v.hora,
    format: v.format,
    title: v.title,
    networks: v.networks,
  };

  if (!v.recurrenceId) {
    const { data, error } = await supabase
      .from("social_recurrences")
      .insert({ ...campos, created_by: user.id })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, dados: { recurrenceId: data.id, movidas: 0 } };
  }

  const { error } = await supabase
    .from("social_recurrences")
    .update(campos)
    .eq("id", v.recurrenceId);

  if (error) return { ok: false, error: error.message };

  /* MUDAR O DIA MOVE AS PEÇAS QUE JÁ NASCERAM, em vez de apagar e criar
     de novo. É o pedido literal — "eu apenas consiga alterar o dia da
     programação semanal" — e apagar perderia o id da peça, e com ele
     qualquer coisa que alguém já tenha pendurado nela. Só as INTOCADAS
     se movem; a que já tem arte fica onde está, porque mover uma peça
     aprovada para outro dia é decisão de quem aprovou, não do sistema. */
  const movidas = await moverIntocadas(supabase, v.recurrenceId, v.weekday, v.hora);

  revalidatePath("/midias-sociais");
  return { ok: true, dados: { recurrenceId: v.recurrenceId, movidas } };
}

export async function removerLinhaDaProgramacao(input: {
  recurrenceId: string;
}): Promise<ActionResult<{ apagadas: number }>> {
  const parsed = z.object({ recurrenceId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Linha inválida." };
  if (isDemoMode) return SEM_PROGRAMACAO_EM_DEMO;

  const supabase = await createSupabaseServerClient();

  /* Primeiro as peças futuras intocadas, DEPOIS a linha. Na ordem
     inversa o `on delete set null` da migration soltaria o vínculo e as
     peças ficariam órfãs no calendário, sem nada dizendo de onde vieram
     — e o gerador as recriaria na próxima rodada. */
  const apagadas = await apagarFuturasIntocadas(supabase, [parsed.data.recurrenceId]);

  const { error } = await supabase
    .from("social_recurrences")
    .delete()
    .eq("id", parsed.data.recurrenceId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true, dados: { apagadas } };
}

/* ------------------------------------------------------------------ */
/* Transformar uma semana já montada na grade fixa                     */
/* ------------------------------------------------------------------ */

/**
 * "Esta semana é a programação."
 *
 * Existe porque a grade JÁ FOI DIGITADA uma vez — 22 peças em 11
 * clientes, medido em 25/08/2026. Pedir que ela seja redigitada num
 * formulário de recorrência é cobrar duas vezes pelo mesmo trabalho, e
 * é o tipo de atrito que faz o recurso não ser usado.
 *
 * SUBSTITUI a grade dos clientes que aparecem na semana, em vez de
 * somar: rodar duas vezes tem de dar o mesmo resultado, e "somar"
 * dobraria a produção de todo mundo no segundo clique. Cliente que não
 * tem peça nesta semana não é tocado.
 */
export async function fixarSemanaComoProgramacao(input: {
  /** Qualquer dia da semana que serve de molde. */
  semana: string;
}): Promise<ActionResult<{ linhas: number; clientes: number }>> {
  const parsed = z.object({ semana: z.iso.date("Semana inválida.") }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  if (isDemoMode) return SEM_PROGRAMACAO_EM_DEMO;

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const supabase = await createSupabaseServerClient();

  const { inicio, fim } = limitesDaSemana(parsed.data.semana);

  const { data: posts, error: eLeitura } = await supabase
    .from("social_posts")
    .select("id, client_id, title, format, scheduled_at, status, targets:social_post_targets(network)")
    .gte("scheduled_at", `${inicio}T00:00:00-03:00`)
    .lte("scheduled_at", `${fim}T23:59:59-03:00`)
    .neq("status", "arquivado")
    .order("scheduled_at");

  if (eLeitura) return { ok: false, error: eLeitura.message };
  if (!posts?.length) {
    return { ok: false, error: "Esta semana está vazia — não há o que fixar." };
  }

  const clientes = [...new Set(posts.map((p) => p.client_id))];

  /* Fora a grade antiga desses clientes, e com ela as peças futuras que
     ela criou e ninguém tocou. Sem isso, trocar a grade deixaria as
     peças da grade velha espalhadas pelas próximas oito semanas. */
  const { data: antigas } = await supabase
    .from("social_recurrences")
    .select("id")
    .in("client_id", clientes);

  if (antigas?.length) {
    await apagarFuturasIntocadas(
      supabase,
      antigas.map((r) => r.id),
    );
    await supabase
      .from("social_recurrences")
      .delete()
      .in(
        "id",
        antigas.map((r) => r.id),
      );
  }

  const linhas = posts.map((p) => {
    const { data: dia, hora: horaDoPost } = partesDoAgendamento(p.scheduled_at);
    const [ano, mes, d] = dia.split("-").map(Number);

    return {
      client_id: p.client_id,
      weekday: new Date(ano, mes - 1, d, 12).getDay(),
      hora: horaDoPost || "09:00",
      format: p.format,
      title: p.title,
      networks: (p.targets ?? []).map((t) => t.network),
      created_by: user.id,
    };
  });

  const { data: criadas, error } = await supabase
    .from("social_recurrences")
    .insert(
      linhas.map((l) => ({
        ...l,
        networks: l.networks.length > 0 ? l.networks : ["instagram"],
      })),
    )
    .select("id");

  if (error) return { ok: false, error: error.message };

  /* Liga as peças de molde às linhas que elas mesmas geraram. Sem isto,
     o gerador olharia a semana modelo como "não gerada" e criaria uma
     segunda peça em cima de cada uma. */
  for (let i = 0; i < posts.length; i += 1) {
    const alvo = criadas?.[i];
    if (!alvo) continue;
    await supabase
      .from("social_posts")
      .update({ recurrence_id: alvo.id })
      .eq("id", posts[i]!.id);
  }

  revalidatePath("/midias-sociais");
  return {
    ok: true,
    dados: { linhas: criadas?.length ?? 0, clientes: clientes.length },
  };
}

/* ------------------------------------------------------------------ */
/* Materializar a grade no calendário                                  */
/* ------------------------------------------------------------------ */

/**
 * Cria as peças que faltam para as próximas semanas.
 *
 * IDEMPOTENTE, e essa é a propriedade que permite o cron chamá-la todo
 * dia sem medo: antes de criar, ela pergunta quais dias JÁ têm peça
 * daquela linha da grade. Rodar dez vezes seguidas cria as mesmas peças
 * uma vez só.
 *
 * A peça nasce em rascunho, sem legenda e sem arte — é um espaço com
 * dono e dia marcado, que é exatamente o que a grade promete. O resto é
 * trabalho humano.
 */
export async function gerarPautasDaProgramacao(input?: {
  semanas?: number;
  /** Só este cliente. Sem isto, a carteira inteira que a policy deixa ver. */
  clientId?: string;
}): Promise<ActionResult<{ criadas: number; linhas: number }>> {
  if (isDemoMode) return SEM_PROGRAMACAO_EM_DEMO;

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  /* A conta é a mesma do cron; o que muda é o cliente de banco. Aqui vai
     o de SESSÃO, então a policy recorta a carteira de quem clicou — um
     colaborador não enche o calendário de conta que ele não enxerga. E
     por passar pela policy, `createdBy` é obrigatório: sem ele o insert
     bate em `created_by = auth.uid()` e devolve zero. */
  const supabase = await createSupabaseServerClient();
  const r = await materializarProgramacao(supabase, {
    ...input,
    createdBy: user.id,
  });

  if (r.erro) return { ok: false, error: r.erro };

  revalidatePath("/midias-sociais");
  return { ok: true, dados: { criadas: r.criadas, linhas: r.linhas } };
}

/* ------------------------------------------------------------------ */
/* As duas funções que decidem o que pode ser destruído                */
/* ------------------------------------------------------------------ */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Peças futuras que a grade criou e ninguém tocou.
 *
 * TRÊS CONDIÇÕES, e nenhuma é redundante:
 *   `status = 'rascunho'`  — saiu do rascunho, alguém acionou alguém
 *   `media_urls = {}`      — tem arte, existe arquivo produzido
 *   sem comentário         — alguém escreveu alguma coisa sobre ela
 *
 * A terceira é a que quase ficou de fora. Um comentário num rascunho
 * sem arte é o caso mais comum de "trabalho invisível": o gestor
 * anotando o combinado da reunião antes de a peça existir. Apagar isso
 * é apagar a única cópia.
 */
async function futurasIntocadas(
  supabase: Supabase,
  recurrenceIds: string[],
): Promise<string[]> {
  if (recurrenceIds.length === 0) return [];

  const { data } = await supabase
    .from("social_posts")
    .select("id, media_urls, comments:social_post_comments(count)")
    .in("recurrence_id", recurrenceIds)
    .eq("status", "rascunho")
    .gte("scheduled_at", `${dataNoBrasil()}T00:00:00-03:00`);

  type Linha = { id: string; media_urls: string[]; comments?: { count: number }[] };

  return ((data ?? []) as Linha[])
    .filter((p) => (p.media_urls ?? []).length === 0)
    .filter((p) => (p.comments?.[0]?.count ?? 0) === 0)
    .map((p) => p.id);
}

async function apagarFuturasIntocadas(
  supabase: Supabase,
  recurrenceIds: string[],
): Promise<number> {
  const alvos = await futurasIntocadas(supabase, recurrenceIds);
  if (alvos.length === 0) return 0;

  await supabase.from("social_posts").delete().in("id", alvos);
  return alvos.length;
}

/** Reagenda as intocadas para o novo dia da semana, preservando o id. */
async function moverIntocadas(
  supabase: Supabase,
  recurrenceId: string,
  weekday: number,
  horaNova: string,
): Promise<number> {
  const alvos = await futurasIntocadas(supabase, [recurrenceId]);
  if (alvos.length === 0) return 0;

  const { data: atuais } = await supabase
    .from("social_posts")
    .select("id, scheduled_at")
    .in("id", alvos);

  let movidas = 0;
  for (const post of atuais ?? []) {
    if (!post.scheduled_at) continue;

    /* Anda para o dia certo DENTRO DA MESMA SEMANA da peça. Recalcular
       a partir de hoje empilharia todas as ocorrências futuras no
       mesmo dia — oito peças numa quarta só. */
    const diaAtual = dataNoBrasil(post.scheduled_at);
    const [ano, mes, d] = diaAtual.split("-").map(Number);
    const base = new Date(ano, mes - 1, d, 12);
    base.setDate(base.getDate() - base.getDay() + weekday);

    const novoDia = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;

    /* Não puxa peça para o passado: a grade que muda hoje vale de hoje
       em diante. */
    if (novoDia < dataNoBrasil()) continue;

    await supabase
      .from("social_posts")
      .update({ scheduled_at: montarAgendamento(novoDia, horaNova) })
      .eq("id", post.id);

    movidas += 1;
  }

  return movidas;
}

function limitesDaSemana(iso: string): { inicio: string; fim: string } {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  d.setDate(d.getDate() - d.getDay());

  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

  const inicio = fmt(d);
  d.setDate(d.getDate() + 6);
  return { inicio, fim: fmt(d) };
}
