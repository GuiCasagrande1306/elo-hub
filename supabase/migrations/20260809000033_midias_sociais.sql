/* =====================================================================
   Gestão de mídias sociais — pauta, aprovação e publicação
   ---------------------------------------------------------------------
   O QUE ESTE MÓDULO É: o calendário editorial da agência. Onde a pauta
   nasce, passa pelo cliente, é aprovada e vira registro do que foi ao ar.

   O QUE ELE NÃO É: um publicador. Nenhuma linha aqui fala com a API de
   rede nenhuma, e o esquema foi desenhado assumindo isso — não é
   provisório à espera de um motor.

   A DECISÃO CENTRAL DO ESQUEMA
   ---------------------------------------------------------------------
   `social_posts.status` NÃO tem o valor 'publicado'.

   O caminho óbvio era uma coluna de status com sete valores terminando
   em 'publicado'. Ele quebra no caso que é a regra, não a exceção: um
   post vai para Instagram, Facebook e LinkedIn, o estagiário publica em
   dois e esquece o terceiro. Com um status único no post, alguém marca
   'publicado' e o LinkedIn some da consciência de todo mundo — a tela
   afirma que saiu, e ninguém tem como descobrir que não.

   Então a publicação mora em `social_post_targets`, UMA LINHA POR REDE,
   e o estado do post é DERIVADO da soma delas. O post não declara que
   foi publicado; ele é publicado quando todos os destinos foram. É a
   mesma regra que já vale para `priority` nas tarefas (derivada de
   `criticality`) e para o MRR na gestão: um número só, num lugar só,
   para dois lugares não discordarem.

   `status` guarda o que o banco não consegue derivar: o trâmite
   EDITORIAL — rascunho, em aprovação, ajustes pedidos, aprovado,
   arquivado. Isso é decisão humana e precisa de coluna.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Redes: `text` com `check`, não `enum`

   Enum obriga `alter type ... add value` para cada rede nova, roda fora
   de transação em versões antigas e não dá para remover valor. Um
   `check` se troca com um `alter table` comum. A lista canônica com
   rótulo, cor e limite de legenda vive em `src/lib/social/networks.ts`;
   aqui o check só impede que um typo crie uma rede fantasma que nenhuma
   tela sabe desenhar.
   ------------------------------------------------------------------ */

create table if not exists public.social_accounts (
  /* PK composta: UM perfil por rede por cliente. Sem isso, dois
     @handles do mesmo Instagram na mesma conta e nenhuma forma de saber
     qual é o certo na hora de publicar. */
  client_id   uuid not null references public.clients (id) on delete cascade,
  network     text not null check (network in (
                'instagram', 'facebook', 'linkedin', 'tiktok',
                'youtube', 'x', 'pinterest', 'threads', 'google_business'
              )),

  /* Sem o `@`. A interface põe o arroba na hora de mostrar — guardar
     com ele espalha `replace('@','')` por toda leitura. */
  handle      text not null,
  profile_url text,

  /* Perfil que existe mas está fora do contrato do mês. Continua no
     cadastro (o histórico de posts aponta para ele) e some das telas de
     planejamento. */
  is_active   boolean not null default true,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (client_id, network)
);

comment on table public.social_accounts is
  'Perfis sociais de cada cliente. Cadastro editorial — NÃO é conexão de API, não guarda token e não publica nada.';


create table if not exists public.social_posts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,

  /* Nome INTERNO da peça ("Carrossel Dia dos Pais"), o que aparece na
     grade do calendário. Separado da legenda de propósito: legenda de
     Instagram tem 2.200 caracteres e não cabe numa célula de dia. */
  title        text not null,

  /* Legenda base. Cada destino pode sobrescrever — ver
     `social_post_targets.caption_override`. */
  caption      text not null default '',

  /* Formato descrito pelo ATIVO — o que o arquivo é, não como cada rede
     o chama. "Reels", "Shorts" e o vídeo do TikTok são o mesmo 9:16, e
     tratá-los como formatos diferentes tornava impossível registrar um
     vertical para as quatro redes sem um aviso falso. Ver a migration
     34, que fez essa conversão. */
  format       text not null default 'imagem' check (format in (
                 'video_vertical', 'video_horizontal', 'imagem',
                 'carrossel', 'stories', 'artigo'
               )),

  /* URLs das artes. `text[]` e não uma tabela: são referências para o
     Drive/Dropbox onde a arte já mora, não upload. Uma tabela filha
     custaria join e policy para guardar uma lista de strings que
     ninguém consulta isoladamente. */
  media_urls   text[] not null default '{}',

  /* NULL = pauta sem data ainda. É estado legítimo e comum: a ideia
     entra no banco antes de existir dia para ela. O calendário mostra
     essas separadas em vez de fingir uma data. */
  scheduled_at timestamptz,

  /* TRÂMITE EDITORIAL. 'publicado' não está aqui de propósito — leia o
     cabeçalho do arquivo. */
  status       text not null default 'rascunho' check (status in (
                 'rascunho', 'em_aprovacao', 'ajustes', 'aprovado', 'arquivado'
               )),

  /* Quem assinou a aprovação e quando. Existe porque aprovação sem
     nome não é aprovação: quando o cliente reclama do post, a pergunta
     é "quem liberou", e um status sozinho não responde. */
  approved_by  uuid references public.profiles (id) on delete set null,
  approved_at  timestamptz,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.social_posts is
  'Peça de conteúdo social. `status` é o trâmite editorial; publicação é medida em social_post_targets, não declarada aqui.';

