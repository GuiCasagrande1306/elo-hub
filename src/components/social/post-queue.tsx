"use client";

import { MessageSquare, Paperclip } from "lucide-react";

import { NetworkRow } from "./network-glyph";
import { SITUACOES, situacaoDoPost } from "@/lib/social/post-status";
import { FORMATO_LABEL } from "@/lib/social/networks";
import { horaDoPost, rotuloDoDia } from "@/lib/social/agenda";
import { dataNoBrasil } from "@/lib/date-br";
import { cn } from "@/lib/utils";
import type { SocialPostWithRelations } from "@/types/database";

/* =====================================================================
   Fila de publicação
   ---------------------------------------------------------------------
   O calendário responde "como está o mês"; esta tela responde "o que vem
   agora". São perguntas diferentes e por isso as duas existem — a grade
   de 31 células é péssima para ler quinze peças em ordem, e a lista é
   péssima para ver que a quinta-feira está vazia.

   AGRUPADA POR DIA, com o dia em cabeçalho grudento. Uma coluna "data"
   repetiria a mesma string em sequências de quatro e cinco linhas, e é
   a repetição que faz a leitura escorregar.

   Peças SEM DATA vêm por último, num grupo próprio. Ordená-las como se
   fossem de hoje colocaria pauta sem compromisso na frente do que sai
   em duas horas.
   ===================================================================== */

/* Trilhas fixas: 8+132+96+88+116 = 440px, mais 5 vãos de 12px = 500px.
   A grade só liga em `lg` por causa dessa conta. Em `md` (768px) o card
   tem ~448px úteis — 768 menos a barra lateral de 248px, menos o padding
   do container e o da linha —, e faltar 52px não corta a última coluna:
   a trilha `1fr` do TÍTULO é a única que cede, e cede até zero, porque o
   item tem `min-w-0`. O resultado medido era a peça sem nome nenhum
   entre 768 e 1023px. Nessa faixa vale o empilhamento do celular, que
   já existe e mostra tudo. */
const GRADE = "8px 1fr 132px 96px 88px 116px";

