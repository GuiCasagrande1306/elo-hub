/* =====================================================================
   O time gera e revoga o link do relatório
   ---------------------------------------------------------------------
   As três policies de `report_share_links` nasceram na migration 80
   apoiadas em `app.can_access_client` (leitura) e `app.can_write_client`
   (insert e update). As duas exigem admin OU uma linha em
   `client_members` com nível editor/manager — e `client_members` está
   VAZIA, na tabela inteira, conferido em produção em 05/10/2026. Nada
   no sistema escreve nela desde sempre.

   Resultado prático: só admin gerava link de relatório. O colaborador
   que opera a conta via o botão, clicava e apanhava — e, como a
   migration 84 registrou, antes disso nem chegava na policy, porque
   faltava o GRANT. Eram duas camadas do mesmo engano empilhadas.

   AS TRÊS MUDAM JUNTAS, e isso é o ponto. Abrir só o INSERT deixaria o
   colaborador criando links que ele não consegue listar nem revogar —
   meio caminho é pior que nenhum aqui, porque link que não se enxerga
   também não se desliga.

   ⚠️ USUÁRIO DE CLIENTE CONTINUA DE FORA, E DE PROPÓSITO. Gerar e
   revogar o link é ato da agência: é a agência que decide quem vê o
   relatório. `client_is_visible` sozinha abriria a porta, porque para
   um usuário de cliente ela é verdadeira na própria empresa (ver a
   migration 55). Daí a condição de papel na frente.

   ⚠️ `<>` E NÃO `is distinct from`, e a diferença importa. Sem perfil,
   `role_of_user()` devolve NULL; `NULL <> 'client'` é NULL, que numa
   policy vale como falso. Falha FECHADO, que é o desfecho certo para
   uma porta. A migration 55 usou `is not distinct from` pelo motivo
   oposto e igualmente deliberado: lá o NULL precisava não trancar o
   usuário fora da própria empresa.

   Só UPDATE, nunca DELETE: revogar é preencher `revoked_at`. A regra da
   migration 80 continua valendo e não é tocada aqui.
   ===================================================================== */

drop policy if exists "share_links_read" on public.report_share_links;
drop policy if exists "share_links_write" on public.report_share_links;
drop policy if exists "share_links_update" on public.report_share_links;

create policy "share_links_read" on public.report_share_links for select
  using (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  );

create policy "share_links_write" on public.report_share_links for insert
  with check (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  );

create policy "share_links_update" on public.report_share_links for update
  using (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  )
  with check (
    app.role_of_user() <> 'client'
    and app.client_is_visible(client_id)
  );
