/* =====================================================================
   Agendamento de relatório por cliente
   ---------------------------------------------------------------------
   Até aqui o relatório só saía quando alguém clicava. Este campo é o que
   permite ao cron saber DE QUEM é o relatório de hoje.

   Por que o dia mora no cliente e não numa tabela de agendamento: cada
   cliente tem um dia combinado em contrato e ele muda raramente. Uma
   tabela separada só faria sentido com múltiplos relatórios por cliente
   em cadências diferentes — que não é o caso, e dá para migrar depois
   sem perder dado.
   ===================================================================== */

alter table public.clients
  add column if not exists report_day smallint,
  add column if not exists report_enabled boolean not null default false;

/* 1 a 28, não 1 a 31.

   Fevereiro tem 28 dias: um cliente agendado para o dia 30 simplesmente
   NUNCA receberia relatório, e a falha seria silenciosa — nada quebra,
   o cron roda, e ninguém percebe até o cliente cobrar. O limite força a
   escolha de um dia que existe em todo mês. */
alter table public.clients
  drop constraint if exists clients_report_day_valid;

alter table public.clients
  add constraint clients_report_day_valid
  check (report_day is null or report_day between 1 and 28);

/* Ligar o envio sem dizer o dia deixaria o cliente num limbo: marcado
   como automático e nunca disparado. */
alter table public.clients
  drop constraint if exists clients_report_needs_day;

alter table public.clients
  add constraint clients_report_needs_day
  check (not report_enabled or report_day is not null);

comment on column public.clients.report_day is
  'Dia do mês (1-28) em que o relatório automático é gerado e enviado.';
comment on column public.clients.report_enabled is
  'Liga o envio automático. Exige report_day e whatsapp_phone preenchidos.';

-- O cron varre por dia; sem índice ele lê a tabela inteira todo dia.
create index if not exists clients_report_day_idx
  on public.clients (report_day)
  where report_enabled;

/* ---------------------------------------------------------------------
   Idempotência do disparo automático
   ---------------------------------------------------------------------
   O cron pode ser reexecutado (retry da Vercel, disparo manual de
   verificação, redeploy no mesmo minuto). Sem trava, o cliente recebe o
   mesmo relatório duas vezes no grupo — erro visível e constrangedor,
   do tipo que custa confiança.

   A trava é por (cliente, período, origem automática): reenvio manual
   continua permitido, porque às vezes é exatamente o que se quer.
   --------------------------------------------------------------------- */
alter table public.report_history
  add column if not exists is_automated boolean not null default false;

create unique index if not exists report_history_automated_unique
  on public.report_history (client_id, period_start, period_end)
  where is_automated;

comment on column public.report_history.is_automated is
  'true quando gerado pelo cron. Índice parcial impede envio duplicado do mesmo período.';
