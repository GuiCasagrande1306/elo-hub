/* =====================================================================
   Quem chama a porta precisa alcançar o corredor
   ---------------------------------------------------------------------
   `public.criar_funil_padrao` é `security invoker` e encaminha para
   `app.criar_funil_padrao`. Com `invoker`, quem executa é QUEM CHAMOU —
   e essa pessoa precisa de `usage` no schema `app` para atravessar.

   Medido em 22/08/2026, logo depois da migration 60:

       403 · 42501 · permission denied for schema app

   As outras funções de `app` nunca esbarraram nisso porque são chamadas
   de dentro de policies, avaliadas num contexto que já tem o caminho
   aberto. Esta é a primeira chamada DIRETA, vinda da aplicação, e por
   isso é a primeira a precisar da permissão explícita.

   `service_role` entra na lista junto: é por ele que o servidor cria o
   funil ao aceitar um convite, antes de existir sessão do cliente.

   A ALTERNATIVA ERA PIOR. Daria para copiar o corpo da função para
   `public` e não atravessar schema nenhum — e aí a mesma lógica
   existiria em dois lugares, livre para divergir no primeiro ajuste de
   etapa. Uma permissão declarada custa uma linha; duas cópias custam
   para sempre.
   ===================================================================== */

grant usage on schema app to authenticated, service_role;

grant execute on function app.criar_funil_padrao(uuid)    to authenticated, service_role;
grant execute on function public.criar_funil_padrao(uuid) to authenticated, service_role;
