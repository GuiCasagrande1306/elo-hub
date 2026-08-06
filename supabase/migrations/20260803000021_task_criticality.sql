/* =====================================================================
   Criticidade 1–10 e cor pessoal na tarefa
   ---------------------------------------------------------------------
   `tasks` já tem `priority` (low/medium/high/urgent), usada na ordenação
   e nos selos do quadro. O pedido é uma escala de 1 a 10 — mais fina, e
   é a que a equipe quer usar no dia a dia.

   Manter as duas soltas seria o começo de uma divergência: alguém
   marcaria criticidade 9 numa tarefa "low" e as telas passariam a
   discordar entre si, cada uma lendo um campo. Como já vimos acontecer
   aqui com campo lido e nunca gravado, a saída é não deixar as duas
   editáveis: `criticality` vira a fonte, e um trigger DERIVA `priority`
   a partir dela. Nada no código precisa mudar de uma vez, e nada
   diverge no meio do caminho.

     1–3  → low        7–8  → high
     4–6  → medium     9–10 → urgent

   `color_tag` é organização PESSOAL, não estado da tarefa: guarda um
   token do tema (não hex solto), para as cores continuarem legíveis
   quando o usuário troca entre claro e escuro. Hex livre gravado por uma
   pessoa no tema claro vira mancha ilegível no escuro do colega.
   ===================================================================== */

alter table public.tasks
  add column if not exists criticality smallint not null default 5
    check (criticality between 1 and 10),
  add column if not exists color_tag text
    check (
      color_tag is null
      or color_tag in ('rosa', 'laranja', 'ambar', 'verde', 'azul', 'roxo', 'cinza')
    );

comment on column public.tasks.criticality is
  'Escala 1–10. FONTE DA VERDADE da importância; `priority` é derivada dela por trigger.';

comment on column public.tasks.color_tag is
  'Marcação pessoal de cor. Token do tema, não hex — hex escolhido no claro fica ilegível no escuro.';


/* Alinha o valor inicial: tarefas antigas ganham a criticidade
   equivalente à prioridade que já tinham, em vez do default 5. Sem
   isto, tudo que era "urgent" apareceria como médio no primeiro
   carregamento. */
update public.tasks
   set criticality = case priority
     when 'low'    then 2
     when 'medium' then 5
     when 'high'   then 8
     when 'urgent' then 10
   end
 where criticality = 5;


create or replace function public.sync_task_priority()
returns trigger
language plpgsql
as $$
begin
  new.priority := case
    when new.criticality <= 3 then 'low'
    when new.criticality <= 6 then 'medium'
    when new.criticality <= 8 then 'high'
    else 'urgent'
  end::public.task_priority;
  return new;
end;
$$;

comment on function public.sync_task_priority() is
  'Deriva tasks.priority de tasks.criticality. Impede que os dois campos divirjam.';

drop trigger if exists task_priority_sync on public.tasks;

create trigger task_priority_sync
  before insert or update of criticality on public.tasks
  for each row execute function public.sync_task_priority();
