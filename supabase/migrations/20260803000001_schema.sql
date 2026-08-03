-- =====================================================================
-- ELO HUB — 0001_schema.sql
-- Estrutura relacional do sistema de gestão da agência 360.
--
-- Convenções adotadas em todo o schema:
--   • Dinheiro SEMPRE em centavos (bigint). Nunca float para moeda.
--   • Toda tabela de domínio carrega `client_id` quando o dado pertence
--     a um cliente — é o eixo de particionamento lógico do RBAC.
--   • Funções auxiliares vivem no schema `app` e são SECURITY DEFINER,
--     para que as policies de RLS não entrem em recursão infinita.
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- busca textual (clientes/tarefas)
create extension if not exists "citext";        -- e-mails/slugs case-insensitive

create schema if not exists app;
comment on schema app is 'Funções auxiliares de autorização. Não expor via PostgREST.';

-- ---------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS
-- ---------------------------------------------------------------------

create type public.user_role as enum ('admin', 'collaborator');

-- Nível de acesso de um colaborador DENTRO de um cliente já atribuído.
create type public.access_level as enum ('viewer', 'editor', 'manager');

create type public.client_status as enum ('lead', 'onboarding', 'active', 'paused', 'churned');

-- Segmento dirige qual template de relatório é sugerido por padrão.
create type public.client_segment as enum (
  'ecommerce', 'local_business', 'launch', 'saas', 'infoproduct', 'b2b_services', 'other'
);

create type public.project_status as enum ('planning', 'active', 'on_hold', 'done', 'archived');

create type public.task_status as enum ('backlog', 'todo', 'in_progress', 'review', 'done');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create type public.ad_platform as enum ('google_ads', 'meta_ads', 'tiktok_ads', 'linkedin_ads', 'organic');

create type public.report_status as enum ('draft', 'queued', 'generating', 'ready', 'sending', 'sent', 'failed');
create type public.delivery_channel as enum ('whatsapp', 'email', 'link');

-- ---------------------------------------------------------------------
-- 2. PERFIS  (espelho de auth.users)
-- ---------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        citext not null,
  full_name    text   not null default '',
  avatar_url   text,
  job_title    text,
  role         public.user_role not null default 'collaborator',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.role is
  'admin = acesso irrestrito. collaborator = apenas registros explicitamente atribuídos.';

create index profiles_role_idx on public.profiles (role) where is_active;

-- ---------------------------------------------------------------------
-- 3. CLIENTES
-- ---------------------------------------------------------------------

