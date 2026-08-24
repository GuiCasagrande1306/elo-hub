/* =====================================================================
   A hora combinada com o cliente
   ---------------------------------------------------------------------
   A agenda já sabia O DIA — `report_day` para o mensal, `report_weekday`
   para o semanal. Faltava a hora, e sem ela toda a carteira era
   preparada às 6h20, que é quando a Vercel dispara o único cron que o
   plano Hobby permite.

   Isso importa porque o relatório não é um arquivo: é uma conversa. O
   dono da pizzaria abre o painel às 9h; a loja que fecha o mês olha na
   segunda de manhã. Um PDF pronto às 6h20 espera três horas por alguém,
   e quem confere perde a referência de "o que saiu hoje".

   HORA CHEIA, sem minutos. A precisão que existe do outro lado é "de
   manhã" ou "depois do almoço" — minuto seria falsa exatidão, e ainda
   multiplicaria por sessenta as janelas que o gatilho precisa cobrir.

   8 COMO PADRÃO, e não a hora atual do cron. Toda conta já cadastrada
   passa a ser preparada às 8h em vez de 6h20 — perto do que era, dentro
   do expediente, e uma escolha explícita em vez de herdar o horário que
   só existia por limitação de plano.

   ⚠️ ISTO SOZINHO NÃO MUDA NADA. O gatilho precisa chamar
   `/api/cron/daily?etapa=envio` DE HORA EM HORA para a coluna ter
   efeito; com uma invocação diária, a hora é lida uma vez só e o resto
   é adiado para o dia seguinte. O agendamento pelo pg_cron do Supabase
   é entregue à parte, porque leva o CRON_SECRET dentro e este arquivo
   vai para um repositório público.
   ===================================================================== */

alter table public.clients
  add column if not exists report_hour smallint not null default 8
  check (report_hour between 0 and 23);

comment on column public.clients.report_hour is
  'Hora de São Paulo em que o relatório é preparado (0–23). Vale para as duas cadências. Sem gatilho horário chamando ?etapa=envio, a coluna não tem efeito — ver migration 67.';

/* O disparo pergunta "quem é deste dia E desta hora". Sem o índice, é
   uma varredura na carteira inteira a cada hora do dia. */
create index if not exists clients_agenda_mensal_idx
  on public.clients (report_day, report_hour)
  where report_enabled and status = 'active';

create index if not exists clients_agenda_semanal_idx
  on public.clients (report_weekday, report_hour)
  where report_enabled and status = 'active';
