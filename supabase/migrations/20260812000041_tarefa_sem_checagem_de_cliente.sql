/* =====================================================================
   Criar tarefa deixa de conferir o cliente no banco
   ---------------------------------------------------------------------
   ESTA MIGRATION EXISTE PARA O REPOSITÓRIO ALCANÇAR O BANCO. A correção
   foi aplicada à mão no SQL Editor em 12/08/2026, depois de duas
   tentativas fracassadas — sem ela aqui, rodar as migrations do zero
   recriaria a versão que não funciona, e foi exatamente assim que o
   problema chegou ao clone do Send Hub.

   HISTÓRICO, porque a causa foi difícil e vale não repetir a busca:

     1. A policy original exigia `app.can_write_client(client_id)`, que
        depende de `client_members` (tabela vazia, nenhuma tela escreve
        nela) ou de `clients.owner_id` (nunca preenchido em produção).
        Verdadeira só para admin. Sintoma: admin criava, colaborador não,
        e tarefa SEM cliente funcionava para todos.

     2. A migration 37 trocou aquilo por `exists (select 1 from clients
        where id = client_id)`. A leitura de `clients` é liberada para
        toda a equipe desde a migration 10 (`clients_select` é
        `using (true)`), então isso deveria bastar. Não bastou: com a
        policy confirmada no banco, o colaborador continuou recusado.

     3. Como `created_by = auth.uid()` é idêntico para admin e
        colaborador — e o admin passava —, a metade que falhava só podia
        ser o `exists`. O motivo exato de ele dar falso não foi
        determinado; o que se sabe é que a condição não era necessária.

   A REGRA AGORA é a que o negócio pede: qualquer pessoa da equipe cria
   tarefa em qualquer conta. A tela só oferece contas reais, então o que
   se perde é a recusa de um `client_id` inventado por chamada direta à
   API — e a coluna tem chave estrangeira para `clients`, que já barra id
   inexistente com erro de integridade.

   `created_by = auth.uid()` FICA. É o que impede criar tarefa em nome de
   outra pessoa, e não tem relação com o defeito.
   ===================================================================== */

drop policy if exists tasks_insert on public.tasks;

create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = (select auth.uid()));

/* SELECT e UPDATE continuam em `app.can_access_task`: admin vê tudo, e
   os demais veem o que criaram ou o que lhes foi atribuído. O gatilho
   `trg_task_autoassign` atribui quem cria, então a tarefa nasce visível
   para o autor. Recriados aqui porque a correção manual os tocou — o
   arquivo precisa descrever o estado final do banco, não um pedaço. */

drop policy if exists tasks_select on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using (app.can_access_task(id));

drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks for update to authenticated
  using (app.can_access_task(id))
  with check (app.can_access_task(id));

comment on policy tasks_insert on public.tasks is
  'Qualquer pessoa autenticada cria tarefa em qualquer conta; a autoria vem da sessão.';
comment on policy tasks_select on public.tasks is
  'Admin vê tudo; os demais veem o que criaram ou o que lhes foi atribuído.';
comment on policy tasks_update on public.tasks is
  'Mesma régua da visualização, dos dois lados, para a edição não tirar a tarefa de quem a enxerga.';
