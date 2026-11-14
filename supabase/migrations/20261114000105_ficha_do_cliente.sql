-- Ficha do cliente: o que a equipe precisa saber para atender a conta.
--
-- Página do cliente em abas (pedido de 13/11/2026): Mapa do Negócio,
-- metas de 30/60/90 dias, regras da conta, preferências de atendimento,
-- contatos, datas, acessos e ativos, pendências do cliente.
--
-- 1) `clients.ficha` (jsonb): tudo que é pequeno e muda pouco. Formato
--    em src/lib/clientes/ficha.ts. Escrita por ler-alterar-gravar no
--    servidor, uma seção por vez. Senha NUNCA entra aqui: em "acessos"
--    vai só ONDE a senha está guardada.
alter table public.clients
  add column if not exists ficha jsonb not null default '{}'::jsonb;

comment on column public.clients.ficha is
  'Ficha do cliente (mapa do negócio, regras, preferências, acessos...). Formato em src/lib/clientes/ficha.ts. Nunca guarda senha.';

-- 2) Linha do tempo: reuniões e mensagens importantes. Tabela própria
--    porque cresce sem limite — dentro de `clients` pesaria em toda
--    listagem que lê a tabela de clientes.
create table if not exists public.client_timeline (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  occurred_on date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  kind        text not null check (kind in ('reuniao', 'mensagem', 'decisao')),
  title       text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body        text check (body is null or char_length(body) <= 5000),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists client_timeline_client_idx
  on public.client_timeline (client_id, occurred_on desc, created_at desc);

alter table public.client_timeline enable row level security;

-- Grant ANTES da policy: sem ele a policy nunca é avaliada.
grant select, insert, update, delete on public.client_timeline to authenticated;

drop policy if exists client_timeline_select on public.client_timeline;
drop policy if exists client_timeline_insert on public.client_timeline;
drop policy if exists client_timeline_update on public.client_timeline;
drop policy if exists client_timeline_delete on public.client_timeline;

create policy client_timeline_select on public.client_timeline
  for select to authenticated
  using (app.client_is_visible(client_id));

-- O autor não pode ser forjado: quem grava é quem está logado.
create policy client_timeline_insert on public.client_timeline
  for insert to authenticated
  with check (app.client_is_visible(client_id) and created_by = (select auth.uid()));

create policy client_timeline_update on public.client_timeline
  for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

create policy client_timeline_delete on public.client_timeline
  for delete to authenticated
  using (app.client_is_visible(client_id));