create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,                       -- nome fantasia
  legal_name         text,                                -- razão social
  tax_id             text,                                -- CNPJ/CPF
  slug               citext not null unique,
  segment            public.client_segment not null default 'other',
  status             public.client_status  not null default 'onboarding',

  -- Branding: alimenta o cabeçalho do dashboard e a capa do PDF.
  logo_url           text,
  brand_primary      text,                                -- hex (#RRGGBB)
  brand_secondary    text,
  brand_font         text,
  brand_guidelines   text,

  -- Contato e distribuição de relatório
  website            text,
  contact_name       text,
  contact_email      citext,
  whatsapp_phone     text,                                -- E.164: +5548999999999

  -- Persona / briefing estratégico (estrutura livre, versionável)
  persona            jsonb not null default '{}'::jsonb,

  -- Comercial
  monthly_fee_cents  bigint not null default 0 check (monthly_fee_cents >= 0),
  contract_start     date,
  contract_end       date,

  owner_id           uuid references public.profiles (id) on delete set null, -- gestor da conta
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index clients_status_idx  on public.clients (status);
create index clients_owner_idx   on public.clients (owner_id);
create index clients_name_trgm   on public.clients using gin (name gin_trgm_ops);

-- Pivô que define QUEM enxerga QUAL cliente. É a espinha dorsal do RLS.
create table public.client_members (
  client_id    uuid not null references public.clients  (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  access_level public.access_level not null default 'editor',
  created_at   timestamptz not null default now(),
  primary key (client_id, profile_id)
);

create index client_members_profile_idx on public.client_members (profile_id);

-- ---------------------------------------------------------------------
-- 4. INTEGRAÇÕES DE MÍDIA
--    Metadados ficam em `client_integrations` (legível por quem tem
--    acesso ao cliente). Tokens ficam em `integration_secrets`, tabela
--    trancada — SOMENTE service_role lê. Nenhuma policy é criada nela.
-- ---------------------------------------------------------------------

create table public.client_integrations (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  platform            public.ad_platform not null,
  external_account_id text not null,      -- ex.: "act_123456789" (Meta) ou "123-456-7890" (Google)
  display_name        text,
  currency            text not null default 'BRL',
  is_active           boolean not null default true,
  last_synced_at      timestamptz,
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, platform, external_account_id)
);

create table public.integration_secrets (
  integration_id uuid primary key references public.client_integrations (id) on delete cascade,
  access_token   text,
  refresh_token  text,
  expires_at     timestamptz,
  scopes         text[],
  updated_at     timestamptz not null default now()
);

comment on table public.integration_secrets is
  'RLS habilitada SEM nenhuma policy: nega tudo para anon/authenticated. Acesso apenas via service_role no servidor.';

-- ---------------------------------------------------------------------
-- 5. PROJETOS
-- ---------------------------------------------------------------------

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  description text,
  status      public.project_status not null default 'planning',
  color       text,
  starts_at   date,
  ends_at     date,
  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index projects_client_idx on public.projects (client_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create index project_members_profile_idx on public.project_members (profile_id);

-- ---------------------------------------------------------------------
-- 6. TAREFAS  (núcleo do módulo estilo Notion)
-- ---------------------------------------------------------------------

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients  (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete set null,

  title        text not null,
  -- Documento rich-text do TipTap, guardado como JSON estruturado
  -- (permite busca, diff e re-render server-side no PDF).
  content      jsonb not null default '{"type":"doc","content":[]}'::jsonb,

  status       public.task_status   not null default 'todo',
  priority     public.task_priority not null default 'medium',

  -- Ordenação fracionária: mover um card no Kanban é 1 UPDATE, não N.
  position     double precision not null default 1000,

  due_date     timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,

  -- Mantido por trigger a partir de task_checklist_items (0–100).
  progress     smallint not null default 0 check (progress between 0 and 100),

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index tasks_client_idx   on public.tasks (client_id);
create index tasks_project_idx  on public.tasks (project_id);
create index tasks_board_idx    on public.tasks (status, position);
create index tasks_due_idx      on public.tasks (due_date) where status <> 'done';
create index tasks_title_trgm   on public.tasks using gin (title gin_trgm_ops);

-- Pivô de atribuição. Para um colaborador, ESTA tabela é o que
-- determina a existência da tarefa: sem linha aqui, a tarefa não existe.
create table public.task_assignees (
  task_id     uuid not null references public.tasks    (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index task_assignees_profile_idx on public.task_assignees (profile_id);

create table public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  content    text not null,
  is_done    boolean not null default false,
  position   double precision not null default 1000,
  created_at timestamptz not null default now()
);

create index task_checklist_task_idx on public.task_checklist_items (task_id, position);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks    (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------
-- 7. MÉTRICAS DE MÍDIA PAGA
--    Granularidade dia × plataforma × campanha. Todos os KPIs do
--    dashboard e do PDF são agregações desta tabela.
-- ---------------------------------------------------------------------

create table public.daily_metrics (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  platform       public.ad_platform not null,
  metric_date    date not null,

  campaign_id    text not null default '_all',
  campaign_name  text,

  spend_cents    bigint not null default 0 check (spend_cents    >= 0),
  impressions    bigint not null default 0 check (impressions    >= 0),
  clicks         bigint not null default 0 check (clicks         >= 0),
  conversions    numeric(12,2) not null default 0 check (conversions >= 0),
  revenue_cents  bigint not null default 0 check (revenue_cents  >= 0),

  synced_at      timestamptz not null default now(),

  -- Idempotência: o job de sync roda com UPSERT nesta constraint.
  unique (client_id, platform, metric_date, campaign_id)
);

create index daily_metrics_lookup_idx on public.daily_metrics (client_id, metric_date desc);

-- Criativos ativos — alimentam a "Galeria de Anúncios" do PDF.
create table public.ad_creatives (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  platform       public.ad_platform not null,
  external_ad_id text not null,

  campaign_name  text,
  ad_name        text,
  thumbnail_url  text,          -- URL original da plataforma
  storage_path   text,          -- cópia no Supabase Storage (URLs da Meta expiram)
  destination_url text,

  headline       text,
  primary_text   text,
  call_to_action text,

  is_active      boolean not null default true,
  spend_cents    bigint  not null default 0,
  impressions    bigint  not null default 0,
  clicks         bigint  not null default 0,
  conversions    numeric(12,2) not null default 0,

  period_start   date,
  period_end     date,
  synced_at      timestamptz not null default now(),

  unique (client_id, platform, external_ad_id, period_start)
);

create index ad_creatives_client_idx on public.ad_creatives (client_id, is_active, spend_cents desc);

-- ---------------------------------------------------------------------
-- 8. RELATÓRIOS
-- ---------------------------------------------------------------------

create table public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- NULL = template genérico, aplicável a qualquer segmento.
  segment     public.client_segment,

  -- Blocos do relatório na ordem de renderização. Cada item:
  --   { "type": "cover" | "kpi_grid" | "trend_chart" | "platform_split"
  --           | "campaign_table" | "ad_gallery" | "insights" | "next_steps",
  --     "title": "...", "options": { ... } }
  sections    jsonb not null default '[]'::jsonb,

  -- KPIs em destaque, na ordem. Ex.: ["spend","results","cpa","roas"]
  metrics     text[] not null default array['spend','results','cpa'],

  -- Overrides visuais do PDF (cores, capa, assinatura).
  theme       jsonb not null default '{}'::jsonb,

  is_default  boolean not null default false,
  is_archived boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Garante no máximo um template padrão por segmento.
create unique index report_templates_default_idx
  on public.report_templates ((coalesce(segment, 'other'::public.client_segment)))
  where is_default and not is_archived;

create table public.report_history (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  template_id   uuid references public.report_templates (id) on delete set null,

  title         text not null,
  period_start  date not null,
  period_end    date not null,
  check (period_end >= period_start),

  status        public.report_status not null default 'queued',
  error_message text,

  -- Congela os números do momento da geração: o relatório enviado ao
  -- cliente nunca "muda" se a plataforma reprocessar dados depois.
  snapshot      jsonb not null default '{}'::jsonb,

  storage_path  text,          -- reports/<client_id>/<report_id>.pdf
  public_url    text,
  page_count    smallint,
  file_size     bigint,

  -- Distribuição
  channel          public.delivery_channel,
  recipient        text,       -- telefone E.164 ou e-mail
  delivered_at     timestamptz,
  provider_message_id text,

  generated_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index report_history_client_idx on public.report_history (client_id, created_at desc);
create index report_history_status_idx on public.report_history (status) where status in ('queued','generating','sending');

-- ---------------------------------------------------------------------
-- 9. AUDITORIA
-- ---------------------------------------------------------------------

create table public.activity_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  client_id   uuid references public.clients  (id) on delete cascade,
  entity      text not null,        -- 'task' | 'client' | 'report' ...
  entity_id   uuid,
  action      text not null,        -- 'created' | 'status_changed' | 'sent' ...
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activity_log_client_idx on public.activity_log (client_id, created_at desc);

-- =====================================================================
-- 10. TRIGGERS E AUTOMAÇÕES
-- =====================================================================

-- 10.1 updated_at automático -------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clients','client_integrations','projects','tasks',
    'report_templates','report_history'
  ] loop
    execute format(
      'create trigger trg_%1$s_touch before update on public.%1$s
         for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- 10.2 Provisionamento de perfil no signup -----------------------------
-- O PRIMEIRO usuário cadastrado vira admin (bootstrap da agência);
-- todos os seguintes entram como colaboradores.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
begin
  select case when exists (select 1 from public.profiles) then 'collaborator' else 'admin' end
    into v_role;

  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- 10.3 Progresso da tarefa derivado do checklist -----------------------
create or replace function app.sync_task_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task uuid := coalesce(new.task_id, old.task_id);
  v_total int;
  v_done  int;
begin
  select count(*), count(*) filter (where is_done)
    into v_total, v_done
    from public.task_checklist_items
   where task_id = v_task;

  update public.tasks
     set progress = case when v_total = 0 then progress
                         else round((v_done::numeric / v_total) * 100) end,
         updated_at = now()
   where id = v_task;

  return null;
end;
$$;

create trigger trg_checklist_progress
  after insert or update of is_done or delete on public.task_checklist_items
  for each row execute function app.sync_task_progress();

-- 10.4 Carimbo de conclusão da tarefa ----------------------------------
create or replace function app.stamp_task_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and coalesce(old.status, 'todo') <> 'done' then
    new.completed_at := now();
    new.progress     := 100;
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at := null;
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_task_status_stamp
  before update of status on public.tasks
  for each row execute function app.stamp_task_status();

-- 10.5 Auto-atribuição do criador --------------------------------------
-- Sem isto, um colaborador criaria uma tarefa e a perderia de vista
-- imediatamente (o RLS de SELECT exige atribuição).
create or replace function app.autoassign_task_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not null then
    insert into public.task_assignees (task_id, profile_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_task_autoassign
  after insert on public.tasks
  for each row execute function app.autoassign_task_creator();
