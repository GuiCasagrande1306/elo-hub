"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { horaDoPost, montarAgendamento } from "@/lib/social/agenda";
import {
  BUCKET_ARTE,
  caminhoDaArte,
  ehArteDoPainel,
} from "@/lib/social/media";
import type {
  SocialFormat,
  SocialNetwork,
  SocialPostComment,
  SocialPostStatus,
  SocialPostTarget,
} from "@/types/database";

/**
 * Server Actions do módulo de mídias sociais.
 *
 * Como no módulo de tarefas, NENHUMA delas checa permissão à mão: todas
 * escrevem pelo cliente com a chave ANON e o JWT de quem chamou, então a
 * policy do Postgres é quem decide. Uma action chamada por fora da
 * interface esbarra na mesma parede.
 *
 * Zod em toda entrada. Server Action é endpoint HTTP público — ter saído
 * de um componente nosso não torna o payload confiável.
 */

/* A MESMA lista de `types/database.ts` e do `check` das duas tabelas.
   Repetida aqui de propósito: o zod precisa de um literal em tempo de
   compilação, e importar o tipo não gera valor em runtime. O `satisfies`
   abaixo é a trava — sair de sincronia vira erro de compilação, não
   descoberta em produção. */
const REDES = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
] as const satisfies readonly SocialNetwork[];

const FORMATOS = [
  "video_vertical",
  "video_horizontal",
  "imagem",
  "carrossel",
  "stories",
  "artigo",
] as const;

const STATUS = [
  "rascunho",
  "em_aprovacao",
  "ajustes",
  "aprovado",
  "arquivado",
] as const;

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

/* `min(1)` e não `uuid()`: os ids do modo demo são `c-verdi`, `sp-3`.
   Exigir uuid faria toda escrita falhar em demo com uma mensagem
   genérica sobre "dados inválidos" — o mesmo defeito que a tabela de
   agenda dos relatórios teve. */
const id = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Criar e editar peça                                                 */
/* ------------------------------------------------------------------ */

const postSchema = z.object({
  postId: id.optional(),
  clientId: id,
  title: z.string().trim().min(1, "Dê um nome à peça.").max(200),
  caption: z.string().max(20000).default(""),
  format: z.enum(FORMATOS).default("imagem"),
  /* `datetime({ offset: true })` exige o fuso na string. Sem isso, um
     "2026-08-14T10:00" chega ao Postgres e é lido como UTC — o post
     agendado para as 10h aparece às 7h para quem opera. O compositor
     monta a string com -03:00. */
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  status: z.enum(STATUS).default("rascunho"),
  networks: z.array(z.enum(REDES)).min(1, "Escolha ao menos uma rede."),
  /* URL externa OU caminho no bucket — ver `lib/social/media.ts`.
     `.url()` sozinho recusava o caminho do arquivo enviado pelo painel,
     e a peça salvava sem a arte que a pessoa acabara de anexar. */
  mediaUrls: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
        .refine(
          (v) => /^https?:\/\//i.test(v) || /^[^/]+\/[^/]+\/.+$/.test(v),
          "Arte inválida: use um link http(s) ou um arquivo enviado aqui.",
        ),
    )
    .max(20)
    .default([]),
});

export type PostInput = z.input<typeof postSchema>;

