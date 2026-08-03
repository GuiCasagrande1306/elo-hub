-- =====================================================================
-- ELO HUB — verificação de RLS
-- ---------------------------------------------------------------------
-- Prova, no próprio banco, que a regra crítica é obedecida:
-- um colaborador não enxerga tarefa nem cliente de outro.
--
-- Rodar no SQL Editor do Supabase (ou psql) com um papel que possa
-- alternar `request.jwt.claims` — o service_role faz isso.
--
--     psql "$DATABASE_URL" -f supabase/tests/rls.sql
--
-- Falha em qualquer asserção aborta com exceção. Nenhuma saída = passou.
-- Roda inteiro dentro de uma transação e faz ROLLBACK no fim: não deixa
-- resíduo no banco.
-- =====================================================================

begin;

-- --- Massa de teste ---------------------------------------------------
-- Os perfis são inseridos direto (sem passar por auth.users) porque o
-- objetivo aqui é exercitar as policies, não o fluxo de signup.
insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin@teste.com',  'Admin Teste',  'admin'),
  ('22222222-2222-2222-2222-222222222222', 'ana@teste.com',    'Ana Colab',    'collaborator'),
  ('33333333-3333-3333-3333-333333333333', 'bruno@teste.com',  'Bruno Colab',  'collaborator');

insert into public.clients (id, name, slug, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Cliente da Ana',   'cliente-ana',   '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Cliente do Bruno', 'cliente-bruno', '11111111-1111-1111-1111-111111111111');

-- Cada colaborador é membro de apenas um cliente.
insert into public.client_members (client_id, profile_id, access_level) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'editor'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'editor');

insert into public.tasks (id, client_id, title, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tarefa da Ana',   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Tarefa do Bruno', '11111111-1111-1111-1111-111111111111');

-- A trigger de auto-atribuição já vinculou as duas ao admin criador;
-- removemos para atribuir apenas ao colaborador de cada conta.
delete from public.task_assignees
 where profile_id = '11111111-1111-1111-1111-111111111111';

insert into public.task_assignees (task_id, profile_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333');

insert into public.daily_metrics (client_id, platform, metric_date, spend_cents) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'meta_ads', current_date, 10000),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'meta_ads', current_date, 20000);

-- --- Utilitários ------------------------------------------------------

/** Passa a executar como o usuário informado, sob RLS. */
create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
end $$;

create or replace function pg_temp.expect(
  p_label text, p_actual bigint, p_expected bigint
) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHOU: % — esperado %, obtido %',
      p_label, p_expected, p_actual;
  end if;
end $$;

-- =====================================================================
-- ADMIN — enxerga tudo
-- =====================================================================
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select pg_temp.expect('admin vê os 2 clientes', count(*), 2) from public.clients;
select pg_temp.expect('admin vê as 2 tarefas',  count(*), 2) from public.tasks;
select pg_temp.expect('admin vê as 2 métricas', count(*), 2) from public.daily_metrics;

-- =====================================================================
-- ANA — só o que é dela
-- =====================================================================
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select pg_temp.expect('Ana vê 1 cliente', count(*), 1) from public.clients;
select pg_temp.expect('Ana vê 1 tarefa',  count(*), 1) from public.tasks;

-- ⚠️ O ponto central: a tarefa do Bruno é INVISÍVEL para a Ana.
select pg_temp.expect(
  'tarefa do Bruno invisível para Ana', count(*), 0
) from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select pg_temp.expect(
  'cliente do Bruno invisível para Ana', count(*), 0
) from public.clients where id = 'aaaaaaaa-0000-0000-0000-000000000002';

select pg_temp.expect(
  'métricas do Bruno invisíveis para Ana', count(*), 0
) from public.daily_metrics
 where client_id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- Escrita cega: UPDATE numa linha invisível atinge zero linhas.
-- Não dá erro — simplesmente não acontece. É por isso que as Server
-- Actions podem confiar no banco em vez de checar permissão à mão.
do $$
declare v_count int;
begin
  with updated as (
    update public.tasks set title = 'invasão'
     where id = 'bbbbbbbb-0000-0000-0000-000000000002'
     returning 1
  )
  select count(*) into v_count from updated;

  if v_count <> 0 then
    raise exception 'FALHOU: Ana conseguiu alterar a tarefa do Bruno';
  end if;
end $$;

-- Perfis: Ana vê só o dela (não compartilha tarefa com ninguém).
select pg_temp.expect('Ana vê apenas o próprio perfil', count(*), 1)
  from public.profiles;

-- Tokens de integração continuam inacessíveis (RLS sem policy).
do $$
declare v_count int;
begin
  begin
    select count(*) into v_count from public.integration_secrets;
  exception when insufficient_privilege then
    v_count := -1;   -- sem GRANT: também é bloqueio válido
  end;

  if v_count > 0 then
    raise exception 'FALHOU: integration_secrets legível por colaborador';
  end if;
end $$;

-- =====================================================================
-- BRUNO — espelho da Ana
-- =====================================================================
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select pg_temp.expect('Bruno vê 1 cliente', count(*), 1) from public.clients;
select pg_temp.expect(
  'tarefa da Ana invisível para Bruno', count(*), 0
) from public.tasks where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- =====================================================================
-- Escalada de privilégio é bloqueada pela trigger
-- =====================================================================
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

update public.profiles
   set role = 'admin'
 where id = '22222222-2222-2222-2222-222222222222';

do $$
declare v_role public.user_role;
begin
  select role into v_role from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';

  if v_role <> 'collaborator' then
    raise exception 'FALHOU: colaborador conseguiu se promover a admin';
  end if;
end $$;

reset role;
rollback;

-- Se chegou até aqui sem exceção, todas as asserções passaram.
