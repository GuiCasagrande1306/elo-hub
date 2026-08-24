/* =====================================================================
   A otimização passa a ter DIA
   ---------------------------------------------------------------------
   A esteira agora mostra, por dia, tudo que foi mexido na conta — o log
   vem da própria Meta (`/act_<id>/activities`) e é só leitura. O que a
   equipe escreve é a OBSERVAÇÃO daquele dia: o porquê, que é a única
   parte que a API não sabe.

   Para a observação pertencer a um dia, ela precisa ter um. Até aqui o
   único carimbo era `created_at`, o instante da gravação — e isso
   impede duas coisas que a tela nova pede: escrever hoje a observação
   de ontem, e casar a observação com o bloco de atividades certo.

   O DIA É O DE SÃO PAULO. `created_at::date` daria o dia de UTC, e uma
   otimização registrada às 22h de Brasília ficaria carimbada como do
   dia seguinte — justamente o horário em que boa parte da esteira roda.
   O backfill abaixo converte antes de cortar.

   SEM RESTRIÇÃO DE UNICIDADE, de propósito. Um par (cliente, dia) com
   dois registros já existe na base — conferido em 24/08/2026: 59
   registros, um único dia com dois. Impor unicidade agora exigiria
   fundir textos de duas pessoas para caber num modelo mais bonito, e o
   que se perderia é o registro do que cada uma fez. A tela mostra os
   dois no mesmo bloco, que é o comportamento pedido.
   ===================================================================== */

alter table public.optimization_history
  add column if not exists dia date;

/* Backfill convertendo para o fuso de Brasília antes de cortar a hora.
   `at time zone` duas vezes não é redundância: a primeira leva o
   timestamptz para o relógio de São Paulo, a segunda o devolve como
   timestamp sem fuso, que é o que `::date` corta corretamente. */
update public.optimization_history
   set dia = (created_at at time zone 'America/Sao_Paulo')::date
 where dia is null;

alter table public.optimization_history
  alter column dia set default (now() at time zone 'America/Sao_Paulo')::date;

alter table public.optimization_history
  alter column dia set not null;

comment on column public.optimization_history.dia is
  'Dia da otimização no fuso de São Paulo. É por ele que a esteira agrupa o bloco — não por created_at, que é o instante da gravação.';

/* A esteira lê por cliente, do dia mais recente para o mais antigo. */
create index if not exists optimization_history_client_dia_idx
  on public.optimization_history (client_id, dia desc);
