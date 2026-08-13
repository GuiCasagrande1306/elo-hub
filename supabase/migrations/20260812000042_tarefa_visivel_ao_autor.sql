/* =====================================================================
   A policy que recusava era a de SELECT, não a de INSERT
   ---------------------------------------------------------------------
   SINTOMA, que durou várias tentativas: colaborador não criava tarefa;
   admin criava. A mensagem dizia `new row violates row-level security
   policy for table "tasks"`, e três correções seguidas afrouxaram
   `tasks_insert` — sem efeito nenhum, porque `tasks_insert` nunca foi o
   problema.

   O QUE ACONTECE DE VERDADE. A action faz
   `.insert({...}).select("id").single()`. O `.select()` encadeado leva o
   supabase-js a mandar `Prefer: return=representation`, e o PostgREST
   emite `INSERT ... RETURNING id`. Quando um INSERT tem RETURNING, o
   PostgreSQL aplica as policies de SELECT da tabela como WITH CHECK
   sobre a linha nova — e a mensagem de erro é A MESMA de uma violação de
   insert. Foi isso que despistou o diagnóstico do começo ao fim.

   POR QUE SÓ O COLABORADOR. `tasks_select` chama
   `app.can_access_task(id)`, que recebe apenas o ID e vai RELER as
   tabelas:

       app.is_admin()
       or exists (... from task_assignees where task_id = p_task ...)
       or exists (... from tasks t where t.id = p_task ...)

   O WITH CHECK roda ANTES de a linha existir, e a linha de
   `task_assignees` só nasce no `trg_task_autoassign`, que é AFTER
   INSERT — tarde demais. Os dois `exists` dão falso e sobra
   `app.is_admin()`: o único ramo que não depende da linha existir. Admin
   passa por ele. Colaborador não tem por onde passar.

   A CORREÇÃO é a policy olhar as COLUNAS DA PRÓPRIA LINHA em vez de
   reler a tabela por id. `created_by` está na tupla que está sendo
   inserida, então o ramo do autor é verdadeiro já na checagem
   pré-insert. Para leitura de linha existente o resultado é idêntico ao
   de antes — é a mesma regra, avaliada sem depender de um `select` que
   ainda não enxerga nada.

   `app.can_access_task` NÃO muda: ela continua correta para
   `task_checklist_items` e `task_comments`, que sempre se referem a uma
   tarefa que já existe. O problema é exclusivo de quem consulta a si
   mesmo durante o próprio INSERT.

   Verificado que a armadilha é só aqui: as outras duas tabelas inseridas
   com RETURNING — `social_posts` e `report_history` — usam
   `client_is_visible(client_id)`, que recebe uma COLUNA da linha nova e
   por isso é avaliável antes da inserção.
   ===================================================================== */

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using (
    /* Autor primeiro, e de propósito: é o único ramo que funciona
       durante o próprio INSERT, e é o caso mais comum na leitura. */
    created_by = (select auth.uid())
    or app.is_admin()
    or exists (
      select 1 from public.task_assignees ta
       where ta.task_id = id
         and ta.profile_id = (select auth.uid())
    )
  );

/* O UPDATE herda o mesmo raciocínio. Ele não sofre do problema do
   RETURNING — a linha já existe quando se edita —, mas manter as duas
   regras com a mesma forma evita que alguém veja uma tarefa e não possa
   editá-la, ou o contrário. */
drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks for update to authenticated
  using (
    created_by = (select auth.uid())
    or app.is_admin()
    or exists (
      select 1 from public.task_assignees ta
       where ta.task_id = id
         and ta.profile_id = (select auth.uid())
    )
  )
  with check (
    created_by = (select auth.uid())
    or app.is_admin()
    or exists (
      select 1 from public.task_assignees ta
       where ta.task_id = id
         and ta.profile_id = (select auth.uid())
    )
  );

comment on policy tasks_select on public.tasks is
  'Autor, admin ou atribuído. Olha as colunas da própria linha — reler a tabela por id falha durante o INSERT com RETURNING.';
