-- Painel do CS (pedido de 13/11/2026).
--
-- 1) cs_semana: o que foi feito com cada cliente NA SEMANA — relatório
--    de segunda, mensagem de quarta, mensagem de sexta e a reunião
--    preparada. Uma linha por cliente por semana (`semana` = a segunda-
--    feira, no fuso de São Paulo). Semana nova começa sem marcação.
create table if not exists public.cs_semana (
  client_id         uuid not null references public.clients (id) on delete cascade,
  semana            date not null check (extract(isodow from semana) = 1),
  relatorio_seg     boolean not null default false,
  mensagem_qua      boolean not null default false,
  mensagem_sex      boolean not null default false,
  reuniao_preparada boolean not null default false,
  updated_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at        timestamptz not null default now(),
  primary key (client_id, semana)
);

alter table public.cs_semana enable row level security;

-- Grant ANTES da policy: sem ele a policy nunca é avaliada.
grant select, insert, update, delete on public.cs_semana to authenticated;

drop policy if exists cs_semana_select on public.cs_semana;
drop policy if exists cs_semana_insert on public.cs_semana;
drop policy if exists cs_semana_update on public.cs_semana;

create policy cs_semana_select on public.cs_semana
  for select to authenticated
  using (app.client_is_visible(client_id));

create policy cs_semana_insert on public.cs_semana
  for insert to authenticated
  with check (app.client_is_visible(client_id));

create policy cs_semana_update on public.cs_semana
  for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

-- 2) cs_rotina: a rotina da semana de cada pessoa. Uma linha por item
--    concluído; desmarcar apaga a linha. Os itens vêm do código
--    (src/lib/cs/rotina.ts). Cada um só vê e mexe na própria.
create table if not exists public.cs_rotina (
  profile_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  semana     date not null check (extract(isodow from semana) = 1),
  item       text not null check (char_length(item) between 1 and 60),
  done_at    timestamptz not null default now(),
  primary key (profile_id, semana, item)
);

alter table public.cs_rotina enable row level security;

grant select, insert, delete on public.cs_rotina to authenticated;

drop policy if exists cs_rotina_select on public.cs_rotina;
drop policy if exists cs_rotina_insert on public.cs_rotina;
drop policy if exists cs_rotina_delete on public.cs_rotina;

create policy cs_rotina_select on public.cs_rotina
  for select to authenticated
  using (profile_id = (select auth.uid()));

create policy cs_rotina_insert on public.cs_rotina
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

create policy cs_rotina_delete on public.cs_rotina
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- Realtime: marcação de outra pessoa aparece no painel aberto.
alter publication supabase_realtime add table public.cs_semana;