export async function salvarPost(
  input: PostInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    // A mensagem do Zod, não um "dados inválidos" genérico: quem clicou
    // precisa saber QUAL campo recusou.
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const v = parsed.data;
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const { demoClients } = await import("@/lib/mock/data");
    const agora = new Date().toISOString();
    const cliente = demoClients.find((c) => c.id === v.clientId) ?? null;

    const existente = v.postId
      ? demoSocialPosts.find((p) => p.id === v.postId)
      : undefined;

    if (existente) {
      /* Espelha `app.stamp_social_post`: o `??` reproduz o coalesce (quem
         já estava aprovado mantém o aprovador original) e o ramo `null`
         reproduz a limpeza ao sair de aprovado. Sem isto, aprovar pelo
         compositor em demo deixava `approver` nulo e a linha "Aprovado
         por Fulano" nunca aparecia — um comportamento que só existia em
         demo, que é o modo em que a tela é avaliada. */
      const aprovado = v.status === "aprovado";

      Object.assign(existente, {
        client_id: v.clientId,
        title: v.title,
        caption: v.caption,
        format: v.format,
        scheduled_at: v.scheduledAt,
        status: v.status,
        media_urls: v.mediaUrls,
        updated_at: agora,
        approved_by: aprovado ? (existente.approved_by ?? user.id) : null,
        approved_at: aprovado ? (existente.approved_at ?? agora) : null,
        approver: aprovado
          ? (existente.approver ?? { id: user.id, full_name: user.full_name })
          : null,
        client: cliente
          ? {
              id: cliente.id,
              name: cliente.name,
              brand_primary: cliente.brand_primary,
              logo_url: cliente.logo_url,
            }
          : null,
      });
      existente.targets = sincronizarDestinosEmMemoria(
        existente.id,
        existente.targets,
        v.networks,
      );
      revalidatePath("/midias-sociais");
      return { ok: true, dados: { postId: existente.id } };
    }

    const novo = `sp-demo-${Date.now()}`;
    demoSocialPosts.push({
      id: novo,
      recurrence_id: null,
      client_id: v.clientId,
      title: v.title,
      caption: v.caption,
      format: v.format,
      media_urls: v.mediaUrls,
      scheduled_at: v.scheduledAt,
      status: v.status,
      approved_by: v.status === "aprovado" ? user.id : null,
      approved_at: v.status === "aprovado" ? agora : null,
      created_by: user.id,
      created_at: agora,
      updated_at: agora,
      comment_count: 0,
      client: cliente
        ? {
            id: cliente.id,
            name: cliente.name,
            brand_primary: cliente.brand_primary,
            logo_url: cliente.logo_url,
          }
        : null,
      author: { id: user.id, full_name: user.full_name, avatar_url: user.avatar_url },
      approver: null,
      targets: sincronizarDestinosEmMemoria(novo, [], v.networks),
    });

    revalidatePath("/midias-sociais");
    return { ok: true, dados: { postId: novo } };
  }

  const supabase = await createSupabaseServerClient();

  const campos = {
    client_id: v.clientId,
    title: v.title,
    caption: v.caption,
    format: v.format,
    scheduled_at: v.scheduledAt,
    status: v.status,
    media_urls: v.mediaUrls,
  };

  const { data, error } = v.postId
    ? await supabase
        .from("social_posts")
        .update(campos)
        .eq("id", v.postId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("social_posts")
        .insert({ ...campos, created_by: user.id })
        .select("id")
        .maybeSingle();

  if (error) return { ok: false, error: error.message };

  /* `maybeSingle` devolve null quando a policy barrou o UPDATE: o
     Postgres não erra, apenas atinge zero linhas. Sem esta checagem a
     tela diria "salvo" para uma escrita que não aconteceu. */
  if (!data) {
    return {
      ok: false,
      error: "Sem permissão para gravar nesta conta.",
    };
  }

  const sincronizado = await sincronizarDestinos(data.id, v.networks);
  if (!sincronizado.ok) return sincronizado;

  revalidatePath("/midias-sociais");
  return { ok: true, dados: { postId: data.id } };
}

/**
 * Acerta a lista de destinos do post.
 *
 * ⚠️ SÓ APAGA DESTINO PENDENTE. Desmarcar uma rede em que a peça já foi
 * publicada apagaria o registro de que ela saiu — inclusive o link do
 * post no ar, que é a prova. O que já foi publicado (ou falhou) fica, e
 * o compositor mostra essas redes travadas com o motivo.
 */
