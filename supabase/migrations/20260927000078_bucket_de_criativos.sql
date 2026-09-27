-- =====================================================================
-- Bucket das miniaturas de criativo
-- ---------------------------------------------------------------------
-- ⚠️ RODAR ANTES DO DEPLOY. Sem o bucket, cada tentativa de upload da
-- sincronização falha — silenciosamente, porque `syncCreatives` engole
-- o próprio erro de propósito. O sintoma seria nenhum, e a coluna
-- continuaria vazia como está hoje.
--
-- O QUE ISTO CONSERTA. `ad_creatives.storage_path` existe desde o
-- primeiro esquema, com o comentário "cópia no Supabase Storage (URLs
-- da Meta expiram)" — e NUNCA FOI PREENCHIDA. Medido em 26/09/2026:
-- 951 linhas, 951 sem cópia.
--
-- A consequência aparece com atraso, que é o que a torna traiçoeira. O
-- relatório sai perfeito no dia em que é gerado, porque o endereço da
-- Meta ainda vale; semanas depois, o cliente reabre o mesmo PDF e a
-- tabela de anúncios está com os quadrados cinzas. Ninguém associa a
-- falha ao dia da geração, e o arquivo já foi entregue.
--
-- PÚBLICO, e a decisão é deliberada:
--
--   • São peças de anúncio que JÁ ESTÃO no ar no Instagram e no
--     Facebook. Não há nada a proteger que a plataforma não esteja
--     exibindo para qualquer pessoa.
--   • URL assinada precisaria ser renovada a cada abertura do
--     relatório. O PDF é um arquivo estático que o cliente guarda: um
--     link que expira reproduziria exatamente o problema que este
--     bucket existe para resolver.
--
-- SEM SVG, pelo mesmo motivo do bucket de avatares: SVG é XML, pode
-- carregar script, e um arquivo servido de bucket público é o vetor de
-- XSS que ninguém procura. A Meta devolve JPEG e PNG.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'criativos', 'criativos', true, 5242880,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do nothing;

/* LEITURA PÚBLICA e nada mais.
   ---------------------------------------------------------------------
   Diferente de `avatars`, aqui NÃO existe policy de escrita para
   `authenticated`. Quem grava é só a sincronização, com `service_role`,
   que passa por cima de RLS por definição.

   A ausência é a política: ninguém logado no Elo Hub tem motivo para
   subir arquivo neste bucket, e uma policy de escrita aberta a
   `authenticated` seria uma porta permanente para hospedar qualquer
   coisa num domínio nosso. */

drop policy if exists "criativos: leitura pública" on storage.objects;

create policy "criativos: leitura pública" on storage.objects for select
  using (bucket_id = 'criativos');

/* O contrato da coluna, agora que ela finalmente é usada. */
comment on column public.ad_creatives.storage_path is
  'URL PÚBLICA COMPLETA da cópia no bucket `criativos`, não o caminho relativo — é usada direto como `src` da imagem no relatório, e montar a URL em cada renderizador daria duas formas de chegar ao mesmo arquivo. NULO = ainda não copiada; quem renderiza cai em `thumbnail_url`, que expira. O caminho dentro do bucket é `<client_id>/<external_ad_id>`.';
