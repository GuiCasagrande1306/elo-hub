/* =====================================================================
   Relatório semanal, além do mensal
   ---------------------------------------------------------------------
   O agendamento só entendia DIA DO MÊS: `report_day` de 1 a 28, e o cron
   casava com o dia do calendário. Quem quisesse o relatório toda sexta
   não tinha como pedir.

   ⚠️ A JANELA PRECISA ACOMPANHAR A CADÊNCIA, e é isso que torna a
   mudança mais do que uma coluna nova. O disparo monta o período com
   `janelaAte(ontem, 30)` — fixo. Um cliente semanal recebendo sempre os
   últimos 30 dias leria quatro relatórios quase idênticos por mês, com
   os mesmos números e as mesmas campanhas, variando só as pontas. O
   relatório semanal cobre 7 dias; o mensal segue em 30.

   POR QUE DUAS COLUNAS e não uma só reinterpretada: "dia 5" e
   "sexta-feira" são domínios diferentes (1–28 contra 0–6), e guardá-los
   no mesmo campo obrigaria todo leitor a consultar a frequência antes de
   saber o que o número significa. Com colunas separadas, um `check`
   garante que a que importa está preenchida — e a outra fica nula, o que
   já é a documentação do que aquele cliente usa.

   `report_frequency` tem DEFAULT 'monthly': toda conta existente
   continua exatamente como estava, sem UPDATE de dados.
   ===================================================================== */

alter table public.clients
  add column if not exists report_frequency text not null default 'monthly',
  add column if not exists report_weekday   smallint;

comment on column public.clients.report_frequency is
  'monthly = envia no dia report_day, janela de 30 dias. weekly = envia no report_weekday, janela de 7 dias.';
comment on column public.clients.report_weekday is
  'Dia da semana do envio semanal, 0=domingo a 6=sábado — a mesma convenção de Date.getDay().';

do $$
begin
  alter table public.clients
    add constraint clients_report_frequency_valid
    check (report_frequency in ('monthly', 'weekly'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  /* 0 a 6, como `Date.getDay()` e como `extract(dow)` do Postgres — as
     duas convenções coincidem, então não há conversão em lugar nenhum. */
  alter table public.clients
    add constraint clients_report_weekday_valid
    check (report_weekday is null or report_weekday between 0 and 6);
exception
  when duplicate_object then null;
end $$;

/* ------------------------------------------------------------------ */
/* A trava do envio automático passa a olhar a frequência              */
/* ------------------------------------------------------------------ */

/* A constraint antiga era `not report_enabled or report_day is not null`
   — escrita quando só existia cadência mensal. Mantida como está, ela
   impediria ligar o automático de um cliente SEMANAL, que legitimamente
   tem `report_day` nulo: a tela ofereceria o interruptor e o banco
   recusaria, com erro de constraint chegando cru ao usuário. */

alter table public.clients
  drop constraint if exists clients_report_needs_day;

alter table public.clients
  add constraint clients_report_needs_day
  check (
    not report_enabled
    or (report_frequency = 'monthly' and report_day is not null)
    or (report_frequency = 'weekly'  and report_weekday is not null)
  );

/* O índice antigo só cobre o caminho mensal. O disparo diário passa a
   consultar também por dia da semana, e sem índice varreria a carteira
   inteira a cada rodada. */
create index if not exists clients_report_weekday_idx
  on public.clients (report_weekday)
  where report_enabled and report_frequency = 'weekly';
