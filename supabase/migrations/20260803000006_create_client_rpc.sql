-- =====================================================================
-- ELO HUB — 20260803000006_create_client_rpc.sql
-- Criação de cliente em UMA transação
--
-- POR QUE UMA FUNÇÃO E NÃO TRÊS INSERTS
-- ---------------------------------------------------------------------
-- O formulário de novo cliente escreve em três tabelas: `clients`,
-- `client_goals` e `client_integrations`. Feito como três chamadas
-- separadas do frontend, qualquer falha no meio deixa lixo permanente:
-- um cliente sem meta (o card cai no estado "sem meta" sem ninguém
-- entender por quê) ou, pior, um cliente sem integração que o sync
-- ignora para sempre em silêncio.
--
-- Dentro de uma função, as três escritas compartilham a transação do
-- Postgres: ou tudo entra, ou nada entra.
--
-- SECURITY INVOKER (padrão) de propósito: a função roda com as
-- permissões de QUEM CHAMOU, então cada INSERT continua passando pelas
-- policies de RLS. `clients_insert` exige `app.is_admin()` — um
-- colaborador que chamasse esta RPC direto pelo PostgREST receberia
-- violação de policy, não um cliente criado.
--
-- SLUG
-- ---------------------------------------------------------------------
-- `clients.slug` é NOT NULL UNIQUE e o formulário não pede. Geramos a
-- partir do nome e resolvemos colisão com sufixo numérico — duas contas
-- chamadas "Silva Advocacia" são absolutamente normais numa agência, e
-- sem isso a segunda quebraria com erro de constraint.
-- =====================================================================

/**
 * Remove acentos sem depender da extensão `unaccent`.
 *
 * `unaccent` não vem habilitada por padrão em todo projeto Supabase, e
 * exigir uma extensão só para gerar slug seria acoplamento desnecessário.
 * `translate` cobre o português inteiro, que é o que importa aqui.
 *
 * Definida ANTES de quem a usa: o corpo plpgsql não resolve chamadas na
 * criação, mas deixar a dependência para depois é pedir para alguém
 * quebrar a ordem numa edição futura.
 */
create or replace function public.unaccent_fallback(p_text text)
returns text
language sql
immutable
strict
set search_path = pg_temp
as $$
  select translate(
    p_text,
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
    'aaaaaaeeeeiiiiooooouuuuyyncAAAAAAEEEEIIIIOOOOOUUUUYNC'
  );
$$;

grant execute on function public.unaccent_fallback(text) to authenticated;

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