async function sincronizarDestinos(
  postId: string,
  redes: SocialNetwork[],
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();

  const { data: atuais, error: erroLeitura } = await supabase
    .from("social_post_targets")
    .select("id, network, status")
    .eq("post_id", postId);

  if (erroLeitura) return { ok: false, error: erroLeitura.message };

  const existentes = new Set((atuais ?? []).map((t) => t.network));
  const novas = redes.filter((r) => !existentes.has(r));

  const removiveis = (atuais ?? []).filter(
    (t) => !redes.includes(t.network as SocialNetwork) && t.status === "pendente",
  );

  if (novas.length > 0) {
    const { error } = await supabase
      .from("social_post_targets")
      .insert(novas.map((network) => ({ post_id: postId, network })));
    if (error) return { ok: false, error: error.message };
  }

  if (removiveis.length > 0) {
    const { error } = await supabase
      .from("social_post_targets")
      .delete()
      .in(
        "id",
        removiveis.map((t) => t.id),
      );
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** Mesma regra da `sincronizarDestinos`, para o modo demo. */
function sincronizarDestinosEmMemoria(
  postId: string,
  atuais: SocialPostTarget[],
  redes: SocialNetwork[],
): SocialPostTarget[] {
  const agora = new Date().toISOString();

  const mantidos = atuais.filter(
    (t) => redes.includes(t.network) || t.status !== "pendente",
  );

  const jaTem = new Set(mantidos.map((t) => t.network));

  const novos: SocialPostTarget[] = redes
    .filter((r) => !jaTem.has(r))
    .map((network, i) => ({
      id: `${postId}-t${Date.now()}-${i}`,
      post_id: postId,
      network,
      caption_override: null,
      status: "pendente",
      published_at: null,
      published_url: null,
      error: null,
      created_at: agora,
      updated_at: agora,
    }));

  return [...mantidos, ...novos];
}

/* ------------------------------------------------------------------ */
/* Pauta rápida — criar direto na grade                                */
/* ------------------------------------------------------------------ */

const pautaSchema = z.object({
  clientId: id,
  /* Só a data. A hora é decidida no SERVIDOR, e é de propósito: a grade
     de pauta não tem campo de hora, e deixar o navegador montar o
     instante foi como o fuso entrou errado da primeira vez.

     `z.iso.date` e não um regex de formato. O regex aceitava
     '2026-02-30' e '2026-13-45' — o primeiro o `Date` rola em silêncio
     para 2 de março, o segundo vira Invalid Date e estoura na
     renderização. As duas actions irmãs que já existiam validam de
     verdade (`datetime({ offset: true })` em `salvarPost` e
     `reagendarPost`), e um caminho novo mais frouxo que o antigo é como
     um dado inválido entra. */
  dia: z.iso.date("Dia inválido."),
  title: z.string().trim().min(1, "Dê um nome à peça.").max(200),
  format: z.enum(FORMATOS).default("imagem"),
  /* Só link externo aqui. Arquivo sobe pelo `ArtUploader`, no
     compositor, que precisa de FormData e de barra de progresso — coisas
     que não cabem num popover de uma linha. O `.url()` é mais estrito
     que o refine de `postSchema` de propósito: ali a lista também aceita
     caminho do bucket, que este campo nunca produz. */
  mediaUrl: z
    .string()
    .trim()
    .url("Cole um link começando com http:// ou https://")
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * Cria uma pauta com uma linha só — nome, dia e formato.
 *
 * Existe porque o compositor é o caminho errado para encher um mês. Ele
 * pede cliente, redes, legenda e formato antes de aceitar a primeira
 * peça; quem está planejando trinta pautas de dez clientes abandona na
 * quarta. Aqui o mínimo é o nome: o resto se completa depois, na peça
 * que já existe e já tem dia.
 *
 * AS REDES SAEM DO CADASTRO, não de um palpite da tela. `salvarPost`
 * exige ao menos uma, e a resposta certa já está em `social_accounts` —
 * é literalmente a lista de perfis que a agência opera para o cliente.
 * Sem nenhum cadastrado, Instagram: é a rede de 100% dos contratos de
 * conteúdo da casa hoje, e uma peça com a rede errada se conserta em um
 * clique, enquanto um erro de validação trava a criação.
 */
export async function criarPauta(input: {
  clientId: string;
  dia: string;
  title: string;
  format?: SocialFormat;
  /** Link do Drive/Dropbox colado na criação. Opcional. */
  mediaUrl?: string;
}): Promise<ActionResult<{ postId: string }>> {
  const parsed = pautaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const v = parsed.data;

  const redes = await redesDoCliente(v.clientId);
  if (!redes.ok) return redes;

  return salvarPost({
    clientId: v.clientId,
    title: v.title,
    caption: "",
    format: v.format,
    scheduledAt: montarAgendamento(v.dia, ""),
    status: "rascunho",
    networks: redes.dados,
    mediaUrls: v.mediaUrl ? [v.mediaUrl] : [],
  });
}

async function redesDoCliente(
  clientId: string,
): Promise<ActionResult<SocialNetwork[]>> {
  const padrao: SocialNetwork[] = ["instagram"];

  if (isDemoMode) {
    const { demoSocialAccounts } = await import("@/lib/mock/social");
    const redes = demoSocialAccounts
      .filter((c) => c.client_id === clientId && c.is_active)
      .map((c) => c.network);
    return { ok: true, dados: redes.length > 0 ? redes : padrao };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("network")
    .eq("client_id", clientId)
    .eq("is_active", true);

  /* FALHA DE LEITURA NÃO É "CLIENTE SEM PERFIL". Descartar o `error` e
     cair no padrão faria `salvarPost` criar de verdade uma linha em
     `social_post_targets` apontando para uma rede que a agência talvez
     nem opere para aquele cliente — e nada na tela diria que foi
     palpite. `sincronizarDestinos` já lê o erro e aborta; aqui é o
     mesmo caso. */
  if (error) return { ok: false, error: error.message };

  /* Filtra contra a lista canônica: o `check` da tabela ainda aceita as
     cinco redes removidas na migration 49, então um cadastro antigo
     pode devolver 'linkedin' — e mandá-lo para `salvarPost` faria o zod
     recusar a pauta inteira por causa de um dado velho. */
  const redes = (data ?? [])
    .map((c) => c.network as SocialNetwork)
    .filter((n): n is SocialNetwork => (REDES as readonly string[]).includes(n));

  return { ok: true, dados: redes.length > 0 ? redes : padrao };
}

/* ------------------------------------------------------------------ */
/* Reagendar                                                           */
/* ------------------------------------------------------------------ */

const reagendarSchema = z.object({
  postId: id,
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
});

/**
 * Muda só a data — é o que o arrasto no calendário faz.
 *
 * Separada de `salvarPost` de propósito: arrastar um card não deveria
 * exigir enviar legenda, formato e redes de volta. Um payload cheio
 * traz o risco de sobrescrever com estado velho o que outra pessoa
 * acabou de editar.
 */
export async function reagendarPost(input: {
  postId: string;
  scheduledAt: string | null;
}): Promise<ActionResult> {
  const parsed = reagendarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Data inválida." };

  const { postId, scheduledAt } = parsed.data;

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const post = demoSocialPosts.find((p) => p.id === postId);
    if (post) post.scheduled_at = scheduledAt;
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("social_posts")
    .update({ scheduled_at: scheduledAt })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

const moverSchema = z.object({
  postId: id,
  /* Ausente = mantém o dono. Não é o mesmo que `null`, e por isso não é
     `nullable`: peça sem cliente não existe no esquema. */
  clientId: id.optional(),
  /* Mesma validação estrita de `pautaSchema` — e aqui ela é a ÚNICA
     trava. `criarPauta` ainda passa por `salvarPost`, que revalida;
     `moverPauta` monta o instante e escreve direto no banco. */
  dia: z.iso.date("Dia inválido."),
});

/**
 * Arrastar na grade de pauta: muda o DIA e, quando a peça cai na linha
 * de outro cliente, o dono também.
 *
 * PRESERVA A HORA, como o arrasto do calendário: mover de terça para
 * quarta não deveria mexer no horário de publicação.
 *
 * A tela recusa a troca de cliente quando a peça já tem arte — o
 * caminho do arquivo começa pelo id do cliente e é o que a policy do
 * bucket compara. Aqui não há uma segunda checagem disso de propósito:
 * a policy de `social_posts` é quem decide se esta pessoa pode escrever
 * nos dois clientes, e duplicar a regra da arte no servidor exigiria
 * mover arquivos no Storage dentro de uma action que promete só mudar
 * uma data.
 */
export async function moverPauta(input: {
  postId: string;
  clientId?: string;
  dia: string;
}): Promise<ActionResult> {
  const parsed = moverSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { postId, clientId, dia } = parsed.data;

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const { demoClients } = await import("@/lib/mock/data");
    const post = demoSocialPosts.find((p) => p.id === postId);
    if (post) {
      post.scheduled_at = montarAgendamento(dia, horaDoPost(post.scheduled_at));
      if (clientId) {
        const cliente = demoClients.find((c) => c.id === clientId) ?? null;
        post.client_id = clientId;
        post.client = cliente
          ? {
              id: cliente.id,
              name: cliente.name,
              brand_primary: cliente.brand_primary,
              logo_url: cliente.logo_url,
            }
          : null;
      }
    }
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* Lê a hora atual antes de escrever: `montarAgendamento` precisa dela
     e o cliente não a manda — mandar seria confiar no relógio do
     navegador para reconstruir um instante que o banco já tem. */
  const { data: atual, error: eLeitura } = await supabase
    .from("social_posts")
    .select("scheduled_at")
    .eq("id", postId)
    .maybeSingle();

  if (eLeitura) return { ok: false, error: eLeitura.message };
  if (!atual) return { ok: false, error: "Peça não encontrada." };

  const { error } = await supabase
    .from("social_posts")
    .update({
      scheduled_at: montarAgendamento(dia, horaDoPost(atual.scheduled_at)),
      ...(clientId ? { client_id: clientId } : {}),
    })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

const anexarSchema = z.object({
  postId: id,
  /* Caminho no bucket OU link externo — a mesma dupla que `media_urls`
     guarda. O `data:` do modo demo entra pelo primeiro ramo. */
  arte: z.string().trim().min(1).max(500),
});

/**
 * Acrescenta uma arte à peça que já existe.
 *
 * Existe para o arrasto de arquivo na grade de pauta: `salvarPost` exige
 * o payload inteiro (cliente, título, formato, redes, legenda), e mandar
 * tudo de volta só para somar um arquivo é o caminho clássico de
 * sobrescrever com estado velho o que outra pessoa acabou de editar — a
 * mesma razão pela qual `reagendarPost` existe separada.
 *
 * LÊ E ESCREVE, sem `array_append`. A alternativa atômica exigiria uma
 * função no banco, e a corrida que ela evitaria é duas pessoas soltando
 * um arquivo na MESMA peça no mesmo segundo. Se isso um dia acontecer, o
 * sintoma é uma arte perdida, não um dado corrompido — e o arquivo
 * continua no bucket.
 */
export async function anexarArte(input: {
  postId: string;
  arte: string;
}): Promise<ActionResult<{ total: number }>> {
  const parsed = anexarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Arte inválida." };

  const { postId, arte } = parsed.data;

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const post = demoSocialPosts.find((p) => p.id === postId);
    if (!post) return { ok: false, error: "Peça não encontrada." };
    if (!post.media_urls.includes(arte)) post.media_urls = [...post.media_urls, arte];
    revalidatePath("/midias-sociais");
    return { ok: true, dados: { total: post.media_urls.length } };
  }

  const supabase = await createSupabaseServerClient();

  const { data: atual, error: eLeitura } = await supabase
    .from("social_posts")
    .select("media_urls")
    .eq("id", postId)
    .maybeSingle();

  if (eLeitura) return { ok: false, error: eLeitura.message };
  if (!atual) return { ok: false, error: "Peça não encontrada." };

  const lista: string[] = atual.media_urls ?? [];
  if (lista.includes(arte)) return { ok: true, dados: { total: lista.length } };

  /* O teto é o mesmo de `postSchema.mediaUrls`. Sem ele, arrastar em
     cima da mesma peça vinte vezes gravaria uma lista que o compositor
     depois se recusa a salvar — e a pessoa descobriria só ao editar. */
  if (lista.length >= 20) {
    return { ok: false, error: "Esta peça já tem 20 artes, o máximo." };
  }

  const nova = [...lista, arte];
  const { error } = await supabase
    .from("social_posts")
    .update({ media_urls: nova })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true, dados: { total: nova.length } };
}

/* ------------------------------------------------------------------ */
/* Trâmite editorial                                                   */
/* ------------------------------------------------------------------ */

const statusSchema = z.object({
  postId: id,
  status: z.enum(STATUS),
  /* Comentário junto da mudança. "Pedir ajustes" sem dizer qual ajuste
     devolve a peça para o designer sem informação nenhuma — e ele volta
     a perguntar no WhatsApp, que é o que esta tela existe para evitar. */
  comentario: z.string().trim().max(2000).optional(),
});

export async function definirStatus(input: {
  postId: string;
  status: SocialPostStatus;
  comentario?: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Status inválido." };

  const { postId, status, comentario } = parsed.data;
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const post = demoSocialPosts.find((p) => p.id === postId);
    if (post) {
      post.status = status;
      const aprovado = status === "aprovado";
      post.approved_by = aprovado ? user.id : null;
      post.approved_at = aprovado ? new Date().toISOString() : null;
      post.approver = aprovado ? { id: user.id, full_name: user.full_name } : null;
    }
    if (comentario) await comentarEmMemoria(postId, user, comentario);
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `approved_by` NÃO vai aqui — e nem adiantaria: a trigger
     `stamp_social_post` descarta o que vier do payload e carimba o
     `auth.uid()`. É lá que a regra vale, porque a policy libera a tabela
     inteira e o PostgREST aceita PATCH em qualquer coluna. */
  const { error } = await supabase
    .from("social_posts")
    .update({ status })
    .eq("id", postId);

  if (error) return { ok: false, error: error.message };

  if (comentario) {
    const { error: erroComentario } = await supabase
      .from("social_post_comments")
      .insert({ post_id: postId, author_id: user.id, body: comentario });
    if (erroComentario) return { ok: false, error: erroComentario.message };
  }

  revalidatePath("/midias-sociais");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Publicação — marcada à mão                                          */
/* ------------------------------------------------------------------ */

const publicacaoSchema = z.object({
  targetId: id,
  status: z.enum(["pendente", "publicado", "falhou"]),
  /* `or(literal(""))` porque o campo vem vazio quando alguém marca
     publicado sem colar o link. Exigir URL travaria o registro do que
     de fato aconteceu; o link é prova útil, não obrigação. */
  url: z.string().trim().url().or(z.literal("")).optional(),
  erro: z.string().trim().max(500).optional(),
});

/**
 * Registra que a peça saiu (ou não) em uma rede.
 *
 * MARCADO À MÃO, por quem publicou. O sistema não fala com API de rede
 * nenhuma — ver o cabeçalho da migration 33 — e um botão "Publicar" que
 * não publica seria pior que a ausência dele: a tela afirmaria que o
 * post está no ar sem nada ter saído.
 */
export async function marcarPublicacao(input: {
  targetId: string;
  status: "pendente" | "publicado" | "falhou";
  url?: string;
  erro?: string;
}): Promise<ActionResult> {
  const parsed = publicacaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const { targetId, status, url, erro } = parsed.data;

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    for (const post of demoSocialPosts) {
      const alvo = post.targets.find((t) => t.id === targetId);
      if (!alvo) continue;

      // Espelha em memória o que a trigger `stamp_social_target` faz.
      alvo.status = status;
      if (status === "publicado") {
        alvo.published_at = alvo.published_at ?? new Date().toISOString();
        alvo.published_url = url || null;
        alvo.error = null;
      } else {
        alvo.published_at = null;
        alvo.published_url = null;
        alvo.error = status === "falhou" ? (erro ?? null) : null;
      }
      break;
    }
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("social_post_targets")
    .update({
      status,
      published_url: status === "publicado" ? url || null : null,
      error: status === "falhou" ? (erro ?? null) : null,
    })
    .eq("id", targetId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Comentários                                                         */
/* ------------------------------------------------------------------ */

const comentarioSchema = z.object({
  postId: id,
  body: z.string().trim().min(1, "Escreva alguma coisa.").max(2000),
});

/**
 * Conversa de uma peça, sob demanda.
 *
 * Server Action que só LÊ — sem isso, a lista de posts teria de trazer
 * todos os comentários de todas as peças para que uma delas mostrasse os
 * seus. A leitura passa pela DAL, então continua sob RLS.
 */
export async function carregarComentarios(
  postId: string,
): Promise<SocialPostComment[]> {
  if (!postId) return [];
  const { getSocialComments } = await import("@/lib/data");
  return getSocialComments(postId);
}

export async function comentarPost(input: {
  postId: string;
  body: string;
}): Promise<ActionResult> {
  const parsed = comentarioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  if (isDemoMode) {
    await comentarEmMemoria(parsed.data.postId, user, parsed.data.body);
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("social_post_comments").insert({
    post_id: parsed.data.postId,
    author_id: user.id,
    body: parsed.data.body,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

async function comentarEmMemoria(
  postId: string,
  user: { id: string; full_name: string; avatar_url: string | null },
  body: string,
) {
  const { demoSocialComments, demoSocialPosts } = await import("@/lib/mock/social");

  demoSocialComments.push({
    id: `sc-demo-${Date.now()}`,
    post_id: postId,
    author_id: user.id,
    body,
    created_at: new Date().toISOString(),
    author: { id: user.id, full_name: user.full_name, avatar_url: user.avatar_url },
  });

  const post = demoSocialPosts.find((p) => p.id === postId);
  if (post) post.comment_count = (post.comment_count ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Excluir                                                             */
/* ------------------------------------------------------------------ */

/**
 * Apaga a peça de vez.
 *
 * A tela oferece ARQUIVAR como caminho normal; isto só faz sentido para
 * o post criado por engano. Destinos e comentários vão junto pelo
 * `on delete cascade`.
 *
 * ⚠️ RECUSA PEÇA JÁ PUBLICADA. O cascade levaria junto `published_at` e
 * `published_url` — o link do post no ar, que é a única prova de que ele
 * saiu e não é reconstruível depois. A trava de verdade é a trigger
 * `app.guard_social_post_delete`, que vale também para quem escreve
 * direto no banco; a checagem aqui existe só para a mensagem ser
 * legível em vez de um erro cru do Postgres.
 */
export async function excluirPost(postId: string): Promise<ActionResult> {
  if (!postId) return { ok: false, error: "Post não informado." };

  const recusa =
    "Esta peça já foi publicada em alguma rede. Arquive em vez de excluir — apagar levaria junto o link do post no ar.";

  if (isDemoMode) {
    const { demoSocialPosts } = await import("@/lib/mock/social");
    const i = demoSocialPosts.findIndex((p) => p.id === postId);
    if (i < 0) return { ok: true };

    if (demoSocialPosts[i].targets.some((t) => t.status === "publicado")) {
      return { ok: false, error: recusa };
    }

    demoSocialPosts.splice(i, 1);
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { data: publicados } = await supabase
    .from("social_post_targets")
    .select("id")
    .eq("post_id", postId)
    .eq("status", "publicado")
    .limit(1);

  if (publicados && publicados.length > 0) {
    return { ok: false, error: recusa };
  }

  const { error } = await supabase.from("social_posts").delete().eq("id", postId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Perfis sociais                                                      */
/* ------------------------------------------------------------------ */

const contaSchema = z.object({
  clientId: id,
  network: z.enum(REDES),
  /* Sem `@` e sem URL colada inteira: os dois são o erro de digitação
     mais comum aqui, e guardar `@fulano` faria o link do perfil sair
     como `instagram.com/@fulano`. Limpo na entrada, uma vez. */
  handle: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, "").replace(/^https?:\/\/[^/]+\//i, ""))
    .pipe(z.string().min(1, "Informe o @ do perfil.").max(120)),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).nullable().default(null),
});

export async function salvarConta(input: {
  clientId: string;
  network: SocialNetwork;
  handle: string;
  isActive?: boolean;
  notes?: string | null;
}): Promise<ActionResult> {
  const parsed = contaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const v = parsed.data;

  if (isDemoMode) {
    const { demoSocialAccounts } = await import("@/lib/mock/social");
    const existente = demoSocialAccounts.find(
      (a) => a.client_id === v.clientId && a.network === v.network,
    );
    if (existente) {
      existente.handle = v.handle;
      existente.is_active = v.isActive;
      existente.notes = v.notes;
    } else {
      demoSocialAccounts.push({
        client_id: v.clientId,
        network: v.network,
        handle: v.handle,
        profile_url: null,
        is_active: v.isActive,
        notes: v.notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `upsert` na chave composta (client_id, network): cadastrar o mesmo
     Instagram duas vezes para a mesma conta não é caso de uso, e sem
     isto o segundo cadastro morre com violação de PK. */
  const { error } = await supabase.from("social_accounts").upsert(
    {
      client_id: v.clientId,
      network: v.network,
      handle: v.handle,
      is_active: v.isActive,
      notes: v.notes,
    },
    { onConflict: "client_id,network" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/midias-sociais");
  return { ok: true };
}

export async function removerConta(input: {
  clientId: string;
  network: SocialNetwork;
}): Promise<ActionResult> {
  if (!input.clientId || !input.network) {
    return { ok: false, error: "Conta não informada." };
  }

  if (isDemoMode) {
    const { demoSocialAccounts } = await import("@/lib/mock/social");
    const i = demoSocialAccounts.findIndex(
      (a) => a.client_id === input.clientId && a.network === input.network,
    );
    if (i >= 0) demoSocialAccounts.splice(i, 1);
    revalidatePath("/midias-sociais");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `.select()` para saber QUANTAS linhas caíram. `social_accounts_write`
     exige admin, e um DELETE barrado por policy não gera erro — atinge
     zero linhas em silêncio. Sem esta checagem, o colaborador via
     "Instagram removido", e o perfil voltava no primeiro refresh.

     Só aqui: as outras actions escrevem sob `client_is_visible` /
     `social_post_is_visible`, onde quem enxerga já pode escrever, e
     `salvarConta` usa upsert, cuja violação de policy levanta erro de
     verdade. */
  const { data, error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("client_id", input.clientId)
    .eq("network", input.network)
    .select("client_id");

  if (error) return { ok: false, error: error.message };

  if (!data?.length) {
    return { ok: false, error: "Sem permissão para remover este perfil." };
  }

  revalidatePath("/midias-sociais");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Arte da peça                                                        */
/* ------------------------------------------------------------------ */

/**
 * Recebe o arquivo e devolve o caminho no bucket.
 *
 * SOBE COM service_role, não com a sessão. O bucket não tem policy de
 * INSERT para usuário final de propósito: dar esse direito significaria
 * que qualquer pessoa autenticada escreve em qualquer pasta cujo uuid
 * ela adivinhe. A autorização acontece AQUI, antes — sessão válida e
 * cliente visível para quem pediu, checado com o cliente de sessão, que
 * passa pela RLS.
 *
 * `FormData` e não base64 no corpo: um Reels de 30MB viraria 40MB de
 * string e estouraria o limite de payload da Server Action.
 */
export async function enviarArte(
  formData: FormData,
): Promise<ActionResult<{ caminho: string; url: string }>> {
  const arquivo = formData.get("arquivo");
  const clientId = formData.get("clientId");

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, error: "Nenhum arquivo recebido." };
  }
  if (typeof clientId !== "string" || !clientId) {
    return { ok: false, error: "Escolha o cliente antes de anexar a arte." };
  }

  /* O MESMO teto do bucket (migration 49). Checar aqui também para a
     pessoa saber ANTES de esperar o upload inteiro subir e o Storage
     recusar no fim. */
  const TETO = 50 * 1024 * 1024;
  if (arquivo.size > TETO) {
    return {
      ok: false,
      error: `Arquivo de ${(arquivo.size / 1024 / 1024).toFixed(0)}MB — o limite é 50MB. Para vídeo maior, cole o link do Drive.`,
    };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  if (isDemoMode) {
    /* Demo não tem Storage. Devolve um data URL para a tela funcionar
       ponta a ponta — inclusive a miniatura — sem inventar um caminho
       que não existe em bucket nenhum. */
    const base64 = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
    const url = `data:${arquivo.type};base64,${base64}`;
    return { ok: true, dados: { caminho: url, url } };
  }

  /* Cliente de SESSÃO só para autorizar: se a RLS não devolve esta
     conta, quem pediu não pode anexar arte nela. */
  const sessao = await createSupabaseServerClient();
  const { data: visivel } = await sessao
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (!visivel) {
    return { ok: false, error: "Cliente não encontrado ou sem permissão." };
  }

  const admin = createSupabaseAdminClient();
  const caminho = caminhoDaArte(clientId, crypto.randomUUID(), arquivo.name);

  const { error } = await admin.storage
    .from(BUCKET_ARTE)
    .upload(caminho, arquivo, {
      contentType: arquivo.type || "application/octet-stream",
      // `false`: o caminho já tem uma pasta aleatória por upload, então
      // colisão aqui seria bug, não substituição desejada.
      upsert: false,
    });

  if (error) {
    return { ok: false, error: `Não deu para enviar a arte: ${error.message}` };
  }

  const url = await assinar(admin, caminho);
  if (!url) {
    return { ok: false, error: "Arte enviada, mas não deu para gerar a prévia." };
  }

  return { ok: true, dados: { caminho, url } };
}

/**
 * URLs de exibição para as artes de uma peça.
 *
 * Devolve um mapa caminho → URL assinada. Link externo volta como ele
 * mesmo, para quem chama não precisar separar os dois tipos antes.
 *
 * DUAS HORAS de validade: cobre uma sessão de revisão inteira sem
 * transformar a URL num link permanente que circula por aí. Arte de
 * campanha antes de ir ao ar é material sob embargo.
 */
export async function assinarArtes(
  caminhos: string[],
): Promise<ActionResult<Record<string, string>>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const mapa: Record<string, string> = {};
  const doPainel: string[] = [];

  for (const c of caminhos.slice(0, 100)) {
    if (ehArteDoPainel(c)) doPainel.push(c);
    else mapa[c] = c;
  }

  if (isDemoMode || doPainel.length === 0) {
    for (const c of doPainel) mapa[c] = c;
    return { ok: true, dados: mapa };
  }

  const admin = createSupabaseAdminClient();

  /* Assina com service_role, mas SÓ depois de a RLS confirmar quais
     clientes esta pessoa enxerga. O primeiro trecho do caminho é o
     cliente — é a mesma comparação que a policy do bucket faz, feita
     aqui porque o service_role não passa por policy nenhuma. */
  const sessao = await createSupabaseServerClient();
  const { data: meus } = await sessao.from("clients").select("id");
  const visiveis = new Set((meus ?? []).map((c) => c.id));

  for (const caminho of doPainel) {
    const dono = caminho.split("/")[0];
    if (!dono || !visiveis.has(dono)) continue;

    const url = await assinar(admin, caminho);
    if (url) mapa[caminho] = url;
  }

  return { ok: true, dados: mapa };
}

async function assinar(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  caminho: string,
): Promise<string | null> {
  const { data } = await admin.storage
    .from(BUCKET_ARTE)
    .createSignedUrl(caminho, 2 * 60 * 60);

  return data?.signedUrl ?? null;
}

/* ------------------------------------------------------------------ */
/* Importar os @ que a Meta já conhece                                 */
/* ------------------------------------------------------------------ */

/**
 * Cadastra de uma vez os Instagram vinculados às contas de anúncios.
 *
 * NÃO SOBRESCREVE o que já existe: `onConflict` ignora a linha quando o
 * par (cliente, rede) já está cadastrado. Um @ corrigido à mão vale mais
 * que o que a Meta devolve — a plataforma às vezes traz o perfil antigo
 * de uma conta que trocou de nome.
 */
export async function importarInstagramDaMeta(): Promise<
  ActionResult<{ importados: number; jaTinham: number; total: number }>
> {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return { ok: false, error: "Só administradores cadastram perfis." };
  }

  if (isDemoMode) {
    return { ok: true, dados: { importados: 0, jaTinham: 0, total: 0 } };
  }

  const { descobrirInstagramVinculado } = await import(
    "@/lib/ads/instagram-vinculado"
  );

  const encontrados = await descobrirInstagramVinculado();
  if (encontrados.length === 0) {
    return {
      ok: false,
      error:
        "Nenhuma conta de anúncios tem Instagram vinculado no gerenciador da Meta.",
    };
  }

  const admin = createSupabaseAdminClient();

  const { data: existentes } = await admin
    .from("social_accounts")
    .select("client_id")
    .eq("network", "instagram");

  const jaCadastrados = new Set((existentes ?? []).map((e) => e.client_id));
  const novos = encontrados.filter((e) => !jaCadastrados.has(e.clientId));

  if (novos.length > 0) {
    const agora = new Date().toISOString();
    const { error } = await admin.from("social_accounts").insert(
      novos.map((n) => ({
        client_id: n.clientId,
        network: "instagram",
        handle: n.handle,
        is_active: true,
        created_at: agora,
        updated_at: agora,
      })),
    );

    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/midias-sociais");

  return {
    ok: true,
    dados: {
      importados: novos.length,
      jaTinham: encontrados.length - novos.length,
      total: encontrados.length,
    },
  };
}
