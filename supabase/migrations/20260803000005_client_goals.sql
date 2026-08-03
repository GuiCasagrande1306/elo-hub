-- =====================================================================
-- ELO HUB — 20260803000005_client_goals.sql
-- Metas por cliente e por período (Planejado vs. Executado)
--
-- DECISÃO DE MODELAGEM
-- ---------------------------------------------------------------------
-- Meta é um fato de PERÍODO, não do cliente. "A meta da Verdi é 200
-- leads" não quer dizer nada sem dizer de qual mês. Colunas soltas em
-- `clients` guardariam apenas a meta corrente e apagariam o histórico —
-- sem histórico não dá para responder "batemos a meta em julho?", que é
-- a pergunta da reunião de resultados.
--
-- O EXECUTADO NÃO É ARMAZENADO
-- ---------------------------------------------------------------------
-- `executed_budget` e `executed_results` são derivados de
-- `daily_metrics`, que já é a fonte da verdade do investimento e das
-- conversões. Gravá-los aqui criaria duas fontes para o mesmo número:
-- o sync atualiza uma, alguém esquece de atualizar a outra, e o card
-- passa a mostrar um valor que o dashboard contradiz.
--
-- O que existe são OVERRIDES opcionais, para os casos legítimos em que
-- o número da plataforma está errado ou incompleto:
--   • a Meta contou 40 leads, mas 12 eram spam e o CRM confirmou 28;
--   • a venda fechou por telefone e não foi rastreada.
-- Quando preenchido, o override vence. Quando nulo, vale o calculado.
-- A regra fica em `app.resolve_goal_progress()`, para que tela e PDF
-- nunca discordem.
-- =====================================================================

create table public.client_goals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,

  -- Janela da meta. Normalmente o mês, mas nada impede um ciclo de
  -- lançamento de 45 dias.
  period_start  date not null,
  period_end    date not null,
  check (period_end >= period_start),

  -- PLANEJADO — digitado pelo gestor
  planned_budget_cents bigint        not null default 0 check (planned_budget_cents >= 0),
  planned_results      numeric(12,2) not null default 0 check (planned_results      >= 0),

  -- EXECUTADO — nulo = usar o valor calculado de daily_metrics
  executed_budget_cents_override bigint        check (executed_budget_cents_override >= 0),
  executed_results_override      numeric(12,2) check (executed_results_override      >= 0),
  override_reason text,

  notes       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Uma meta por cliente por período.
  unique (client_id, period_start)
);

create index client_goals_lookup_idx
  on public.client_goals (client_id, period_start desc);

create trigger trg_client_goals_touch
  before update on public.client_goals
  for each row execute function app.touch_updated_at();

comment on column public.client_goals.executed_budget_cents_override is
  'Preencher SÓ quando o número da plataforma estiver errado. Nulo = usar daily_metrics.';

-- ---------------------------------------------------------------------
-- RLS — mesma regra do cliente ao qual a meta pertence
-- ---------------------------------------------------------------------

alter table public.client_goals enable row level security;
alter table public.client_goals force  row level security;

grant select, insert, update, delete on public.client_goals to authenticated;

create policy client_goals_select on public.client_goals for select to authenticated
  using (app.can_access_client(client_id));

-- Definir meta é ato de gestão: exige nível editor/manager na conta.
create policy client_goals_write on public.client_goals for insert to authenticated
  with check (app.can_write_client(client_id));

create policy client_goals_update on public.client_goals for update to authenticated
  using (app.can_write_client(client_id))
  with check (app.can_write_client(client_id));

create policy client_goals_delete on public.client_goals for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- Resolução do progresso — fonte única para tela, card e PDF
-- ---------------------------------------------------------------------

create or replace function app.resolve_goal_progress(p_goal uuid)
returns table (
  planned_budget_cents  bigint,
  executed_budget_cents bigint,
  planned_results       numeric,
  executed_results      numeric,
  budget_is_override    boolean,
  results_is_override   boolean
)
language sql
stable
security invoker              -- respeita o RLS de quem chamou
set search_path = public, pg_temp
as $$
  select
    g.planned_budget_cents,
    coalesce(
      g.executed_budget_cents_override,
      (select coalesce(sum(m.spend_cents), 0)
         from public.daily_metrics m
        where m.client_id  = g.client_id
          and m.metric_date between g.period_start and g.period_end)
    ) as executed_budget_cents,
    g.planned_results,
    coalesce(
      g.executed_results_override,
      (select coalesce(sum(m.conversions), 0)
         from public.daily_metrics m
        where m.client_id  = g.client_id
          and m.metric_date between g.period_start and g.period_end)
    ) as executed_results,
    g.executed_budget_cents_override is not null,
    g.executed_results_override      is not null
  from public.client_goals g
  where g.id = p_goal;
$$;

grant execute on function app.resolve_goal_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
--
-- ⚠️ Depois de alterar a publicação, o serviço de Realtime leva alguns
-- minutos para começar a decodificar a tabela nova. Testar imediatamente
-- produz falso negativo — o canal conecta, o INSERT grava e nenhum
-- evento chega.
-- ---------------------------------------------------------------------

alter table public.client_goals replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'client_goals'
  ) then
    alter publication supabase_realtime add table public.client_goals;
    raise notice '[realtime] client_goals publicada';
  end if;
end $$;
