/* =====================================================================
   Mensal e semanal deixam de ser modos e viram duas agendas
   ---------------------------------------------------------------------
   O QUE MUDA. `report_frequency` tratava as duas cadências como
   EXCLUSIVAS: a conta era mensal ou semanal, e a tela tinha um seletor
   para trocar. O pedido é ter as duas ao mesmo tempo — o cliente recebe
   o fechamento do mês E um acompanhamento toda segunda.

   O modelo novo não tem modo:

     report_day     preenchido → recebe todo mês, naquele dia
     report_weekday preenchido → recebe toda semana, naquele dia
     os dois         preenchidos → recebe os dois

   `report_enabled` continua sendo o interruptor geral, e agora exige
   apenas que exista PELO MENOS UMA das duas agendas.

   ⚠️ A JANELA DO MENSAL MUDA, e essa é a parte que altera o documento
   que chega ao cliente. Era "30 dias terminando ontem" — que num envio
   no dia 5 cobre do dia 6 do mês anterior ao dia 4 do corrente, ou seja
   atravessa dois meses. O cliente que recebe em setembro espera ler
   "agosto", e comparava com o próprio faturamento fechado do mês.

   Passa a ser o MÊS CIVIL ANTERIOR, completo: 1º a 31. É o que a frase
   "relatório mensal" promete, e é a única janela que casa com o que o
   cliente já tem fechado no caixa dele.

   O SEMANAL continua em 7 dias terminando ontem. Ali "últimos 7 dias" é
   exatamente o que se quer dizer, e semana civil (segunda a domingo)
   engessaria quem escolhe receber na quarta.

   NADA SE PERDE AO REMOVER `report_frequency`: medido em produção antes
   desta migration — 57 contas, todas em 'monthly', nenhuma com dia
   definido e nenhuma com envio ligado. A coluna guardava o default e
   mais nada.
   ===================================================================== */

/* A trava antiga amarrava a cadência ao campo. Sai primeiro: enquanto
   ela existir, a coluna não pode ser removida. */
alter table public.clients
  drop constraint if exists clients_report_needs_day;

alter table public.clients
  drop constraint if exists clients_report_frequency_valid;

/* O índice antigo tem `report_frequency` no predicado parcial e cairia
   junto com a coluna — melhor removê-lo explicitamente do que descobrir
   depois que a consulta do cron voltou a varrer a carteira inteira. */
drop index if exists clients_report_weekday_idx;

alter table public.clients
  drop column if exists report_frequency;

/* ------------------------------------------------------------------ */
/* As duas agendas, independentes                                      */
/* ------------------------------------------------------------------ */

comment on column public.clients.report_day is
  'Dia do mês (1-28) do relatório MENSAL, que cobre o mês civil anterior inteiro. NULL = sem agenda mensal.';
comment on column public.clients.report_weekday is
  'Dia da semana (0=domingo) do relatório SEMANAL, que cobre os últimos 7 dias. NULL = sem agenda semanal. Independente de report_day.';

/* Ligado exige ao menos uma agenda — sem nenhuma das duas, o cron não
   teria dia nenhum para disparar e o interruptor seria decorativo. */
alter table public.clients
  add constraint clients_report_needs_day
  check (
    not report_enabled
    or report_day is not null
    or report_weekday is not null
  );

/* Um índice por agenda. O disparo diário consulta as duas todo dia, e
   sem eles cada rodada varre a carteira duas vezes. */
drop index if exists clients_report_day_idx;

create index if not exists clients_report_day_idx
  on public.clients (report_day)
  where report_enabled and report_day is not null;

create index if not exists clients_report_weekday_idx
  on public.clients (report_weekday)
  where report_enabled and report_weekday is not null;
