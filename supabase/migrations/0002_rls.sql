-- =====================================================================
-- ELO HUB — 0002_rls.sql
-- Row Level Security estrita.
--
-- REGRA DE NEGÓCIO:
--   admin        → leitura e escrita irrestritas em todo o sistema.
--   collaborator → enxerga EXCLUSIVAMENTE o que lhe foi atribuído.
--                  Não existe "vazamento lateral": um colaborador nunca
--                  vê tarefa, cliente, métrica ou relatório de outro.
--
-- POR QUE FUNÇÕES SECURITY DEFINER:
--   A policy de `clients` precisa consultar `client_members`, que por sua
--   vez tem RLS. Consultar direto dentro da policy gera recursão infinita
--   (erro 42P17). Encapsular a checagem numa função SECURITY DEFINER faz
--   a consulta rodar com o dono da função, ignorando RLS — e devolvendo
--   apenas um boolean. É o padrão recomendado pelo Supabase.
--
--   Todas são STABLE (cacheáveis dentro da query) e têm `search_path`
--   fixado, para não serem sequestradas por um schema malicioso.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FUNÇÕES DE AUTORIZAÇÃO
-- ---------------------------------------------------------------------

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'admin'
       and p.is_active
  );
$$;

-- Colaborador enxerga o cliente se: for o gestor da conta OU constar
-- explicitamente em client_members.
create or replace function app.can_access_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_client is not null and (
    app.is_admin()
    or exists (
      select 1 from public.client_members cm
       where cm.client_id = p_client
         and cm.profile_id = (select auth.uid())
    )
    or exists (
      select 1 from public.clients c
       where c.id = p_client
         and c.owner_id = (select auth.uid())
    )
  );
$$;

-- Escrita no cliente exige nível 'editor' ou 'manager'.
create or replace function app.can_write_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_client is not null and (
    app.is_admin()
    or exists (
      select 1 from public.client_members cm
       where cm.client_id = p_client
         and cm.profile_id = (select auth.uid())
         and cm.access_level in ('editor', 'manager')
    )
    or exists (
      select 1 from public.clients c
       where c.id = p_client and c.owner_id = (select auth.uid())
    )
  );
$$;

create or replace function app.can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_project is not null and (
    app.is_admin()
    or exists (
      select 1 from public.project_members pm
       where pm.project_id = p_project
         and pm.profile_id = (select auth.uid())
    )
    or exists (
      select 1 from public.projects pr
       where pr.id = p_project
         and pr.owner_id = (select auth.uid())
    )
  );
$$;

-- ⚠️ NÚCLEO DA REGRA CRÍTICA.
-- Um colaborador vê a tarefa SOMENTE se estiver em task_assignees
-- (ou se ele mesmo a criou — a trigger de auto-atribuição garante que
-- essas duas condições convergem). Ter acesso ao cliente NÃO basta:
-- é assim que se impede que colegas de conta vejam tarefas alheias.
--
-- Para afrouxar para visibilidade por projeto, adicionar aqui:
--   or app.can_access_project((select project_id from public.tasks where id = p_task))
create or replace function app.can_access_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_task is not null and (
    app.is_admin()
    or exists (
      select 1 from public.task_assignees ta
       where ta.task_id = p_task
         and ta.profile_id = (select auth.uid())
    )
    or exists (
      select 1 from public.tasks t
       where t.id = p_task
         and t.created_by = (select auth.uid())
    )
  );
$$;

-- Um perfil só é visível para quem compartilha ao menos uma tarefa com ele.
-- Evita que a base de colaboradores da agência vaze para qualquer logado.
create or replace function app.shares_task_with(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.task_assignees mine
      join public.task_assignees theirs on theirs.task_id = mine.task_id
     where mine.profile_id   = (select auth.uid())
       and theirs.profile_id = p_profile
  );
$$;

revoke all on function
  app.is_admin(), app.can_access_client(uuid), app.can_write_client(uuid),
  app.can_access_project(uuid), app.can_access_task(uuid), app.shares_task_with(uuid)
  from public;

grant execute on function
  app.is_admin(), app.can_access_client(uuid), app.can_write_client(uuid),
  app.can_access_project(uuid), app.can_access_task(uuid), app.shares_task_with(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- 2. HABILITAR RLS EM TUDO
--    FORCE garante que nem o dono da tabela escapa das policies.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','clients','client_members','client_integrations','integration_secrets',
    'projects','project_members','tasks','task_assignees','task_checklist_items',
    'task_comments','daily_metrics','ad_creatives','report_templates',
    'report_history','activity_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
  end loop;
end $$;

-- Sem grants não há acesso, independente de policy. `anon` fica de fora
-- de tudo: este é um sistema interno, não há leitura pública.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- 3. PROFILES
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or app.is_admin()
    or app.shares_task_with(id)
  );

create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Escalação de privilégio é barrada por trigger, não por subquery na
-- policy: dentro de um UPDATE, um `select` na própria tabela lê o
-- snapshot anterior e o comportamento fica sutil demais para confiar.
-- A trigger compara OLD/NEW diretamente — determinístico.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.is_admin() then
    return new;                     -- admin pode promover/desativar
  end if;
  new.role      := old.role;        -- colaborador nunca vira admin
  new.is_active := old.is_active;   -- nem se reativa sozinho
  return new;
end;
$$;

create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function app.guard_profile_privileges();

create policy profiles_admin_all on public.profiles for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------
-- 4. CLIENTES
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.clients to authenticated;

create policy clients_select on public.clients for select to authenticated
  using (app.can_access_client(id));

