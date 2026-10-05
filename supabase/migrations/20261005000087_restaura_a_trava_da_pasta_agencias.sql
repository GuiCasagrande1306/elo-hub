/* =====================================================================
   Restaura a trava da pasta `agencias/` — conserto da migration 86
   ---------------------------------------------------------------------
   A MIGRATION 86 FOI ESCRITA EM CIMA DA VERSÃO ERRADA DA POLICY, e isto
   aqui é o conserto. Fica registrado porque o erro é instrutivo.

   `storage_brand_write` nasceu na migration 3 usando
   `app.can_write_client`. A 86 trocou essa função por
   `app.client_is_visible` — a troca certa, pelo motivo certo: a logo do
   cliente é escrita pelo time inteiro desde a migration 24, e o arquivo
   precisava seguir a mesma regra da coluna.

   Só que a 86 partiu do texto da migration 3, e a 3 já não era a versão
   viva: a MIGRATION 39 tinha reescrito a mesma policy ao criar o
   cadastro de agências. Recriá-la a partir do texto antigo apagou as
   duas defesas que a 39 havia acrescentado:

     1. A PASTA `agencias/` ERA RESTRITA A ADMIN. A 39 escreveu o
        porquê sem rodeios: "mexer em agência move dinheiro de lugar".
        Com a 86 no ar, qualquer pessoa da equipe passava a poder
        gravar ali.

     2. O CAST SÓ ACONTECIA DEPOIS DE CONFERIR O FORMATO. A 39 usa
        `case` justamente para garantir a ordem de avaliação — com
        `and`/`or` o planejador pode avaliar o outro lado e estourar o
        cast mesmo assim. A 86 voltou a converter antes de conferir, e
        um caminho fora da convenção passaria a derrubar o INSERT com
        erro de cast em vez de ser recusado em silêncio.

   A LIÇÃO, que é a mesma que esta base já registrou duas vezes: antes
   de recriar uma policy, procurar a definição MAIS RECENTE dela, não a
   primeira. `grep` pelo nome da policy em todas as migrations, não só
   na que a criou.

   Esta migration devolve a forma da 39 e muda UMA palavra dentro dela:
   `can_write_client` vira `client_is_visible`, no ramo do cliente. A
   pasta `agencias/` continua sendo só de admin.
   ===================================================================== */

drop policy if exists "storage_brand_write" on storage.objects;

create policy "storage_brand_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand'
    and case
          when split_part(name, '/', 1) = 'agencias' then app.is_admin()
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then app.client_is_visible(split_part(name, '/', 1)::uuid)
          else false
        end
  );
