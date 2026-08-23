/* =====================================================================
   Briefs de conteúdo — a linha editorial de cada cliente vira página
   ---------------------------------------------------------------------
   O que a agência entrega hoje como PDF solto ou link avulso passa a
   morar aqui: diagnóstico do perfil, arquétipos que funcionam, filtro
   editorial, os roteiros da semana, banco de ganchos e o checklist do
   que precisa vir do cliente antes de gravar.

   POR QUE UM `jsonb` E NÃO UMA TABELA POR BLOCO
   ---------------------------------------------------------------------
   A tentação é normalizar: `brief_secoes`, `brief_roteiros`,
   `brief_ganchos`. Foi descartado por três motivos.

     1. NADA É CONSULTADO POR DENTRO. Ninguém vai perguntar "quais
        roteiros de todos os clientes são de topo". O documento é lido
        inteiro ou não é lido.
     2. A ORDEM É O CONTEÚDO. Um documento editorial é uma sequência —
        o diagnóstico precede os arquétipos, que precedem os roteiros.
        Em tabelas separadas isso vira uma coluna `posicao` mantida à
        mão em três lugares.
     3. O FORMATO AINDA VAI MUDAR. Cada cliente pede um bloco que os
        outros não têm. Com jsonb, um tipo novo de bloco é uma linha no
        zod (`lib/content/blocks.ts`); normalizado, seria migration.

   A validação não some por isso: o zod valida na Server Action, e o
   `check` abaixo garante que o banco nunca guarde algo que não seja um
   array. Estrutura errada não chega ao renderizador.

   O QUE É COLUNA E O QUE É BLOCO
   ---------------------------------------------------------------------
   Vira coluna o que a LISTAGEM precisa ler sem abrir o documento:
   título, cliente, status, data. O resto é bloco. Guardar o título
   dentro do jsonb obrigaria a listagem a baixar o documento inteiro de
   todos os clientes para escrever uma linha de lista.
   ===================================================================== */

create table if not exists public.content_briefs (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null references public.clients(id) on delete cascade,

  /* Título completo, do jeito que aparece no topo: "Bastidores da
     Brazzo". `destaque` é o pedaço que sai na cor da marca — "Brazzo".
     Separado porque a alternativa seria HTML dentro do texto, e aí a
     listagem precisaria escapar tag para escrever o nome do documento. */
  titulo    text not null check (length(btrim(titulo)) > 0),
  destaque  text,

  /* O parágrafo grande logo abaixo do título. */
  resumo    text not null default '',

  /* Pares rótulo/valor da linha de carimbos: "Cliente · Brazzo Pizza",
     "Formato · Reels vertical". Array de {rotulo, valor}. */
  carimbos  jsonb not null default '[]'::jsonb,

  /* O corpo. Ver `src/lib/content/blocks.ts` para o formato de cada
     tipo de bloco. */
  blocos    jsonb not null default '[]'::jsonb,

  status text not null default 'rascunho'
    check (status in ('rascunho', 'revisao', 'aprovado', 'arquivado')),

  /* LINK PÚBLICO — `null` enquanto ninguém compartilhou.

     É uma coluna, e não um HMAC derivado do id como o token de
     impressão do relatório, porque este link tem vida longa: vai para o
     WhatsApp do cliente e fica lá. Token derivado só se revoga trocando
     o segredo do sistema inteiro; token guardado se revoga com um
     `update ... set share_token = null` nesta linha. */
  share_token text unique,
  shared_at   timestamptz,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* O renderizador percorre `blocos` com um `for`. Um objeto no lugar
     do array quebraria a página inteira, e o erro apareceria como tela
     branca em produção — não como recusa na escrita. */
  constraint content_briefs_blocos_array check (jsonb_typeof(blocos) = 'array'),
  constraint content_briefs_carimbos_array check (jsonb_typeof(carimbos) = 'array'),

  /* Um sem o outro é estado impossível: token sem data não diz desde
     quando o link circula, data sem token é um link que não existe. */
  constraint content_briefs_share_completo check (
    (share_token is null and shared_at is null)
    or (share_token is not null and shared_at is not null)
  )
);

