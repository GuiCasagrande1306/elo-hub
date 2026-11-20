-- Mensagens padrão do Painel do CS (pedido de 20/11/2026): três textos
-- que a equipe edita e copia para o grupo do cliente — segunda
-- (relatório), quarta (ideia de criativo / como estão os leads) e sexta
-- (leads ou acompanhamento e próximos passos). Um texto por dia, o
-- mesmo para a equipe inteira.
create table if not exists public.cs_mensagens_padrao (
  dia        text primary key check (dia in ('seg', 'qua', 'sex')),
  texto      text not null default '' check (char_length(texto) <= 5000),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.cs_mensagens_padrao enable row level security;

-- Grant ANTES da policy: sem ele o Postgres recusa com 42501.
grant select, insert, update on public.cs_mensagens_padrao to authenticated;

drop policy if exists cs_mensagens_padrao_leitura on public.cs_mensagens_padrao;
drop policy if exists cs_mensagens_padrao_insert on public.cs_mensagens_padrao;
drop policy if exists cs_mensagens_padrao_update on public.cs_mensagens_padrao;

-- Equipe lê e edita; login de cliente não.
create policy cs_mensagens_padrao_leitura on public.cs_mensagens_padrao
  for select to authenticated
  using (app.role_of_user() <> 'client');

create policy cs_mensagens_padrao_insert on public.cs_mensagens_padrao
  for insert to authenticated
  with check (app.role_of_user() <> 'client');

create policy cs_mensagens_padrao_update on public.cs_mensagens_padrao
  for update to authenticated
  using (app.role_of_user() <> 'client')
  with check (app.role_of_user() <> 'client');
