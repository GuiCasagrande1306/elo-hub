/* =====================================================================
   Tempo rastreado por tarefa
   ---------------------------------------------------------------------
   A coluna TEMPO ficou fora da lista até agora porque não havia dado
   por trás — mostrar `00:00:00` fixo seria a mesma armadilha do saldo
   simulado. Isto cria a origem.

   DOIS CAMPOS, não um:

     `tracked_seconds`  → tempo JÁ FECHADO, acumulado
     `timer_started_at` → instante em que o cronômetro corrente ligou,
                          ou NULL quando está parado

   Guardar só um total obrigaria o cliente a escrever no banco a cada
   segundo, ou a perder o tempo corrido se a aba fechasse. Com o par, o
   tempo em curso é sempre `agora − timer_started_at`, calculável por
   quem estiver olhando, e o banco só é tocado ao ligar e ao desligar.

   O relógio de referência é o do SERVIDOR (`now()` no start): relógio de
   máquina do usuário adiantado gravaria tempo negativo ao parar.

   `tracked_seconds` é INTEIRO em segundos, não interval nem float: a
   tela formata em h/m/s, e segundo fracionário não significa nada num
   registro de trabalho.
   ===================================================================== */

alter table public.tasks
  add column if not exists tracked_seconds integer not null default 0
    check (tracked_seconds >= 0),
  add column if not exists timer_started_at timestamptz;

comment on column public.tasks.tracked_seconds is
  'Tempo acumulado FECHADO, em segundos. Não inclui o cronômetro em curso.';

comment on column public.tasks.timer_started_at is
  'Quando o cronômetro corrente ligou. NULL = parado. O tempo em curso é now() - este valor.';

/* Fecha o cronômetro somando o que correu.
   ---------------------------------------------------------------------
   Em RPC e não no cliente porque a soma precisa do relógio do servidor:
   fazer a conta no navegador deixaria o total à mercê do relógio da
   máquina, e um relógio atrasado subtrairia tempo já trabalhado.

   `greatest(0, ...)` protege contra `timer_started_at` no futuro, que só
   aconteceria por corrupção — mas o resultado seria um total decrescente,
   e total que anda para trás destrói a confiança na coluna inteira. */
create or replace function public.stop_task_timer(p_task uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total integer;
begin
  update public.tasks
     set tracked_seconds = tracked_seconds
           + greatest(0, floor(extract(epoch from (now() - timer_started_at)))::integer),
         timer_started_at = null
   where id = p_task
     and timer_started_at is not null
  returning tracked_seconds into v_total;

  -- Já estava parado: devolve o total atual em vez de erro. Dois cliques
  -- seguidos no stop não podem quebrar a tela.
  if v_total is null then
    select tracked_seconds into v_total from public.tasks where id = p_task;
  end if;

  return coalesce(v_total, 0);
end;
$$;

comment on function public.stop_task_timer(uuid) is
  'Soma o tempo corrido ao acumulado e zera o cronômetro. Idempotente.';

grant execute on function public.stop_task_timer(uuid) to authenticated;
