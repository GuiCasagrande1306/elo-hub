/* =====================================================================
   Colaborador não conseguia criar tarefa com cliente
   ---------------------------------------------------------------------
   SINTOMA em produção: "new row violates row-level security policy for
   table tasks" ao criar tarefa. Só para colaborador; admin passava.

   CAUSA. `tasks_insert` exigia `app.can_write_client(client_id)`, que só
   é verdadeira em três casos: ser admin, ter linha em `client_members`
   com nível editor/manager, ou ser `clients.owner_id`.

     • `client_members` está VAZIA — nenhuma tela do sistema atribui
       colaborador a cliente. O próprio código registra isso em
       `src/lib/data.ts` ("client_members está vazia hoje").
     • `owner_id` não é escrito em produção.

   Então, para todo colaborador, `can_write_client` era falsa em toda
   conta da carteira. Tarefa SEM cliente funcionava; com cliente, não —
   e a mensagem que chegava à tela era o texto cru do Postgres.

   O DESCOMPASSO É MAIS ANTIGO QUE O SINTOMA. Desde a migration 10 a
   carteira é legível por toda a equipe (`clients_select` é
   `using (true)`), e as migrations 16 e 18 seguiram nessa direção:
   otimização e métricas passaram a valer para o time inteiro. As
   policies de tarefa ficaram para trás, ainda pedindo um vínculo que o
   produto deixou de exigir — a tela oferece todas as contas no seletor
   e o banco recusa quase todas.

   A CORREÇÃO alinha tarefa com o resto: se a conta é visível, dá para
   pendurar tarefa nela. `created_by = auth.uid()` continua — a autoria
   nunca vem do formulário.

   `tasks_update` tinha o MESMO defeito por `can_access_client`: anexar
   um cliente a uma tarefa que já é sua falharia igual. Corrigir só o
   insert deixaria "criar funciona, editar não", que é pior que os dois
   quebrados, porque o erro passa a parecer aleatório.

   O QUE NÃO MUDA: `can_access_task` continua governando quem VÊ e quem
   EDITA a tarefa (admin, autor ou pessoa atribuída), e
   `task_assignees_insert` continua exigindo admin. Distribuir trabalho
   para terceiros segue sendo ato de administrador.

   ⚠️ `can_write_client` e `can_access_client` NÃO mudam: elas ainda
   guardam métricas, honorários e integrações, onde a regra estrita faz
   sentido. O que muda é quem tarefa consulta.
   ===================================================================== */

drop policy if exists tasks_insert on public.tasks;

/* ⚠️ ESTA POLICY FOI CORRIGIDA DEPOIS — ver migration 41.
   ---------------------------------------------------------------------
   A versão original deste arquivo exigia, além da autoria,
   `exists (select 1 from public.clients where id = client_id)`. Em
   produção isso continuou recusando o colaborador mesmo com a policy
   confirmada no banco, e o motivo exato nunca foi determinado; o que se
   sabe é que a condição não era necessária.

   O ARQUIVO FOI REESCRITO para o estado final em vez de manter o
   histórico fiel, e a razão é prática: enquanto ele guardasse a versão
   antiga, executá-lo — por engano, por uma integração que aplique
   migrations no push, ou num banco novo — RESSUSCITAVA o defeito. A 41
   só conserta quem roda as duas, na ordem. Um arquivo que reintroduz um
   bug conhecido é uma armadilha, não um registro. */
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    -- A autoria vem da sessão: `created_by` não pode ser forjado.
    created_by = (select auth.uid())
  );

drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks for update to authenticated
  using (app.can_access_task(id))
  with check (app.can_access_task(id));

comment on policy tasks_insert on public.tasks is
  'Qualquer pessoa da equipe cria tarefa em qualquer conta visível; a autoria vem da sessão.';

comment on policy tasks_update on public.tasks is
  'Edita quem enxerga a tarefa (admin, autor ou atribuído). O cliente de destino precisa existir.';
