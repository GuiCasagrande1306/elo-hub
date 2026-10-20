/* =====================================================================
   NPS trimestral dos clientes
   ---------------------------------------------------------------------
   Cada cliente tem um link proprio (/pesquisa/<nps_token>). O token e a
   unica fechadura: a pagina publica le o cliente com service_role e
   grava a resposta pelo servidor, entao o visitante nunca alcanca o
   Postgres. Por isso a tabela de respostas nao tem policy de insert.

   Link por cliente, e nao um formulario com lista de nomes (como o
   checkin da MotoChefe): a lista exporia a carteira inteira a quem
   abrisse o link.

   Trocar o token (update clients set nps_token = ...) invalida o link
   antigo daquele cliente sem afetar os outros.
   ===================================================================== */

alter table public.clients
  add column if not exists nps_token text unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

update public.clients
   set nps_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where nps_token is null;

create table if not exists public.nps_responses (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  /* "2026-T4". Calculado no servidor pela data de Sao Paulo, nunca
     vindo do formulario. */
  trimestre     text not null check (trimestre ~ '^[0-9]{4}-T[1-4]$'),
  score         smallint not null check (score between 0 and 10),
  motivo        text,
  /* Notas de 1 a 5. Nulo = "nao se aplica" (cliente que nao contrata
     conteudo, por exemplo) - e diferente de nota baixa. */
  nota_resultados   smallint check (nota_resultados between 1 and 5),
  nota_comunicacao  smallint check (nota_comunicacao between 1 and 5),
  nota_conteudo     smallint check (nota_conteudo between 1 and 5),
  nota_relatorios   smallint check (nota_relatorios between 1 and 5),
  nota_estrategia   smallint check (nota_estrategia between 1 and 5),
  continuidade  text check (continuidade in ('sim', 'talvez', 'nao')),
  melhoria      text,
  respondente   text,
  submitted_at  timestamptz not null default now()
);

create index if not exists nps_responses_trimestre_idx
  on public.nps_responses (trimestre, submitted_at desc);
create index if not exists nps_responses_cliente_idx
  on public.nps_responses (client_id, submitted_at desc);

alter table public.nps_responses enable row level security;

drop policy if exists "nps_responses_admin_read" on public.nps_responses;
create policy "nps_responses_admin_read" on public.nps_responses for select
  using (app.is_admin());

/* Sem o grant o Postgres barra por privilegio antes de ler a policy
   (migrations 44 e 84). */
grant select on public.nps_responses to authenticated;

comment on table public.nps_responses is
  'Respostas do NPS trimestral. Gravadas so pelo servidor (service_role) a partir de /pesquisa/<clients.nps_token>; leitura so para admin.';
