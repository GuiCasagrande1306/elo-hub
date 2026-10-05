/* =====================================================================
   O time envia a logo do cliente
   ---------------------------------------------------------------------
   SINTOMA: colaborador clica em "Enviar logo" nos ajustes da conta e
   recebe "Erro ao enviar: new row violates row-level security policy".
   Visto com o Bernardo em 05/10/2026, na Agenda Contabilidade.

   CAUSA: enviar uma logo são DUAS escritas — o arquivo no bucket
   `brand` e a coluna `clients.logo_url`. A migration 24 abriu a
   segunda para a equipe inteira (`clients_update` passou a usar
   `app.client_is_visible`) e listou a logo entre os campos daquele
   card. A PRIMEIRA ficou para trás: `storage_brand_write`, escrita na
   migration 3, continuou exigindo `app.can_write_client`.

   E `can_write_client` é admin OU nível editor/manager em
   `client_members` — a tabela que a própria migration 24 descreve como
   "vazia e que nada no sistema escreve". Conferido em produção hoje:
   ZERO linhas, na tabela inteira. Para todo colaborador a função é
   falsa em toda conta, sempre. Só admin subia logo — e o botão
   aparecia para todo mundo.

   A autorização do arquivo passa a ser a MESMA da coluna que ele
   acompanha. Um gesto com duas escritas sob duas regras diferentes foi
   o que produziu este erro, e é o que esta migration encerra.

   ⚠️ SÓ INSERT, DE PROPÓSITO. O componente grava
   `<client_id>/<timestamp>.<ext>` — nome novo a cada envio, nunca
   sobrescreve. Policy de UPDATE não faria falta e abriria a troca do
   arquivo de uma conta por baixo de um `logo_url` que não mudou.

   ⚠️ O CAMINHO CONTINUA SENDO A AUTORIZAÇÃO. A primeira pasta do path
   é o uuid do cliente, e é ela que a policy lê. Upload fora dessa
   convenção não é recusado por engano: é recusado porque não há conta
   a que ele pertença.
   ===================================================================== */

drop policy if exists "storage_brand_write" on storage.objects;

create policy "storage_brand_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand'
    and app.client_is_visible(nullif(split_part(name, '/', 1), '')::uuid)
  );
