/* =====================================================================
   Prazo de tarefa deixa de nascer um dia atrasado
   ---------------------------------------------------------------------
   SINTOMA relatado: "as tarefas criadas sempre iniciam com a data de
   ontem". Marcar o prazo de HOJE no modal e ver "Atrasada 1d" no mesmo
   segundo.

   CAUSA. `tasks.due_date` é `timestamptz`, mas o que a interface manda é
   um DIA: o `<input type="date">` produz "2026-08-14" e a action gravava
   essa string crua. O Postgres completa a hora com o fuso da SESSÃO —
   UTC no PostgREST —, então o valor guardado vira

       2026-08-14T00:00:00+00:00   =   13/08 às 21h em São Paulo

   e todo lugar que converte para o fuso de quem usa (o calendário via
   `dataNoBrasil`, o selo de atraso via `formatDueDate`) lê o dia
   ANTERIOR. Medido em produção: as 17 linhas com prazo estavam, sem
   exceção, em `T00:00:00+00:00`.

   A CORREÇÃO NO CÓDIGO é gravar meio-dia de Brasília
   (`diaBRComoInstante`, em `src/lib/date-br.ts`). Meia-noite daqui
   consertaria o escritório e continuaria errada para quem abrisse o
   sistema mais a oeste; meio-dia tem doze horas de folga para cada lado.

   ESTA MIGRATION cuida do que já está gravado. Sem ela, todo prazo
   anterior à correção continuaria exibido um dia antes — e o defeito
   pareceria não ter sido corrigido, que é a pior forma de corrigir.

   POR QUE A DATA DE ORIGEM É LIDA EM UTC. Para estas linhas, a parte de
   data em UTC é literalmente o que o `<input type="date">` enviou: a
   hora é 00:00:00 em todas elas, então `(due_date at time zone 'UTC')`
   devolve exatamente o dia que a pessoa escolheu na tela. Ler em São
   Paulo, aqui, recuaria o dia mais uma vez e transformaria o conserto
   em segundo erro.

   IDEMPOTENTE. Uma linha já em meio-dia de Brasília tem data UTC igual
   ao próprio dia (15:00Z é 14/08 dos dois lados), então reprocessá-la
   devolve o mesmo instante. O `where` só evita a escrita inútil.
   ===================================================================== */

update public.tasks
   set due_date = (
         (due_date at time zone 'UTC')::date + interval '12 hours'
       ) at time zone 'America/Sao_Paulo'
 where due_date is not null
   and (due_date at time zone 'America/Sao_Paulo')::time <> time '12:00';

comment on column public.tasks.due_date is
  'Prazo, guardado como MEIO-DIA de America/Sao_Paulo. É um dia do calendário, não um instante: gravar a data crua faz o Postgres completar com a meia-noite UTC e o prazo aparece um dia antes. Use diaBRComoInstante() em src/lib/date-br.ts.';