-- Criar cliente é prerrogativa de admin.
create policy clients_insert on public.clients for insert to authenticated
  with check (app.is_admin());

create policy clients_update on public.clients for update to authenticated
  using (app.can_write_client(id))
  with check (app.can_write_client(id));

create policy clients_delete on public.clients for delete to authenticated
  using (app.is_admin());

-- 4.1 client_members — atribuir pessoas a contas é ato administrativo.
grant select, insert, update, delete on public.client_members to authenticated;

create policy client_members_select on public.client_members for select to authenticated
  using (profile_id = (select auth.uid()) or app.is_admin());

create policy client_members_admin on public.client_members for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- 4.2 Integrações — metadados seguem o acesso ao cliente.
grant select on public.client_integrations to authenticated;

create policy client_integrations_select on public.client_integrations for select to authenticated
  using (app.can_access_client(client_id));

create policy client_integrations_admin on public.client_integrations for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- 4.3 integration_secrets: RLS ligada e ZERO policies ⇒ nega tudo.
--     Tokens só são lidos pelo backend via service_role.
--     (nenhum grant, nenhuma policy — intencional)

-- ---------------------------------------------------------------------
-- 5. PROJETOS
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.projects to authenticated;

create policy projects_select on public.projects for select to authenticated
  using (app.can_access_project(id));

create policy projects_insert on public.projects for insert to authenticated
  with check (app.can_write_client(client_id));

create policy projects_update on public.projects for update to authenticated
  using (app.can_access_project(id))
  with check (app.can_access_project(id));

create policy projects_delete on public.projects for delete to authenticated
  using (app.is_admin());

grant select, insert, update, delete on public.project_members to authenticated;

create policy project_members_select on public.project_members for select to authenticated
  using (profile_id = (select auth.uid()) or app.is_admin());

create policy project_members_admin on public.project_members for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------
-- 6. TAREFAS  ← regra crítica
-- ---------------------------------------------------------------------

grant select, insert, update, delete on public.tasks to authenticated;

create policy tasks_select on public.tasks for select to authenticated
  using (app.can_access_task(id));

-- Quem cria precisa ter escrita no cliente; created_by não pode ser forjado.
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (client_id is null or app.can_write_client(client_id))
  );

-- Um colaborador pode mover/editar a própria tarefa, mas não pode
-- transferi-la para um cliente ao qual não tem acesso.
create policy tasks_update on public.tasks for update to authenticated
  using (app.can_access_task(id))
  with check (
    app.can_access_task(id)
    and (client_id is null or app.can_access_client(client_id))
  );

create policy tasks_delete on public.tasks for delete to authenticated
  using (app.is_admin() or created_by = (select auth.uid()));

-- 6.1 Atribuições
grant select, insert, delete on public.task_assignees to authenticated;

create policy task_assignees_select on public.task_assignees for select to authenticated
  using (app.can_access_task(task_id));

-- Só admin distribui trabalho para terceiros. Um colaborador pode, no
-- máximo, se remover de uma tarefa que já enxerga.
create policy task_assignees_insert on public.task_assignees for insert to authenticated
  with check (app.is_admin());

create policy task_assignees_delete on public.task_assignees for delete to authenticated
  using (app.is_admin() or profile_id = (select auth.uid()));

-- 6.2 Checklist e comentários herdam a visibilidade da tarefa.
grant select, insert, update, delete on public.task_checklist_items to authenticated;

create policy task_checklist_all on public.task_checklist_items for all to authenticated
  using (app.can_access_task(task_id))
  with check (app.can_access_task(task_id));

grant select, insert, update, delete on public.task_comments to authenticated;

create policy task_comments_select on public.task_comments for select to authenticated
  using (app.can_access_task(task_id));

create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (app.can_access_task(task_id) and author_id = (select auth.uid()));

create policy task_comments_modify on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy task_comments_delete on public.task_comments for delete to authenticated
  using (app.is_admin() or author_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 7. MÉTRICAS
--    Escrita apenas pelo backend (service_role) durante o sync.
-- ---------------------------------------------------------------------

grant select on public.daily_metrics to authenticated;

create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (app.can_access_client(client_id));

grant select on public.ad_creatives to authenticated;

create policy ad_creatives_select on public.ad_creatives for select to authenticated
  using (app.can_access_client(client_id));

-- ---------------------------------------------------------------------
-- 8. RELATÓRIOS
-- ---------------------------------------------------------------------

-- Templates são configuração da agência, não dado de cliente:
-- todos leem, apenas admin escreve.
grant select on public.report_templates to authenticated;

create policy report_templates_select on public.report_templates for select to authenticated
  using (true);

create policy report_templates_admin on public.report_templates for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

grant select, insert, update on public.report_history to authenticated;

create policy report_history_select on public.report_history for select to authenticated
  using (app.can_access_client(client_id));

create policy report_history_insert on public.report_history for insert to authenticated
  with check (app.can_write_client(client_id) and generated_by = (select auth.uid()));

create policy report_history_update on public.report_history for update to authenticated
  using (app.can_write_client(client_id))
  with check (app.can_write_client(client_id));

create policy report_history_delete on public.report_history for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- 9. AUDITORIA — leitura restrita, escrita só pelo backend.
-- ---------------------------------------------------------------------

grant select on public.activity_log to authenticated;

create policy activity_log_select on public.activity_log for select to authenticated
  using (app.is_admin() or (client_id is not null and app.can_access_client(client_id)));

-- ---------------------------------------------------------------------
-- 10. DEFAULTS PARA TABELAS FUTURAS
--     Qualquer tabela nova nasce sem grants: nada vaza por esquecimento.
-- ---------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon, authenticated;