/* Índice do calendário: a tela abre sempre por mês e quase sempre
   filtrada por cliente. */
create index if not exists social_posts_agenda_idx
  on public.social_posts (client_id, scheduled_at);

create index if not exists social_posts_scheduled_idx
  on public.social_posts (scheduled_at)
  where scheduled_at is not null;


create table if not exists public.social_post_targets (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.social_posts (id) on delete cascade,
  network         text not null check (network in (
                    'instagram', 'facebook', 'linkedin', 'tiktok',
                    'youtube', 'x', 'pinterest', 'threads', 'google_business'
                  )),

  /* Legenda específica desta rede. NULL = usa a do post.
     NULL e string vazia são coisas diferentes aqui: vazio é "esta rede
     vai sem legenda", que é escolha real no Pinterest e no Stories. */
  caption_override text,

  /* ONDE A PUBLICAÇÃO MORA. 'publicado' é marcado À MÃO por quem
     publicou — não há integração que marque sozinho, e inventar um
     estado 'agendado' que ninguém dispara seria mentir na tela. */
  status          text not null default 'pendente' check (status in (
                    'pendente', 'publicado', 'falhou'
                  )),

  published_at    timestamptz,

  /* Link do post no ar. É a PROVA de que saiu — e o caminho de volta
     quando o cliente pergunta "cadê". */
  published_url   text,

  /* Por que não saiu. Preenchido quando status = 'falhou'. */
  error           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  /* Uma linha por rede por post. Marcar "publicado no Instagram" duas
     vezes não é caso de uso, é bug de clique duplo. */
  unique (post_id, network)
);

comment on table public.social_post_targets is
  'Destino do post em cada rede, com o estado real de publicação. A situação do post é derivada daqui.';

create index if not exists social_post_targets_post_idx
  on public.social_post_targets (post_id);


