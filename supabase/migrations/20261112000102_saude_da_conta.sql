/* Saúde do resultado da conta, marcada a cada rodada da esteira.

   Fica NA LINHA da otimização, e não em `clients`, de propósito: o
   pedido é ver a evolução ao longo dos meses. Uma coluna no cliente
   guardaria só o estado de agora e apagaria o anterior a cada troca.

   Nula = não marcada (todas as rodadas antigas). O grant de update da
   migration 36 é da tabela inteira, então a coluna nova já é editável
   pelas mesmas policies. */
alter table public.optimization_history
  add column if not exists account_health text
    check (account_health is null or account_health in ('green', 'yellow', 'red'));

comment on column public.optimization_history.account_health is
  'Saúde do resultado da conta nesta rodada: green, yellow ou red. Null = não marcada.';
