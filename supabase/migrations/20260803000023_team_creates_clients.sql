/* =====================================================================
   Toda a equipe cadastra cliente
   ---------------------------------------------------------------------
   Cadastrar era prerrogativa de admin. Numa agência onde o colaborador
   opera a conta inteira — vê métricas, gera relatório, roda a esteira —
   exigir um admin só para criar a linha do cliente é gargalo sem ganho:
   quem não podia criar já podia mudar tudo depois.

   DUAS POLICIES, não uma. `create_client_with_setup` grava cliente,
   meta e integrações na MESMA transação. Liberar só `clients` faria o
   cadastro falhar no meio — com o cliente já criado e sem integração,
   que é pior que não criar. `client_integrations` precisa aceitar o
   insert junto.

   O que continua restrito: EDITAR e APAGAR cliente seguem em
   `clients_update` / `clients_delete` com `app.is_admin()`, e as
   integrações só podem ser alteradas por admin depois de criadas.
   Criar é reversível por quem tem poder; renomear um slug que já saiu
   em PDF entregue, não.
   ===================================================================== */

drop policy if exists clients_insert on public.clients;

create policy clients_insert on public.clients for insert to authenticated
  with check (true);

comment on policy clients_insert on public.clients is
  'Toda a equipe cadastra. Editar e apagar seguem restritos a admin.';


/* A policy `client_integrations_admin` é `for all` e cobre update e
   delete; esta abre APENAS o insert, e só para cliente visível. */
drop policy if exists client_integrations_insert on public.client_integrations;

create policy client_integrations_insert
  on public.client_integrations for insert to authenticated
  with check (app.client_is_visible(client_id));
