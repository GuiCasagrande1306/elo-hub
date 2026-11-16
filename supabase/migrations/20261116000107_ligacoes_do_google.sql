-- Ligações do Google Ads (`metrics.phone_calls`), por campanha e dia.
--
-- O cartão "Ligações" do relatório contava a AÇÃO DE CONVERSÃO de
-- clique para ligar, e o Google Ads mostra na coluna "Ligações" as
-- chamadas recebidas pelos anúncios. Vivaz, 09–15/11/2026: relatório 0,
-- Google 7. As duas coisas continuam no relatório, cada uma com o nome
-- certo: "Ligações" (esta coluna) e "Cliques para ligar" (a ação).
--
-- `null` = não apurado (Meta, ou linha sincronizada antes desta
-- migration), nunca "zero ligações".
alter table public.daily_metrics
  add column if not exists phone_calls integer check (phone_calls is null or phone_calls >= 0);

comment on column public.daily_metrics.phone_calls is
  'Ligações recebidas pelos anúncios do Google (metrics.phone_calls). null = não apurado.';
