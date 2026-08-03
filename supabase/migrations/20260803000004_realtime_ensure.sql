-- =====================================================================
-- ELO HUB — 20260803000004_realtime_ensure.sql
--
-- A migration 0003 adiciona as tabelas à publicação `supabase_realtime`
-- dentro de um bloco `exception when undefined_object then null`. Isso
-- torna o push resiliente, mas cria um risco: se a publicação não
-- existisse naquele momento, as tabelas ficaram DE FORA em silêncio — e
-- o Realtime simplesmente nunca dispara, sem erro em lugar nenhum.
--
-- Esta migration fecha esse buraco: cria a publicação se faltar, publica
-- o que estiver faltando e RELATA o estado encontrado. É idempotente,
-- então pode rodar quantas vezes for preciso.
-- =====================================================================

do $$
declare
  v_tables text[] := array[
    'tasks', 'task_assignees', 'task_checklist_items', 'task_comments',
    'projects', 'clients', 'report_history', 'daily_metrics'
  ];
  v_missing text[];
  v_table   text;
begin
  -- 1. A publicação existe?
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice '[realtime] publicação NÃO existia — criada agora';
  else
    raise notice '[realtime] publicação supabase_realtime já existe';
  end if;

  -- 2. Quais tabelas ainda não estão publicadas?
  select array_agg(t)
    into v_missing
    from unnest(v_tables) as t
   where not exists (
     select 1
       from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
   );

  if v_missing is null then
    raise notice '[realtime] OK — todas as % tabelas já estavam publicadas',
      array_length(v_tables, 1);
  else
    raise notice '[realtime] FALTAVAM: % — publicando agora', v_missing;

    foreach v_table in array v_missing loop
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end loop;
  end if;

  -- 3. REPLICA IDENTITY FULL em todas.
  --    Sem isso, o evento de DELETE traz só a chave primária, e a checagem
  --    de RLS no broadcast não tem colunas para avaliar — o evento é
  --    descartado e o cliente nunca sabe que a linha sumiu.
  foreach v_table in array v_tables loop
    execute format('alter table public.%I replica identity full', v_table);
  end loop;

  raise notice '[realtime] replica identity full aplicada em todas as tabelas';
end $$;
