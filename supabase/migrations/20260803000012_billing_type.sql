/* =====================================================================
   Tipo de faturamento da conta de anúncios
   ---------------------------------------------------------------------
   O alerta de saldo só faz sentido em conta PRÉ-PAGA: nela existe
   crédito que acaba. Em conta pós-paga o gasto é faturado depois, e o
   campo `balance` da Meta significa dívida acumulada — o oposto de
   folga. Projetar "dias restantes" ali produziria um número que parece
   certo e está invertido.

   Marcar isso no banco, em vez de confiar na memória de quem cadastra,
   é o que impede o alerta de aparecer para a conta errada.

   O PADRÃO É 'postpaid', não 'prepaid'. Deliberado: conta nova entra
   sem alerta e alguém precisa marcá-la explicitamente. O erro nessa
   direção é silêncio; na outra, seria alarme falso — e alarme falso
   treina a equipe a ignorar a tela inteira.
   ===================================================================== */

create type public.billing_type as enum (
  'prepaid',   -- crédito pré-carregado; o saldo acaba
  'postpaid'   -- faturado depois; não há saldo a monitorar
);

alter table public.client_integrations
  add column if not exists billing_type public.billing_type
  not null default 'postpaid';

comment on column public.client_integrations.billing_type is
  'prepaid habilita o alerta de saldo. postpaid não tem crédito a esgotar.';

/* Índice parcial: a varredura de alertas só olha as pré-pagas, e elas
   tendem a ser minoria. */
create index if not exists client_integrations_prepaid_idx
  on public.client_integrations (client_id)
  where billing_type = 'prepaid' and is_active;
