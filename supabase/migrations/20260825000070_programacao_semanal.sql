/* =====================================================================
   Programação semanal: a pauta que se repete sozinha
   ---------------------------------------------------------------------
   O QUE ESTE MÓDULO RESOLVE. A carteira de conteúdo tem grade FIXA —
   medido em 25/08/2026, 11 clientes e 22 peças por semana, sempre nos
   mesmos dias:

     Brazzo Pizza             6/semana  dom ter qua qui sex sáb
     Way Coonecta             3/semana  seg qua sex
     Agenda Contabilidade     2/semana  ter qui
     LEOTEX Química           2/semana  seg sex
     D'Billys Burguer/Pizza   2/semana  ter qui
     Belz Cont, Capelari, Dispare, Feijoada, Pizzaria 7   1/semana  qua

   Sem isto, encher o mês seguinte é repetir 88 vezes o mesmo formulário
   — e o mês depois disso, de novo. A grade existe justamente para não
   se pensar nela toda semana.

   POR QUE MATERIALIZAR E NÃO DESENHAR FANTASMA. A alternativa era a
   grade calcular as ocorrências na hora, sem gravar nada. Ela quebra no
   primeiro uso real: a peça precisa receber arte, comentário, aprovação
   do cliente e mudança de dia — tudo coisa que só existe em linha de
   banco. Fantasma daria uma grade bonita e um calendário onde nada pode
   ser tocado.

   O PREÇO É A REGENERAÇÃO, e é onde mora o cuidado deste arquivo: mexer
   na programação não pode destruir trabalho já feito. Quem decide é
   `recurrence_id` mais o estado da peça — ver o comentário da coluna.
   ===================================================================== */

create table if not exists public.social_recurrences (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,

  /* 0 = domingo, como `Date.getDay()` e como as colunas da grade. Usar
     a convenção do JavaScript e não a do Postgres (`isodow`, 1 = segunda)
     porque quem lê este número é a tela, e converter no meio do caminho
     é como o dia entra errado. */
  weekday    smallint not null check (weekday between 0 and 6),

  /* "09:00". `text` e não `time`: é hora LOCAL de São Paulo, e `time`
     sem fuso convida a tratá-la como UTC — o erro que `agenda.ts`
     descreve e que faria a peça das 19h aparecer às 16h. A montagem do
     instante continua sendo de `montarAgendamento`, com o -03:00
     explícito. */
  hora       text not null default '09:00'
               check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  format     text not null default 'video_vertical' check (format in (
               'video_vertical', 'video_horizontal', 'imagem',
               'carrossel', 'stories', 'artigo'
             )),

  /* O nome que a peça nasce tendo. Vazio é legítimo: nem toda grade tem
     tema fixo, e "Vídeo" já diz o que precisa numa célula de calendário. */
  title      text not null default '',

  networks   text[] not null default array['instagram']::text[],

  /* Desligar sem apagar: cliente que pausa o contrato de conteúdo volta
     com a grade inteira, e apagar perderia a configuração. */
  is_active  boolean not null default true,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.social_recurrences is
  'Grade semanal fixa de conteúdo por cliente. Uma linha = uma peça por semana. O gerador materializa em social_posts.';

create index if not exists social_recurrences_cliente_idx
  on public.social_recurrences (client_id, weekday);

/* ---------------------------------------------------------------------
   O vínculo entre a peça e a linha da grade que a criou
   ------------------------------------------------------------------ */

alter table public.social_posts
  add column if not exists recurrence_id uuid
    references public.social_recurrences (id) on delete set null;

comment on column public.social_posts.recurrence_id is
  'Qual linha da programação semanal gerou esta peça. NULL = criada à mão. `on delete set null` de propósito: apagar a grade não pode apagar peça que já tem arte e aprovação.';

create index if not exists social_posts_recorrencia_idx
  on public.social_posts (recurrence_id, scheduled_at)
  where recurrence_id is not null;

/* ---------------------------------------------------------------------
   Quem pode ver e mexer

   MESMA REGRA DE `social_posts`, e por isso as actions não checam papel
   em lugar nenhum: a grade de um cliente é visível para quem enxerga
   aquele cliente. `app.client_is_visible` é a função que o módulo
   inteiro usa — `app.can_access_client` é de outra família de tabelas e
   trocar uma pela outra aqui abriria a grade para quem não vê o cliente.

   UMA POLICY POR COMANDO, e não um `for all` — a advertência está
   escrita na migration 33 e vale igual aqui: policies permissivas se
   somam com OU, então um `for all` largo tornaria impossível apertar o
   insert depois sem primeiro derrubar a policy antiga.
   ------------------------------------------------------------------ */

alter table public.social_recurrences enable row level security;

grant select, insert, update, delete on public.social_recurrences to authenticated;

drop policy if exists social_recurrences_select on public.social_recurrences;
drop policy if exists social_recurrences_insert on public.social_recurrences;
drop policy if exists social_recurrences_update on public.social_recurrences;
drop policy if exists social_recurrences_delete on public.social_recurrences;

create policy social_recurrences_select on public.social_recurrences
  for select to authenticated
  using (app.client_is_visible(client_id));

create policy social_recurrences_insert on public.social_recurrences
  for insert to authenticated
  with check (
    app.client_is_visible(client_id)
    and created_by = (select auth.uid())
  );

create policy social_recurrences_update on public.social_recurrences
  for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

create policy social_recurrences_delete on public.social_recurrences
  for delete to authenticated
  using (app.client_is_visible(client_id));

/* `updated_at` no mesmo padrão do resto do esquema. O `exception` cobre
   a re-execução da migration, como as três irmãs da 33. */
do $$
begin
  create trigger trg_social_recurrences_touch
    before update on public.social_recurrences
    for each row execute function app.touch_updated_at();
exception when duplicate_object then null;
end $$;
