/* =====================================================================
   Equipe edita os ajustes do cliente
   ---------------------------------------------------------------------
   `clients_update` usava `app.can_write_client()`, que exige admin ou
   nível editor/manager em `client_members` — tabela que segue vazia e
   que nada no sistema escreve. Na prática: só admin editava, e o
   colaborador que opera a conta não conseguia corrigir o nicho errado
   nem o dia da otimização.

   É o mesmo padrão que já corrigimos em métricas, metas e histórico da
   esteira. A regra passa a espelhar a visibilidade do cliente.

   ⚠️ O QUE ISSO ABRE ALÉM DO PEDIDO: RLS é por LINHA, não por coluna.
   Liberar o update libera todas as colunas de `clients` — inclusive
   `name` e `slug`, que aparecem em URL e em PDF já entregue. A interface
   não expõe esses dois (o card de ajustes edita nicho, WhatsApp, dias de
   relatório e otimização, e logo), mas quem chamar a API direto
   alcança. Se um dia isso incomodar, o caminho é um trigger que
   congele `slug` — não uma policy, que não sabe distinguir coluna.

   `clients_delete` NÃO muda: apagar cliente leva junto métricas, metas,
   relatórios e histórico por cascade, e é irreversível pela interface.

   As METAS já estavam abertas desde a migration 18 — `client_goals`
   insert e update usam `app.client_is_visible()`. Nada a fazer ali.
   ===================================================================== */

drop policy if exists clients_update on public.clients;

create policy clients_update on public.clients for update to authenticated
  using (app.client_is_visible(id))
  with check (app.client_is_visible(id));

comment on policy clients_update on public.clients is
  'Equipe edita os ajustes da conta. Apagar segue restrito a admin.';
