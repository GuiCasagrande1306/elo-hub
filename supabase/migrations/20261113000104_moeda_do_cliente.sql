-- Moeda das contas de anúncio do cliente (código ISO 4217: BRL, USD...).
--
-- A Meta e o Google devolvem gasto na moeda DA CONTA. Conta cadastrada
-- nos EUA (Marlenes Hair) gasta em dólar, e o painel escrevia "R$" na
-- frente do número em dólar. Não há conversão: o número já está certo,
-- só o símbolo mudava.
--
-- Quem preenche: o vínculo da conta (src/lib/ads/moeda-da-conta.ts)
-- pergunta a moeda à API e grava aqui e em client_integrations.currency.
-- A página do cliente e o relatório formatam com este valor.
alter table public.clients
  add column if not exists ad_currency text not null default 'BRL'
    check (ad_currency ~ '^[A-Z]{3}$');

comment on column public.clients.ad_currency is
  'Moeda das contas de anúncio (ISO 4217). Detectada pela API no vínculo da conta.';
