-- =====================================================================
-- Faturamento real da loja (Magazord / BW Commerce)
-- ---------------------------------------------------------------------
-- ⚠️ RODAR ANTES DO DEPLOY. O relatório e a página do cliente passam a
-- consultar estas tabelas; sem elas, a consulta é recusada e as telas
-- caem para o comportamento antigo — mas o sync grava em tabela que não
-- existe e falha em silêncio.
--
-- POR QUE TABELA SEPARADA, e não colunas em `daily_metrics`.
-- `daily_metrics` é indexada por (cliente, PLATAFORMA, dia, campanha), e
-- `platform` é o enum `ad_platform`. A loja não é plataforma de anúncio:
-- enfiá-la ali a faria aparecer como canal de mídia no "de onde vieram
-- as vendas", disputando espaço com Meta e Google num quadro que mede
-- outra coisa.
--
-- ⚠️ E O FATURAMENTO DAQUI NÃO É O DO PIXEL. A Magazord entrega a loja
-- INTEIRA — orgânico, direto, marketplace, cliente recorrente. O pixel
-- entrega só o que o anúncio atribuiu. São dois números legítimos que
-- medem coisas diferentes, e somá-los ou trocá-los sem dizer produz um
-- retorno inflado. Ver `retorno-da-loja.ts`.
--
-- PEDIDO PAGO = TUDO MENOS "Em Análise" (1) E "Cancelado" (4).
-- Confirmado pelo Guilherme em 28/09/2026 e CONFERIDO contra o painel
-- da loja: setembro fechou em 150 pedidos e R$ 88.367,99 pelos dois
-- caminhos, centavo a centavo. Os status são configuráveis por loja —
-- por isso a lista vive em `status-pago.ts`, com teste de mesa, e não
-- espalhada em consulta.
-- =====================================================================

create table if not exists public.store_integrations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,

  -- Hoje só 'magazord'. Coluna em vez de enum porque a próxima
  -- plataforma de loja não deve exigir migration de tipo.
  provider    text not null default 'magazord',

  /* Base da API, SEM barra no fim. Ex.:
     https://atacadodepratascombr.api.bwcommerce.com.br
     ⚠️ É o host `.api.`, não o `.admin.` — o admin só redireciona. */
  base_url    text not null,

  is_active   boolean not null default true,

  /* Mesma semântica de `client_integrations`: `last_synced_at` só é
     escrito quando dado ENTRA. Escrever na falha foi o defeito que
     deixou 46 contas dizendo "sincronizado hoje" por quatro dias. */
  last_synced_at timestamptz,
  sync_error     text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (client_id, provider)
);

/* O token, longe de qualquer sessão.
   RLS LIGADA E ZERO POLICIES, de propósito — é o mesmo desenho de
   `integration_secrets`: só `service_role` alcança. Uma policy de
   leitura para `authenticated` aqui entregaria a chave da loja do
   cliente a qualquer pessoa logada no Elo Hub. */
create table if not exists public.store_secrets (
  integration_id uuid primary key
    references public.store_integrations (id) on delete cascade,
  /* Vai no cabeçalho `Token`, seco. `Authorization: Token` e `Bearer`
     devolvem "Falha na autenticação" — medido em 28/09/2026. */
  access_token   text not null,
  updated_at     timestamptz not null default now()
);

alter table public.store_secrets enable row level security;

/* Um dia por linha, por cliente.
   ⚠️ SEM `platform` NA CHAVE, ao contrário de `daily_metrics`: a loja é
   uma só. Acrescentar a coluna "por simetria" abriria a porta para duas
   linhas do mesmo dia somarem em dobro. */
create table if not exists public.store_daily (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  metric_date   date not null,

  /* Só pedidos PAGOS. O bruto não é guardado de propósito: duas colunas
     que se parecem viram a pergunta "qual das duas é o faturamento?"
     toda vez que alguém abrir a tabela. */
  orders_paid   integer not null default 0 check (orders_paid >= 0),
  revenue_cents bigint  not null default 0 check (revenue_cents >= 0),

  /* Cancelados e em análise, só para a equipe enxergar o que ficou de
     fora. NÃO entram em faturamento nem em ticket. Em setembro/2026
     foram 31 cancelados somando R$ 22.047 no Atacado de Pratas — um
     quarto do confirmado, e invisível sem esta coluna. */
  orders_dropped integer not null default 0 check (orders_dropped >= 0),

  synced_at     timestamptz not null default now(),

  unique (client_id, metric_date)
);

create index if not exists store_daily_lookup_idx
  on public.store_daily (client_id, metric_date desc);

/* ⚠️ TICKET MÉDIO NÃO É COLUNA. É receita ÷ pedidos pagos, calculado na
   leitura. Guardado, ele poderia discordar dos outros dois na mesma
   linha — e a pergunta "qual está certo?" não tem resposta boa. */

alter table public.store_integrations enable row level security;
alter table public.store_daily enable row level security;

drop policy if exists "store_integrations_read" on public.store_integrations;
drop policy if exists "store_integrations_write" on public.store_integrations;
drop policy if exists "store_daily_read" on public.store_daily;

create policy "store_integrations_read" on public.store_integrations for select
  using (app.can_access_client(client_id));

create policy "store_integrations_write" on public.store_integrations for all
  using (app.can_write_client(client_id))
  with check (app.can_write_client(client_id));

/* Leitura pela mesma fronteira do resto da conta. A ESCRITA não tem
   policy: quem grava é a sincronização, com `service_role`. */
create policy "store_daily_read" on public.store_daily for select
  using (app.can_access_client(client_id));

comment on table public.store_daily is
  'Faturamento diário da LOJA (todos os canais), vindo da Magazord — não confundir com daily_metrics.revenue_cents, que é a receita ATRIBUÍDA ao anúncio pelo pixel. Só pedidos pagos: tudo menos "Em Análise" e "Cancelado".';
