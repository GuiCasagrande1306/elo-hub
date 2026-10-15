/* =====================================================================
   Tabelas da loja: GRANT que faltava e regra viva nas policies
   ---------------------------------------------------------------------
   ⚠️ ESTA MIGRATION NÃO CONSERTA NADA QUE ESTEJA QUEBRADO HOJE, e é
   importante dizer isso antes de tudo. Ela existe para que o schema
   pare de mentir, e para que a próxima pessoa não perca uma tarde.

   O ESTADO MEDIDO EM 05/10/2026. `store_daily` e `store_integrations`
   têm RLS ligada e policies escritas com `app.can_access_client` e
   `app.can_write_client` — as duas funções que dependem de
   `client_members`, tabela vazia. Pareceria que o colaborador não
   enxerga o faturamento da loja.

   Só que NINGUÉM lê essas tabelas com sessão. Conferido um por um:
   `leitura.ts` e `sync.ts` são os únicos pontos de acesso, e os dois
   usam `createSupabaseAdminClient()`. Quem consome são a página do
   cliente, a prévia da mensagem, o payload do PDF e a folha de
   impressão — todos no servidor, todos com `service_role`, que ignora
   RLS. O colaborador VÊ o faturamento da loja, e sempre viu.

   E as policies estão mortas duas vezes, não uma: além da função
   inalcançável, FALTA O GRANT. Sem `grant select ... to authenticated`
   o Postgres recusa por privilégio de tabela antes de olhar a policy,
   e o erro é "permission denied for table store_daily", sem uma
   palavra sobre RLS. É a mesma armadilha das migrations 44 e 84 — a
   terceira vez nesta base.

   O QUE ESTA MIGRATION FAZ. Deixa as duas camadas coerentes com a
   regra que o produto de fato usa, para que o dia em que alguém
   acrescentar uma leitura pelo navegador — um painel da loja, um
   gráfico de pedidos — ela simplesmente funcione, em vez de devolver
   "permission denied" e mandar a pessoa procurar policy onde o
   problema é grant.

   ⚠️ A ESCRITA CONTINUA SÓ NO SERVIDOR. `store_integrations` guarda a
   base da API e o estado da sincronização; conectar ou trocar a loja
   de um cliente é ato de configuração, e segue com admin. O TOKEN não
   está aqui — mora em `store_secrets`, com RLS ligada e zero policies,
   e esta migration não encosta nele.

   ⚠️ USUÁRIO DE CLIENTE DE FORA, pela mesma razão da migration 88: o
   que a loja faturou no total, incluindo orgânico e recorrente, é
   leitura de gestão. O cliente recebe o número pelo relatório, com o
   rótulo que explica de onde ele vem.
   ===================================================================== */

grant select on public.store_daily to authenticated;
grant select on public.store_integrations to authenticated;

drop policy if exists "store_daily_read" on public.store_daily;
drop policy if exists "store_integrations_read" on public.store_integrations;
drop policy if exists "store_integrations_write" on public.store_integrations;

create policy "store_daily_read" on public.store_daily for select
  using (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  );

create policy "store_integrations_read" on public.store_integrations for select
  using (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  );

/* Conectar ou desconectar loja segue sendo ato de admin: mexe em
   credencial e em de onde vem o faturamento do relatório. A escrita de
   `store_daily` continua sem policy nenhuma — quem grava é o sync, com
   service_role. */
create policy "store_integrations_write" on public.store_integrations for all
  using (app.is_admin())
  with check (app.is_admin());