export function PostQueue({
  posts,
  onAbrirPost,
}: {
  posts: SocialPostWithRelations[];
  onAbrirPost: (post: SocialPostWithRelations) => void;
}) {
  const grupos = agrupar(posts);

  if (posts.length === 0) {
    return (
      <p className="surface-card p-8 text-center text-sm text-muted-foreground">
        Nenhuma peça com os filtros atuais.
      </p>
    );
  }

  return (
    /* `overflow-clip` e NÃO `overflow-hidden`, apesar de os dois
       recortarem igual nos cantos arredondados: `hidden` cria uma caixa
       de rolagem, e o `sticky` do cabeçalho de dia passa a se resolver
       contra ELA — que nunca rola — em vez de contra a página. Medido
       aqui: com `hidden`, ao rolar 756px o cabeçalho ficava em
       top: -301px, ou seja, saía da tela sem grudar em nada.
       `clip` recorta sem criar scrollport, e o sticky volta a valer. */
    <div className="surface-card overflow-clip">
      {/* Cabeçalho só no desktop: no celular a linha vira três linhas
          empilhadas e um cabeçalho de colunas não descreveria nada. */}
      <div
        className="hidden items-center gap-3 border-b border-hairline px-3 py-2 lg:grid"
        style={{ gridTemplateColumns: GRADE }}
      >
        <span />
        <span className="eyebrow">Peça</span>
        <span className="eyebrow">Cliente</span>
        <span className="eyebrow">Redes</span>
        <span className="eyebrow">Formato</span>
        <span className="eyebrow">Situação</span>
      </div>

      {grupos.map((grupo) => (
        <section key={grupo.chave}>
          {/* `top-16`, não `top-0`: o cabeçalho do shell é
              `sticky top-0 z-20 h-16`. Com `top-0` aqui, o cabeçalho do
              dia grudava EMBAIXO dele — z-10 contra z-20 — e sumia por
              completo justamente enquanto estava grudado, que é quando
              ele precisa ser lido. */}
          <header className="sticky top-16 z-10 flex items-center gap-2 border-b border-hairline bg-surface-2/85 px-3 py-1.5 backdrop-blur">
            <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {grupo.rotulo}
            </h3>
            <span className="text-2xs tabular-nums text-muted-foreground/70">
              {grupo.posts.length}
            </span>
          </header>

          <ul className="divide-y divide-hairline">
            {grupo.posts.map((post) => (
              <li key={post.id}>
                <Linha post={post} onAbrir={() => onAbrirPost(post)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Linha({
  post,
  onAbrir,
}: {
  post: SocialPostWithRelations;
  onAbrir: () => void;
}) {
  const situacao = situacaoDoPost(post);
  const s = SITUACOES[situacao];
  const redes = post.targets.map((t) => t.network);

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-accent lg:grid lg:items-center lg:gap-3 lg:py-2"
      style={{ gridTemplateColumns: GRADE }}
    >
      {/* Marcador da situação: no desktop é a primeira trilha da grade;
          no celular sobe para junto do título. */}
      <span
        aria-hidden
        className={cn("hidden size-2 rounded-full lg:block", s.dot)}
      />

      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full lg:hidden", s.dot)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-sm font-medium",
                situacao === "arquivado" && "text-muted-foreground line-through",
              )}
            >
              {post.title}
            </span>
            {(post.comment_count ?? 0) > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground"
                title={`${post.comment_count} comentários`}
              >
                <MessageSquare className="size-3" />
                {post.comment_count}
              </span>
            )}
            {post.media_urls.length > 0 && (
              <Paperclip
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="Tem arte anexada"
              />
            )}
          </span>

          {post.scheduled_at && (
            <span className="mt-0.5 block text-2xs tabular-nums text-muted-foreground lg:hidden">
              {horaDoPost(post.scheduled_at)} · {post.client?.name}
            </span>
          )}
        </span>

        {post.scheduled_at && (
          <span className="hidden shrink-0 text-2xs tabular-nums text-muted-foreground lg:block">
            {horaDoPost(post.scheduled_at)}
          </span>
        )}
      </span>

      <span className="hidden truncate text-xs text-muted-foreground lg:block">
        {post.client?.name ?? "—"}
      </span>

      <span className="flex items-center gap-2 lg:contents">
        <NetworkRow
          networks={redes}
          max={4}
          colorida={situacao !== "arquivado"}
        />

        <span className="hidden text-xs text-muted-foreground lg:block">
          {FORMATO_LABEL.get(post.format) ?? post.format}
        </span>

        <span
          className={cn(
            "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset",
            s.className,
          )}
        >
          {s.label}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */

interface Grupo {
  chave: string;
  rotulo: string;
  posts: SocialPostWithRelations[];
}

function agrupar(posts: SocialPostWithRelations[]): Grupo[] {
  const porDia = new Map<string, SocialPostWithRelations[]>();
  const semData: SocialPostWithRelations[] = [];

  for (const post of posts) {
    if (!post.scheduled_at) {
      semData.push(post);
      continue;
    }
    const dia = dataNoBrasil(post.scheduled_at);
    const lista = porDia.get(dia);
    if (lista) lista.push(post);
    else porDia.set(dia, [post]);
  }

  const hoje = dataNoBrasil();

  const grupos: Grupo[] = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, lista]) => ({
      chave: dia,
      /* "Hoje" em vez da data por extenso: é o grupo que se procura, e
         quem está com a tela aberta sabe que dia é hoje. */
      rotulo: dia === hoje ? `Hoje — ${rotuloDoDia(dia)}` : rotuloDoDia(dia),
      posts: lista.sort((a, b) =>
        (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
      ),
    }));

  if (semData.length > 0) {
    grupos.push({ chave: "sem-data", rotulo: "Sem data", posts: semData });
  }

  return grupos;
}
