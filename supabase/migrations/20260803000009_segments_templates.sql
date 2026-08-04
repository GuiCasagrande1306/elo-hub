/* =====================================================================
   Segmentos reais da carteira + templates honestos
   ---------------------------------------------------------------------
   Duas mudanças, e a segunda é a que importa.

   1. O enum tinha 7 segmentos; a agência atende 4. Lançamento, SaaS,
      infoproduto e serviços B2B saem — dropdown com opção que ninguém
      usa é convite a classificar errado, e o segmento decide qual
      template entra no PDF.

   2. Os templates pediam métricas que O BANCO NÃO TEM. `daily_metrics`
      guarda cinco números: investimento, impressões, cliques,
      conversões e receita. Tudo o mais é derivado deles.

      O caso grave era `reach`: não existe coluna, e o código devolvia
      `impressões × 0,62` — um número INVENTADO, impresso como "Alcance"
      no relatório do cliente. Sai daqui e sai do código.
   ===================================================================== */

/* --- 1. Enum novo ---------------------------------------------------
   Postgres não remove valor de enum. O caminho é criar o tipo novo,
   converter as colunas e trocar. */

create type public.client_segment_new as enum (
  'ecommerce',      -- loja virtual: receita e ROAS mandam
  'delivery',       -- pedidos e conversas no WhatsApp
  'leads',          -- captação: custo por lead é o número da conta
  'local_business'  -- negócio físico: contatos e visitas
);

/* ORDEM IMPORTA, e não é óbvia:

   1. O índice único sai ANTES do ALTER. A expressão dele referencia
      'other'::client_segment, que deixa de existir — com o índice no
      lugar, o Postgres recusa converter a coluna.

   2. Os templates são apagados ANTES do ALTER. Todos serão
      substituídos, e convertê-los primeiro faria dois deles virarem
      'leads' com is_default — violando o índice na hora de recriá-lo.

   3. O índice só volta DEPOIS dos novos templates entrarem. */

-- Nome real vindo de 0001. Errar aqui é silencioso: `if exists` não
-- reclama, e a falha só aparece no ALTER seguinte com uma mensagem
-- sobre COALESCE que não menciona índice nenhum.
drop index if exists public.report_templates_default_idx;

delete from public.report_templates;

/* Cliente em segmento extinto vira 'leads': é o destino mais provável
   de lançamento, SaaS, infoproduto e B2B, que todos operam captação.
   Melhor um palpite explícito do que um NULL que quebraria a escolha de
   template depois. */
alter table public.clients
  alter column segment drop default;

alter table public.clients
  alter column segment type public.client_segment_new
  using (
    case segment::text
      when 'ecommerce'      then 'ecommerce'
      when 'local_business' then 'local_business'
      else 'leads'
    end
  )::public.client_segment_new;

alter table public.clients
  alter column segment set default 'leads'::public.client_segment_new;

alter table public.report_templates
  alter column segment type public.client_segment_new
  using (segment::text::public.client_segment_new);

/* A RPC de cadastro recebe o segmento como parâmetro, então depende do
   tipo e impede o DROP. Ela é recriada logo abaixo, idêntica, já com o
   enum novo — o corpo veio de 0006 sem alteração. */
drop function if exists public.create_client_with_setup(
  text, public.client_segment, public.client_status, text, citext,
  text, text, text, bigint, numeric, date, date, text, text
);

drop type public.client_segment;
alter type public.client_segment_new rename to client_segment;

/* --- 2. Rótulo por template -----------------------------------------
   O mesmo número — `conversions` — chama-se "Vendas" no e-commerce,
   "Pedidos" no delivery, "Leads" na captação e "Contatos" no negócio
   local. Sem isto o PDF diz "Resultados" para todo mundo, e o cliente
   não reconhece o próprio negócio no relatório. */
alter table public.report_templates
  add column if not exists metric_labels jsonb not null default '{}'::jsonb;

comment on column public.report_templates.metric_labels is
  'Sobrescreve o rótulo da métrica no PDF, por chave. Ex.: {"results":"Pedidos"}';

