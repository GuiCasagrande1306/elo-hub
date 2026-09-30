/* =====================================================================
   O link do cliente volta a ser gerável
   ---------------------------------------------------------------------
   SINTOMA: clicar em "Link do cliente" na ficha devolvia "Não foi
   possível gerar o link. Você administra esta conta?" — para um admin,
   na própria conta. A pergunta da mensagem era um chute, e estava
   errada.

   CAUSA: a migration 80 criou `report_share_links` com RLS e três
   policies, concedeu `execute` na função de visita… e NUNCA concedeu
   privilégio na TABELA. O Postgres checa o privilégio antes de avaliar
   RLS, então a policy `share_links_write` jamais chegou a ser lida: o
   que voltava era `permission denied for table report_share_links`.

   ⚠️ É A MESMA ARMADILHA QUE A MIGRATION 44 DOCUMENTA EM MAIÚSCULAS no
   próprio cabeçalho — "GRANT ANTES DE POLICY" —, escrita depois de ela
   ter segurado a edição de otimização por semanas. Foi documentada e
   repetida mesmo assim, quatro migrations depois.

   `delete` fica DE FORA de propósito. A migration 80 decidiu que
   revogar é UPDATE em `revoked_at`, não DELETE, para não destruir o
   registro de que o link existiu e de quantas vezes foi aberto. Sem o
   privilégio de delete, essa decisão vira mecânica em vez de acordo.
   ===================================================================== */

grant select, insert, update on public.report_share_links to authenticated;
