-- =====================================================================
-- ELO HUB — 20260803000007_financial.sql
-- Módulo financeiro: lançamentos, RLS restrita a admin, webhook idempotente
--
-- DIFERENÇA DE POSTURA EM RELAÇÃO AO RESTO DO SCHEMA
-- ---------------------------------------------------------------------
-- Em todas as outras tabelas o colaborador enxerga o que lhe foi
-- atribuído. Aqui não existe "o seu pedaço": faturamento, margem e
-- inadimplência são dados da SOCIEDADE, não da operação. A policy é
-- binária — `app.is_admin()` ou nada, nas quatro operações.
--
-- Um colaborador que chamar esta tabela pelo PostgREST recebe 401 com
-- 42501, não uma lista vazia. É intencional: lista vazia sugere "não há
-- lançamentos"; erro de privilégio diz a verdade, que é "não é seu".
-- =====================================================================

create type public.transaction_type as enum ('income', 'expense');

create type public.transaction_status as enum (
  'pending',    -- previsto, ainda não liquidado
  'paid',       -- baixado
  'canceled'    -- estornado ou cancelado
);

-- Categorias fechadas em enum, não texto livre: relatório financeiro
-- com "Mídia", "midia" e "Mídia paga" como categorias distintas é
-- inútil, e é o que sempre acontece com campo aberto.
create type public.transaction_category as enum (
  'client_fee',      -- honorário recorrente de cliente
  'project_fee',     -- projeto pontual
  'ad_spend',        -- verba de mídia repassada
  'salary',          -- folha
  'contractor',      -- freelancer / PJ
  'software',        -- ferramentas e assinaturas
  'office',          -- estrutura
  'tax',             -- impostos
  'other'
);

create table public.financial_transactions (
  id            uuid primary key default gen_random_uuid(),

  type          public.transaction_type     not null,
  category      public.transaction_category not null default 'other',
  status        public.transaction_status   not null default 'pending',

  -- Centavos, como todo dinheiro no sistema. Sempre POSITIVO: o sinal
  -- vem de `type`. Guardar despesa como negativo faz somas ingênuas
  -- "funcionarem" e esconde erro de classificação.
  amount_cents  bigint not null check (amount_cents > 0),

  description   text not null,
  -- Receita costuma ter cliente; despesa raramente tem.
  client_id     uuid references public.clients (id) on delete set null,

  due_date      date not null,
  paid_date     date,

  -- Consistência entre status e data de baixa, garantida pelo banco em
  -- vez de por disciplina da aplicação.
  constraint paid_needs_date
    check ((status = 'paid') = (paid_date is not null)),

  /* --- Conciliação com gateway de pagamento -----------------------
     `external_id` é a chave de idempotência do webhook. Gateways
     reenviam o mesmo evento várias vezes quando não recebem 200 — sem
     esta constraint, uma mensalidade entraria três vezes no caixa. */
  provider          text,
  external_id       text,
  provider_payload  jsonb,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique nulls not distinct (provider, external_id)
);

create index financial_due_idx     on public.financial_transactions (due_date desc);
create index financial_status_idx  on public.financial_transactions (status, type);
create index financial_client_idx  on public.financial_transactions (client_id)
  where client_id is not null;

create trigger trg_financial_touch
  before update on public.financial_transactions
  for each row execute function app.touch_updated_at();

comment on column public.financial_transactions.amount_cents is
  'Sempre positivo. O sinal do fluxo vem de `type`.';
comment on column public.financial_transactions.external_id is
  'Id do pagamento no gateway. Junto com `provider`, garante idempotência do webhook.';

-- ---------------------------------------------------------------------
-- RLS — admin e mais ninguém
-- ---------------------------------------------------------------------

alter table public.financial_transactions enable row level security;
alter table public.financial_transactions force  row level security;

grant select, insert, update, delete
  on public.financial_transactions to authenticated;

-- Uma policy FOR ALL: não há caso em que colaborador leia e não escreva,
-- ou vice-versa. Quatro policies separadas só criariam superfície para
-- alguém afrouxar uma delas sem perceber.
create policy financial_admin_only
  on public.financial_transactions
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------
-- Resumo mensal — uma consulta, doze meses
--
-- Agregar no Postgres em vez de trazer todos os lançamentos e somar em
-- JavaScript: o gráfico precisa de 12 números por série, não de 2.000
-- linhas cruzando a rede. `generate_series` garante que meses SEM
-- movimento apareçam zerados — sem isso o gráfico "pula" o mês vazio e
-- distorce a leitura de tendência.
-- ---------------------------------------------------------------------

create or replace function public.financial_monthly_summary(p_months int default 12)
returns table (
  month          date,
  income_cents   bigint,
  expense_cents  bigint,
  net_cents      bigint
)
language sql
stable
security invoker            -- respeita a policy acima
set search_path = public, pg_temp
as $$
  with meses as (
    select generate_series(
      date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval,
      date_trunc('month', current_date),
      '1 month'::interval
    )::date as month
  ),
  movimento as (
    select
      date_trunc('month', coalesce(t.paid_date, t.due_date))::date as month,
      sum(t.amount_cents) filter (where t.type = 'income')  as income_cents,
      sum(t.amount_cents) filter (where t.type = 'expense') as expense_cents
    from public.financial_transactions t
    where t.status = 'paid'
    group by 1
  )
  select
    m.month,
    coalesce(mv.income_cents, 0)::bigint,
    coalesce(mv.expense_cents, 0)::bigint,
    (coalesce(mv.income_cents, 0) - coalesce(mv.expense_cents, 0))::bigint
  from meses m
  left join movimento mv on mv.month = m.month
  order by m.month;
$$;

grant execute on function public.financial_monthly_summary(int) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

alter table public.financial_transactions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'financial_transactions'
  ) then
    alter publication supabase_realtime add table public.financial_transactions;
  end if;
end $$;