/* --- 3. Templates ----------------------------------------------------
   Métricas restritas ao que Meta E Google entregam:
     spend, impressions, clicks, conversions, revenue — e derivados
     (cpa, cpl, roas, ctr, cpc, cpm, aov).
   Nada de alcance, frequência ou engajamento: não vêm das duas APIs.
   A tabela já foi esvaziada antes do ALTER — ver nota de ordem acima. */

insert into public.report_templates
  (name, description, segment, metrics, metric_labels, sections, is_default, theme)
values
(
  'E-commerce — Receita & ROAS',
  'Para loja virtual: quanto entrou, quanto custou e qual o retorno sobre o investimento em mídia.',
  'ecommerce',
  array['spend','revenue','roas','results','cpa','aov'],
  '{"results":"Vendas","cpa":"Custo por venda","aov":"Ticket médio"}'::jsonb,
  '[
    {"type":"cover",          "title":"Relatório de Performance"},
    {"type":"kpi_grid",       "title":"Visão geral do período"},
    {"type":"trend_chart",    "title":"Investimento x receita", "options":{"series":["spend","revenue"]}},
    {"type":"platform_split", "title":"Distribuição por canal"},
    {"type":"ad_gallery",     "title":"Anúncios que mais venderam", "options":{"limit":6,"orderBy":"revenue"}},
    {"type":"insights",       "title":"Leitura do time"},
    {"type":"next_steps",     "title":"Próximos passos"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"gradient"}'::jsonb
),
(
  'Delivery — Pedidos & Custo',
  'Para operação de delivery: volume de pedidos e conversas geradas, e quanto custa cada um.',
  'delivery',
  array['spend','results','cpa','ctr','cpc'],
  '{"results":"Pedidos","cpa":"Custo por pedido"}'::jsonb,
  '[
    {"type":"cover",          "title":"Relatório de Resultados"},
    {"type":"kpi_grid",       "title":"Resumo do período"},
    {"type":"trend_chart",    "title":"Pedidos por dia", "options":{"series":["results"]}},
    {"type":"platform_split", "title":"De onde vieram os pedidos"},
    {"type":"ad_gallery",     "title":"Anúncios no ar", "options":{"limit":6,"orderBy":"results"}},
    {"type":"insights",       "title":"O que observamos"},
    {"type":"next_steps",     "title":"Plano para o próximo ciclo"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"solid"}'::jsonb
),
(
  'Leads — Captação & Custo por Lead',
  'Para captação: volume de leads, custo por lead e eficiência do criativo em gerar clique qualificado.',
  'leads',
  array['spend','leads','cpl','ctr','cpc','impressions'],
  '{"leads":"Leads","cpl":"Custo por lead"}'::jsonb,
  '[
    {"type":"cover",          "title":"Relatório de Captação"},
    {"type":"kpi_grid",       "title":"Resumo do período"},
    {"type":"trend_chart",    "title":"Leads por dia", "options":{"series":["results"]}},
    {"type":"platform_split", "title":"De onde vieram os leads"},
    {"type":"ad_gallery",     "title":"Criativos em destaque", "options":{"limit":6,"orderBy":"results"}},
    {"type":"insights",       "title":"Leitura do time"},
    {"type":"next_steps",     "title":"Próximos passos"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"gradient"}'::jsonb
),
(
  'Negócio Local — Contatos & Alcance de Mídia',
  'Para negócio físico: quantos contatos a mídia gerou, a que custo, e quanta gente foi impactada.',
  'local_business',
  array['spend','results','cpa','impressions','ctr','cpm'],
  '{"results":"Contatos","cpa":"Custo por contato","impressions":"Impressões"}'::jsonb,
  '[
    {"type":"cover",          "title":"Relatório de Resultados"},
    {"type":"kpi_grid",       "title":"Resumo do mês"},
    {"type":"trend_chart",    "title":"Contatos por dia", "options":{"series":["results"]}},
    {"type":"platform_split", "title":"De onde vieram os contatos"},
    {"type":"ad_gallery",     "title":"Anúncios no ar", "options":{"limit":6,"orderBy":"results"}},
    {"type":"insights",       "title":"O que observamos"},
    {"type":"next_steps",     "title":"Plano para o próximo ciclo"}
  ]'::jsonb,
  true,
  '{"accent":"#7BF178","cover":"solid"}'::jsonb
);