create table if not exists public.social_post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.social_posts (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.social_post_comments is
  'Conversa de aprovação. Sem isto, "pedir ajustes" é um status sem lugar para dizer QUAL ajuste.';

create index if not exists social_post_comments_post_idx
  on public.social_post_comments (post_id, created_at);


/* ---------------------------------------------------------------------
   Triggers
   ------------------------------------------------------------------ */

do $$
begin
  create trigger trg_social_accounts_touch
    before update on public.social_accounts
    for each row execute function app.touch_updated_at();
exception when duplicate_object then null;
end $$;

do $$
begin
  create trigger trg_social_posts_touch
    before update on public.social_posts
    for each row execute function app.touch_updated_at();
exception when duplicate_object then null;
end $$;

do $$
begin
  create trigger trg_social_post_targets_touch
    before update on public.social_post_targets
    for each row execute function app.touch_updated_at();
exception when duplicate_object then null;
end $$;


/* Carimba a data de publicação junto com o status, no banco.
   ---------------------------------------------------------------------
   Deixar isso para a aplicação parece inofensivo até existirem dois
   caminhos de escrita (a tela e, um dia, uma importação em lote) e um
   deles esquecer. `published_at` é o que ordena o histórico; sem ele o
   registro fica sem eixo.

   Também LIMPA ao voltar atrás: desmarcar publicado e deixar a data é
   afirmar que saiu num dia que não saiu. */
create or replace function app.stamp_social_target()
returns trigger
language plpgsql
as $$
begin
  /* `tg_op = 'INSERT'` ANTES de tocar em OLD. Numa trigger de INSERT o
     registro OLD não existe, e ler `old.status` lá dentro derruba a
     operação com "record old is not assigned yet". O `or` do PL/pgSQL
     avalia da esquerda para a direita e para no primeiro verdadeiro,
     então o INSERT nunca chega na segunda metade. */
  if new.status = 'publicado'
     and (tg_op = 'INSERT' or old.status is distinct from 'publicado') then
    new.published_at := coalesce(new.published_at, now());
    new.error := null;
  elsif new.status <> 'publicado' then
    new.published_at := null;
    new.published_url := null;
  end if;

  if new.status <> 'falhou' then
    new.error := null;
  end if;

  return new;
end;
$$;

do $$
begin
  create trigger trg_social_target_stamp
    before insert or update on public.social_post_targets
    for each row execute function app.stamp_social_target();
exception when duplicate_object then null;
end $$;


/* A ASSINATURA DE APROVAÇÃO É ESCRITA AQUI, NUNCA PELO CLIENTE.
   ---------------------------------------------------------------------
   A primeira versão usava `coalesce(new.approved_by, auth.uid())` e só
   entrava no ramo quando o status MUDAVA para 'aprovado'. As duas coisas
   juntas abriam um buraco: com o post já em 'aprovado', um
   `PATCH /rest/v1/social_posts` com `{"approved_by": "<uid do sócio>"}`
   passava direto — nenhum dos dois ramos disparava, e a policy libera a
   tabela inteira, sem lista de colunas. Qualquer pessoa da equipe podia
   assinar uma aprovação com o nome de outra, que é exatamente o que
   `approved_by` existe para impedir.

   Agora o valor vindo do payload é SEMPRE descartado:

     • saiu de aprovado  → limpa (o aval não vale mais)
     • entrou em aprovado → carimba `auth.uid()` e `now()`
     • continua aprovado  → preserva o que já estava, ignorando o envio

   `tg_op = 'INSERT'` vem antes de qualquer leitura de OLD, pelo mesmo
   motivo da trigger acima. */
create or replace function app.stamp_social_post()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'aprovado' then
    new.approved_by := null;
    new.approved_at := null;
  elsif tg_op = 'INSERT' or old.status is distinct from 'aprovado' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;

  return new;
end;
$$;

do $$
begin
  create trigger trg_social_post_stamp
    before insert or update on public.social_posts
    for each row execute function app.stamp_social_post();
exception when duplicate_object then null;
end $$;


/* NÃO SE APAGA O QUE JÁ FOI AO AR.
   ---------------------------------------------------------------------
   `social_post_targets.post_id` tem `on delete cascade`, então apagar a
   peça leva junto `published_at` e `published_url` — o link do post no
   ar, que é a única prova de que ele saiu. Um clique errado no botão
   Excluir apagaria o histórico de uma publicação real, e não há como
   reconstruí-lo depois.

   A tela oferece ARQUIVAR para isso, e a action avisa antes com uma
   mensagem melhor. A trava mora aqui porque só aqui ela vale também
   para quem escreve direto no banco. */
create or replace function app.guard_social_post_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.social_post_targets t
     where t.post_id = old.id and t.status = 'publicado'
  ) then
    raise exception
      'Peça já publicada em alguma rede: arquive em vez de excluir.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

do $$
begin
  create trigger trg_social_post_guard_delete
    before delete on public.social_posts
    for each row execute function app.guard_social_post_delete();
exception when duplicate_object then null;
end $$;


/* ---------------------------------------------------------------------
   Acesso

   GRANT ANTES DA POLICY. Oitava vez neste projeto: o Postgres checa o
   privilégio de tabela ANTES de avaliar a policy. Sem o grant, a
   consulta volta vazia ou com 42501 e a policy nem chega a rodar — o
   sintoma é uma tela em branco sem erro visível.
   Ver as migrations 17, 18, 26, 29, 30, 31 e 32.

   VISIBILIDADE segue a carteira: quem enxerga o cliente enxerga a pauta
   dele. ESCRITA também é da equipe inteira, e isso é deliberado —
   planejar post é o trabalho diário de quem opera a conta. Restringir a
   admin repetiria o bug que a migration 18 consertou: o colaborador
   veria o calendário e levaria "permissão negada" ao arrastar um card.

   O controle de quem aprovou não vem de policy e sim de `approved_by`,
   preenchido pela trigger com o `auth.uid()` de quem executou. Policy
   diria quem PODE aprovar; a coluna diz quem APROVOU, que é a pergunta
   que aparece quando o cliente reclama.
   ------------------------------------------------------------------ */