/* A listagem é sempre "documentos deste cliente, mais recente primeiro".
   Sem o índice, cada abertura da tela faz sequential scan e ordena em
   memória — barato hoje, com dezenas de linhas, e o tipo de coisa que
   ninguém volta para arrumar quando são milhares. */
create index if not exists content_briefs_client_idx
  on public.content_briefs (client_id, created_at desc);

/* Parcial: só interessa achar linha COM token, que é o que a rota
   pública consulta. O índice do `unique` já cobriria, mas este é uma
   fração do tamanho porque a maioria dos documentos nunca é
   compartilhada. */
create index if not exists content_briefs_share_idx
  on public.content_briefs (share_token)
  where share_token is not null;

drop trigger if exists trg_content_briefs_touch on public.content_briefs;
create trigger trg_content_briefs_touch
  before update on public.content_briefs
  for each row execute function app.touch_updated_at();

comment on table public.content_briefs is
  'Documento de linha editorial por cliente: diagnóstico, roteiros, banco de ganchos e checklist.';
comment on column public.content_briefs.share_token is
  'Token do link público de leitura. NULL = não compartilhado. Revogar = setar NULL.';


/* ---------------------------------------------------------------------
   RLS

   Mesmo desenho de `social_posts`: enxerga quem enxerga o cliente,
   escreve quem escreve o cliente. Uma policy POR COMANDO, não um
   `for all` — policies permissivas se somam com OU, então um `for all`
   frouxo impediria para sempre que a criação exigisse `created_by`.

   NENHUMA policy para `anon`. O link público não é lido pela chave
   anônima: a rota `/c/[token]` consulta com a service role e filtra
   pelo token ela mesma. Se `anon` pudesse ler "todo brief com token
   não nulo", bastaria um `select *` sem filtro para baixar o
   planejamento de conteúdo de todos os clientes de uma vez.
   ------------------------------------------------------------------ */

alter table public.content_briefs enable row level security;

/* GRANT EXPLÍCITO — não é redundante com a RLS, e sem ele nada funciona.

   Este projeto NÃO usa os `alter default privileges` do Supabase: toda
   tabela concede na própria migration (ver `20260803000002_rls.sql`).
   Sem a linha abaixo, o Postgres barra por PRIVILÉGIO antes de sequer
   avaliar as policies, e a tela inteira responde
   "permission denied for table content_briefs" para todo mundo — um
   erro que não se parece nem um pouco com o que é.

   `anon` fica de fora de propósito. O link público não é lido pela
   chave anônima: `/c/[token]` consulta com a service role e filtra pelo
   token no servidor. Conceder a `anon` abriria a tabela para qualquer
   pessoa com a chave que vai no bundle do browser. */
grant select, insert, update, delete on public.content_briefs to authenticated;

drop policy if exists content_briefs_select on public.content_briefs;
drop policy if exists content_briefs_insert on public.content_briefs;
drop policy if exists content_briefs_update on public.content_briefs;
drop policy if exists content_briefs_delete on public.content_briefs;

create policy content_briefs_select on public.content_briefs
  for select to authenticated
  using (app.client_is_visible(client_id));

create policy content_briefs_insert on public.content_briefs
  for insert to authenticated
  with check (
    app.client_is_visible(client_id)
    and created_by = (select auth.uid())
  );

create policy content_briefs_update on public.content_briefs
  for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

/* Apagar é o único ato restrito a admin. O documento é o registro do
   que foi combinado com o cliente — quem gravou o vídeo precisa poder
   voltar nele meses depois. Para tirar da frente sem perder, existe o
   status `arquivado`. */
create policy content_briefs_delete on public.content_briefs
  for delete to authenticated
  using (app.is_admin());
