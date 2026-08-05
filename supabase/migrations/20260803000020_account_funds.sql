/* =====================================================================
   Saldo disponível da conta de anúncios
   ---------------------------------------------------------------------
   A Graph API não entrega a carteira. Medido na conta do Nuur: a API
   devolveu `balance: 2334` (R$ 23,34, o acumulado A PAGAR) enquanto o
   painel mostrava R$ 341,77 de fundos disponíveis. Foram testados
   `prepay_balance`, `balance_percent_used`, `credit_limit`,
   `funding_source_details` e as edges `billing_transactions` e
   `payment_methods` — nenhum existe ou traz o número.

   A saída é registrar o saldo no momento da recarga e DESCONTAR o gasto
   desde então. O gasto vem de `daily_metrics`, que é real e sincronizado
   todo dia — então o número não congela: só a âncora é manual.

     disponível = funds_cents − (gasto de daily_metrics desde a data)

   `funds_recorded_at` é DATE e não timestamp de propósito: `metric_date`
   também é data, e comparar timestamp com data traria o dia da recarga
   inteiro ou nenhum, dependendo da hora. Contamos a partir do dia
   SEGUINTE — o gasto do próprio dia da recarga já estava lá quando a
   pessoa leu o número no painel.
   ===================================================================== */

alter table public.client_integrations
  add column if not exists funds_cents bigint
    check (funds_cents is null or funds_cents >= 0),
  add column if not exists funds_recorded_at date;

comment on column public.client_integrations.funds_cents is
  'Saldo disponível lido no painel da plataforma, em centavos. NULL = nunca informado.';

comment on column public.client_integrations.funds_recorded_at is
  'Dia em que funds_cents foi lido. O gasto posterior é descontado a partir do dia seguinte.';