alter table public.social_accounts      enable row level security;
alter table public.social_posts         enable row level security;
alter table public.social_post_targets  enable row level security;
alter table public.social_post_comments enable row level security;

grant select, insert, update, delete on public.social_accounts      to authenticated;
grant select, insert, update, delete on public.social_posts         to authenticated;
grant select, insert, update, delete on public.social_post_targets  to authenticated;
grant select, insert, update, delete on public.social_post_comments to authenticated;

/* SECURITY INVOKER, igual a `app.client_is_visible`: precisa HERDAR a
   RLS de quem chama. Com DEFINER, a função enxergaria todos os posts e
   as policies filhas passariam a liberar o que a policy do pai nega. */
create or replace function app.social_post_is_visible(p_post uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.social_posts p where p.id = p_post);
$$;

comment on function app.social_post_is_visible(uuid) is
  'Espelha a visibilidade de social_posts para as tabelas filhas. SECURITY INVOKER de propósito.';


drop policy if exists social_accounts_select on public.social_accounts;
drop policy if exists social_accounts_write  on public.social_accounts;

create policy social_accounts_select on public.social_accounts
  for select to authenticated
  using (app.client_is_visible(client_id));

/* Cadastro de perfil é ato administrativo, como vincular conta de
   anúncios: define para ONDE o conteúdo vai. Errar aqui redireciona a
   publicação de um cliente para o perfil de outro. */
create policy social_accounts_write on public.social_accounts
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());


drop policy if exists social_posts_select on public.social_posts;
drop policy if exists social_posts_write  on public.social_posts;
drop policy if exists social_posts_insert on public.social_posts;
drop policy if exists social_posts_update on public.social_posts;
drop policy if exists social_posts_delete on public.social_posts;

create policy social_posts_select on public.social_posts
  for select to authenticated
  using (app.client_is_visible(client_id));

/* UMA POLICY POR COMANDO, e não um `for all`.
   Com `for all`, acrescentar depois uma policy de insert mais estrita
   não estreitaria nada: policies permissivas se somam com OU, e a mais
   frouxa continuaria valendo. Separar é o que permite exigir
   `created_by = auth.uid()` só na criação.

   `created_by` amarrado a quem está logado segue a convenção do projeto
   (`rls.sql:320`). Sem isso, um colaborador cria a peça assinando com o
   id de outra pessoa — e a lista exibe esse nome como autor. */
create policy social_posts_insert on public.social_posts
  for insert to authenticated
  with check (
    app.client_is_visible(client_id)
    and created_by = (select auth.uid())
  );

create policy social_posts_update on public.social_posts
  for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

create policy social_posts_delete on public.social_posts
  for delete to authenticated
  using (app.client_is_visible(client_id));


drop policy if exists social_post_targets_select on public.social_post_targets;
drop policy if exists social_post_targets_write  on public.social_post_targets;

create policy social_post_targets_select on public.social_post_targets
  for select to authenticated
  using (app.social_post_is_visible(post_id));

create policy social_post_targets_write on public.social_post_targets
  for all to authenticated
  using (app.social_post_is_visible(post_id))
  with check (app.social_post_is_visible(post_id));


drop policy if exists social_post_comments_select on public.social_post_comments;
drop policy if exists social_post_comments_insert on public.social_post_comments;
drop policy if exists social_post_comments_delete on public.social_post_comments;

create policy social_post_comments_select on public.social_post_comments
  for select to authenticated
  using (app.social_post_is_visible(post_id));

/* `author_id = auth.uid()` no WITH CHECK, como em `rls.sql:362`.
   Sem isso, um `POST /rest/v1/social_post_comments` com o `author_id` de
   outra pessoa é aceito, e a conversa de aprovação passa a exibir um
   "pode publicar" assinado por quem nunca escreveu — no lugar exato onde
   a equipe vai procurar quem autorizou. */
create policy social_post_comments_insert on public.social_post_comments
  for insert to authenticated
  with check (
    app.social_post_is_visible(post_id)
    and author_id = (select auth.uid())
  );

/* SEM policy de UPDATE: comentário de aprovação é registro de uma
   conversa, e editar a fala de ontem para caber na decisão de hoje é
   exatamente o que o histórico existe para impedir.

   Apagar fica com o autor — e com admin, que precisa de um caminho para
   tirar o que foi colado por engano no cliente errado. */
create policy social_post_comments_delete on public.social_post_comments
  for delete to authenticated
  using (app.is_admin() or author_id = (select auth.uid()));
