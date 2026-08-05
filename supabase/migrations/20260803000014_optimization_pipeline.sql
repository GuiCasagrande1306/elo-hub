/* =====================================================================
   Esteira de otimizações
   ---------------------------------------------------------------------
   A rotina de tráfego pago é semanal e por conta: cada cliente tem um
   dia fixo em que alguém entra, mexe nas campanhas e registra o que
   fez. Sem esse registro, duas coisas se perdem — a prova de que a
   conta foi tocada, e o histórico que explica por que o número mudou.
   ===================================================================== */

/* --- 1. Dia da rotina ------------------------------------------------
   1 a 5, segunda a sexta. Sábado e domingo ficam de fora de propósito:
   otimização é trabalho de dia útil, e permitir o fim de semana criaria
   uma coluna na esteira que nunca teria ninguém para atender.

   NULL = cliente sem rotina definida. É estado legítimo (conta em
   onboarding, projeto pontual), não pendência. */
alter table public.clients
  add column if not exists optimization_day smallint;

alter table public.clients
  drop constraint if exists clients_optimization_day_valid;

alter table public.clients
  add constraint clients_optimization_day_valid
  check (optimization_day is null or optimization_day between 1 and 5);

comment on column public.clients.optimization_day is
  'Dia útil da rotina de otimização: 1=segunda … 5=sexta. NULL = sem rotina.';

create index if not exists clients_optimization_day_idx
  on public.clients (optimization_day)
  where optimization_day is not null;

/* --- 2. Histórico ---------------------------------------------------- */
create table if not exists public.optimization_history (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id)  on delete cascade,

  /* Quem fez. `set null` em vez de cascade: se a pessoa sai da agência,
     o registro do que foi feito na conta PRECISA sobreviver — é ele que
     explica a variação do mês seguinte. */
  collaborator_id uuid references public.profiles (id) on delete set null,

  notes           text not null check (btrim(notes) <> ''),
  report_sent     boolean not null default false,

  /* Projeção de atingimento da meta, em porcentagem. `numeric` e não
     inteiro: 87,5% é uma leitura legítima, e arredondar aqui esconderia
     movimento pequeno entre semanas. */
  goal_projection numeric(6,2)
    check (goal_projection is null or goal_projection >= 0),

  created_at      timestamptz not null default now()
);

comment on table public.optimization_history is
  'Registro do que foi otimizado em cada conta, por rodada da esteira.';

-- A esteira lê sempre por cliente e do mais recente para o mais antigo.
create index if not exists optimization_history_client_idx
  on public.optimization_history (client_id, created_at desc);

-- "Feitos hoje" varre por data; sem isto seria varredura completa.
create index if not exists optimization_history_created_idx
  on public.optimization_history (created_at desc);

/* --- 3. RLS ----------------------------------------------------------
   Leitura e escrita seguem o acesso à CONTA, não o papel: quem atende o
   cliente registra o que fez nele. `app.can_access_client` já resolve
   admin, dono e membro numa função só.

   ⚠️ Não há policy de UPDATE nem DELETE, e é deliberado: histórico que
   se edita depois deixa de ser prova. Correção se faz com um registro
   novo, que preserva o que foi dito antes. */
alter table public.optimization_history enable row level security;

revoke all on public.optimization_history from anon, authenticated;
grant select, insert on public.optimization_history to authenticated;

drop policy if exists optimization_history_select on public.optimization_history;
drop policy if exists optimization_history_insert on public.optimization_history;

create policy optimization_history_select
  on public.optimization_history for select to authenticated
  using (app.can_access_client(client_id));

create policy optimization_history_insert
  on public.optimization_history for insert to authenticated
  with check (
    app.can_access_client(client_id)
    -- O autor não pode ser forjado: quem grava é quem está logado.
    and collaborator_id = (select auth.uid())
  );

/* Realtime: a esteira é usada por várias pessoas ao mesmo tempo, e duas
   otimizando a mesma conta sem saber é retrabalho puro. */
alter table public.optimization_history replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'optimization_history'
  ) then
    execute 'alter publication supabase_realtime add table public.optimization_history';
  end if;
end
$$;