/* --- 4. Índice de unicidade de volta -------------------------------
   Um template padrão por segmento. Recriado por último: antes dos
   inserts a tabela estava vazia, e recriá-lo cedo não protegeria nada. */
create unique index report_templates_default_idx
  on public.report_templates ((coalesce(segment, 'leads'::public.client_segment)))
  where is_default and not is_archived;

/* --- 5. RPC de cadastro recriada com o enum novo ------------------- */

create or replace function public.create_client_with_setup(
  p_name              text,
  p_segment           public.client_segment,
  p_status            public.client_status,
  p_contact_name      text        default null,
  p_contact_email     citext      default null,
  p_whatsapp_phone    text        default null,
  p_website           text        default null,
  p_brand_primary     text        default null,
  -- Metas do ciclo. 0 = "não definir meta agora".
  p_planned_budget_cents bigint   default 0,
  p_planned_results      numeric  default 0,
  p_period_start      date        default null,
  p_period_end        date        default null,
  -- Integrações. NULL = configurar depois.
  p_meta_account_id   text        default null,
  p_google_customer_id text       default null
)
returns public.clients
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_base_slug  text;
  v_slug       text;
  v_suffix     int := 1;
  v_client     public.clients;
  v_start      date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end        date := coalesce(
                  p_period_end,
                  (date_trunc('month', current_date) + interval '1 month - 1 day')::date
                );
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'O nome da empresa é obrigatório.' using errcode = '22023';
  end if;

  -- --- slug ----------------------------------------------------------
  v_base_slug := regexp_replace(
    lower(unaccent_fallback(btrim(p_name))),
    '[^a-z0-9]+', '-', 'g'
  );
  v_base_slug := btrim(v_base_slug, '-');

  if v_base_slug = '' then
    v_base_slug := 'cliente';
  end if;

  v_slug := v_base_slug;

  -- Colisão de nome é normal; sufixa até achar um livre.
  while exists (select 1 from public.clients c where c.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  end loop;

  -- --- cliente -------------------------------------------------------
  insert into public.clients (
    name, slug, segment, status,
    contact_name, contact_email, whatsapp_phone, website, brand_primary,
    owner_id, created_by
  )
  values (
    btrim(p_name), v_slug, p_segment, p_status,
    nullif(btrim(coalesce(p_contact_name, '')), ''),
    p_contact_email,
    nullif(btrim(coalesce(p_whatsapp_phone, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_brand_primary, '')), ''),
    -- Quem cria vira gestor da conta: sem isso o próprio criador
    -- dependeria de client_members para enxergar o que acabou de criar.
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into v_client;

  -- --- meta do ciclo -------------------------------------------------
  if p_planned_budget_cents > 0 or p_planned_results > 0 then
    insert into public.client_goals (
      client_id, period_start, period_end,
      planned_budget_cents, planned_results, created_by
    )
    values (
      v_client.id, v_start, v_end,
      p_planned_budget_cents, p_planned_results, (select auth.uid())
    );
  end if;

  -- --- integrações ---------------------------------------------------
  if nullif(btrim(coalesce(p_meta_account_id, '')), '') is not null then
    insert into public.client_integrations (
      client_id, platform, external_account_id, display_name
    )
    values (v_client.id, 'meta_ads', btrim(p_meta_account_id), 'Meta Ads');
  end if;

  if nullif(btrim(coalesce(p_google_customer_id, '')), '') is not null then
    insert into public.client_integrations (
      client_id, platform, external_account_id, display_name
    )
    values (v_client.id, 'google_ads', btrim(p_google_customer_id), 'Google Ads');
  end if;

  return v_client;
end;
$$;

grant execute on function public.create_client_with_setup(
  text, public.client_segment, public.client_status,
  text, citext, text, text, text,
  bigint, numeric, date, date, text, text
) to authenticated;
