/* =====================================================================
   Faturamento do GA4
   ---------------------------------------------------------------------
   GA4 NÃO ENTRA NO ENUM `ad_platform`. Seria o caminho óbvio e está
   errado: aquele enum é de plataformas de ANÚNCIO, e toda leitura que
   agrupa por ele pressupõe que existe gasto. O card "Canais — onde o
   orçamento foi alocado" passaria a listar GA4 com R$ 0,00 investidos e
   faturamento alto, que é informação falsa sobre alocação de verba.

   Vira COLUNA na mesma linha de métrica, ao lado de `revenue_cents`.

   AS DUAS RECEITAS NUNCA SE SOMAM. `revenue_cents` vem do
   `action_values` do pixel, que credita a venda a quem viu o anúncio e
   não deduplica entre canais; `revenue_ga4_cents` vem do GA4, que
   deduplica. São duas medições da MESMA venda, e somá-las dobraria o
   faturamento — o defeito que a soma de conversões acabou de eliminar.
   A tela escolhe uma; o filtro do card troca a escolha.

   `revenue_source` em `clients` guarda qual é a canônica daquela conta.
   Sem esse padrão, toda visita começaria na fonte errada e alguém
   trocaria o filtro dez vezes por dia.
   ===================================================================== */

alter table public.daily_metrics
  add column if not exists revenue_ga4_cents bigint not null default 0;

comment on column public.daily_metrics.revenue_ga4_cents is
  'Receita medida pelo GA4, em centavos. NUNCA somar com revenue_cents: são a mesma venda medida por duas fontes.';


/* ---------------------------------------------------------------------
   Property ID — identificador PRÓPRIO do GA4

   Não é o Customer ID do Google Ads nem o `act_` da Meta: vem de
   analytics.google.com e é um número de propriedade. Por isso coluna
   nova em vez de reaproveitar `external_account_id` de
   `client_integrations` — a integração do Google Ads já ocupa aquela
   linha para outra coisa, e um cliente tem os dois ao mesmo tempo.
   ------------------------------------------------------------------ */

alter table public.clients
  add column if not exists ga4_property_id text;

comment on column public.clients.ga4_property_id is
  'ID da propriedade do GA4 (analytics.google.com). NULL = conta sem GA4.';


/* ---------------------------------------------------------------------
   Fonte canônica de faturamento, por cliente
   ------------------------------------------------------------------ */

alter table public.clients
  add column if not exists revenue_source text not null default 'ads';

do $$
begin
  alter table public.clients
    add constraint clients_revenue_source_valid
    check (revenue_source in ('ads', 'ga4'));
exception
  when duplicate_object then null;
end $$;

comment on column public.clients.revenue_source is
  'Fonte padrão do faturamento: ads = pixel dos gerenciadores, ga4 = Analytics. O filtro do card troca pontualmente; isto define onde a tela abre.';

/* Default 'ads' e não 'ga4': é o que já existe hoje e o que está
   correto para toda conta sem GA4 configurado. Trocar exige ato
   explícito, cliente a cliente. */
