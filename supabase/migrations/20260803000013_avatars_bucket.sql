/* =====================================================================
   Bucket de avatares
   ---------------------------------------------------------------------
   Público de propósito: a foto aparece na sidebar de todo mundo e em
   cada tarefa atribuída. URL assinada obrigaria a renovar o link a cada
   render — custo alto para um dado que não é sigiloso.

   Limite de 2MB e só raster. Sem SVG: SVG é XML e pode carregar script,
   e um avatar servido de bucket público é exatamente o vetor de XSS que
   ninguém procura.
   ===================================================================== */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;

/* O caminho do arquivo COMEÇA pelo id do usuário — `<uuid>/foto.jpg`.
   É isso que torna a policy possível sem tabela de apoio: o dono está
   no próprio nome do objeto, e ninguém escreve na pasta de outro. */

drop policy if exists "avatars: leitura pública" on storage.objects;
drop policy if exists "avatars: dono escreve" on storage.objects;
drop policy if exists "avatars: dono atualiza" on storage.objects;
drop policy if exists "avatars: dono apaga" on storage.objects;

create policy "avatars: leitura pública" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: dono escreve" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: dono atualiza" on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: dono apaga" on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
