-- =====================================================================
-- ELO HUB — 0003_realtime_storage.sql
-- Publicação Realtime, buckets de Storage e templates padrão.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. REALTIME
--
-- IMPORTANTE: o Supabase Realtime respeita RLS no broadcast. Um
-- colaborador só recebe o evento de uma tarefa se a policy de SELECT
-- daquela linha o autoriza — o mesmo filtro do REST, aplicado ao
-- WebSocket. Não há canal "privilegiado" vazando mudança alheia.
--
-- REPLICA IDENTITY FULL é necessário para que os eventos de UPDATE/DELETE
-- tragam o registro `old` completo; sem isso o Realtime só envia a PK e
-- a checagem de RLS no evento de DELETE não tem colunas para avaliar.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'tasks','task_assignees','task_checklist_items','task_comments',
    'projects','clients','report_history','daily_metrics'
  ] loop
    execute format('alter table public.%I replica identity full', t);

    -- Idempotente: ignora se a tabela já está na publicação.
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'Publicação supabase_realtime inexistente — rodando fora do Supabase?';
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. STORAGE
--   report-pdfs → relatórios gerados (privado, servido por signed URL)
--   ad-thumbs   → miniaturas de criativos (as URLs da Meta expiram em
--                 poucas horas; copiamos para cá na sincronização)
--   brand       → logos dos clientes
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('report-pdfs', 'report-pdfs', false, 52428800,  array['application/pdf']),
  ('ad-thumbs',   'ad-thumbs',   false, 10485760,  array['image/png','image/jpeg','image/webp']),
  ('brand',       'brand',       true,   5242880,  array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Convenção de caminho: <client_id>/<arquivo>. A primeira pasta do path
-- é o UUID do cliente, então a autorização reaproveita can_access_client.
create policy "storage_reports_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'report-pdfs'
    and app.can_access_client(nullif(split_part(name, '/', 1), '')::uuid)
  );

create policy "storage_ads_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'ad-thumbs'
    and app.can_access_client(nullif(split_part(name, '/', 1), '')::uuid)
  );

create policy "storage_brand_read" on storage.objects for select to authenticated
  using (bucket_id = 'brand');

create policy "storage_brand_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand'
    and app.can_write_client(nullif(split_part(name, '/', 1), '')::uuid)
  );

-- Upload de PDF e de thumbnails é feito pelo backend com service_role,
-- que ignora RLS por definição. Não há policy de INSERT para o cliente.

-- ---------------------------------------------------------------------
-- 3. TEMPLATES DE RELATÓRIO POR SEGMENTO
--    Os `sections` são interpretados pelo renderizador de PDF
--    (src/lib/reports/sections.tsx). Adicionar um bloco novo é
--    inserir um objeto aqui + um case no renderer.
-- ---------------------------------------------------------------------

insert into public.report_templates (name, description, segment, metrics, sections, is_default, theme)
values
(
  'E-commerce — Performance & ROAS',
  'Foco em receita, ROAS e ticket médio. Mostra a quebra por campanha e a galeria de criativos que mais venderam.',
  'ecommerce',
  array['spend','revenue','roas','results','cpa','aov'],
  '[
    {"type":"cover",          "title":"Relatório de Performance"},
    {"type":"kpi_grid",       "title":"Visão geral do período"},
    {"type":"trend_chart",    "title":"Evolução de investimento x receita", "options":{"series":["spend","revenue"]}},
    {"type":"platform_split", "title":"Distribuição por canal"},
    {"type":"campaign_table", "title":"Campanhas", "options":{"orderBy":"roas","limit":10}},
    {"type":"ad_gallery",     "title":"Criativos em destaque", "options":{"limit":6,"orderBy":"revenue"}},
    {"type":"insights",       "title":"Leitura do time"},
    {"type":"next_steps",     "title":"Próximos passos"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"gradient"}'::jsonb
),
(
  'Negócio Local — Geração de Contatos',
  'Voltado a serviços e varejo físico: volume de contatos, custo por contato e alcance geográfico.',
  'local_business',
  array['spend','results','cpa','reach','ctr'],
  '[
    {"type":"cover",          "title":"Relatório de Resultados"},
    {"type":"kpi_grid",       "title":"Resumo do mês"},
    {"type":"trend_chart",    "title":"Contatos por dia", "options":{"series":["results"]}},
    {"type":"platform_split", "title":"De onde vieram os contatos"},
    {"type":"ad_gallery",     "title":"Anúncios no ar", "options":{"limit":4,"orderBy":"results"}},
    {"type":"insights",       "title":"O que observamos"},
    {"type":"next_steps",     "title":"Plano para o próximo ciclo"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"solid"}'::jsonb
),
(
  'Lançamento — Captação & Conversão',
  'Estrutura por fase do lançamento (captação, aquecimento, carrinho), com CPL e CAC por etapa.',
  'launch',
  array['spend','leads','cpl','results','cpa','roas'],
  '[
    {"type":"cover",          "title":"Relatório de Lançamento"},
    {"type":"kpi_grid",       "title":"Números do lançamento"},
    {"type":"trend_chart",    "title":"Captação diária", "options":{"series":["results","spend"]}},
    {"type":"campaign_table", "title":"Performance por fase", "options":{"groupBy":"campaign","limit":15}},
    {"type":"ad_gallery",     "title":"Criativos de captação", "options":{"limit":8,"orderBy":"cpa"}},
    {"type":"insights",       "title":"Diagnóstico"},
    {"type":"next_steps",     "title":"Ajustes recomendados"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"gradient"}'::jsonb
),
(
  'Padrão — Visão Executiva',
  'Template genérico de uma página: os três KPIs principais, tendência e criativos ativos.',
  null,
  array['spend','results','cpa'],
  '[
    {"type":"cover",       "title":"Relatório de Mídia Paga"},
    {"type":"kpi_grid",    "title":"Indicadores"},
    {"type":"trend_chart", "title":"Evolução", "options":{"series":["spend","results"]}},
    {"type":"ad_gallery",  "title":"Anúncios ativos", "options":{"limit":4}},
    {"type":"next_steps",  "title":"Próximos passos"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"solid"}'::jsonb
)
on conflict do nothing;
