/* =====================================================================
   Pix ou cartão: como a conta é recarregada
   ---------------------------------------------------------------------
   POR QUE ISTO É UM CAMPO E NÃO UMA LEITURA DA API.

   O pedido era ler a "Atividade de pagamento" da conta e rotular a
   forma. Foi procurado, e não existe no acesso que temos. Medido em
   19/08/2026 contra a conta da Looka Modas:

     • treze edges no ad account — transactions, billing_transactions,
       payment_transactions, invoices, receipts, payment_methods,
       adspaymentcycle, credit_cards, extendedcredits e outras: todas
       recusadas com "nonexisting field" ou "Unknown path components".
     • o objeto do funding source consultado pelo id: não existe.
     • no nível do Business, `credit_cards`, `extendedcredits` e
       `business_invoices` EXISTEM e voltam vazios — porque pertencem ao
       Business Manager do cliente, e nosso token administra apenas o
       nosso. O token tem `ads_read` e `business_management`; a Central
       de Cobrança é superfície de web, não de API.

   Então a forma de recarga vira cadastro: uma escolha por conta, feita
   uma vez. Ao contrário do saldo, ela não envelhece — cliente que paga
   por Pix não vira cartão sozinho.

   E ela MUDA O QUE O ALERTA SIGNIFICA, que é o motivo de existir:

     pix     saldo acabando = alguém precisa recarregar, hoje
     cartao  a conta se recarrega sozinha; o alerta só é urgente se a
             cobrança falhar — e é exatamente o que se vê na Looka
             Modas, com "Falha no pagamento da recarga automática" e
             R$ 38,74 para um ritmo de R$ 24,98/dia
   ===================================================================== */

alter table public.client_integrations
  add column if not exists recharge_method text
  check (recharge_method is null or recharge_method in ('pix', 'cartao'));

comment on column public.client_integrations.recharge_method is
  'Como a conta pré-paga é recarregada. NULL = ninguém informou. Não vem da API — ver a migration 51.';
