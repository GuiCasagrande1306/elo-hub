-- =====================================================================
-- Desfaz o bucket `criativos` — ele nunca deveria ter sido criado
-- ---------------------------------------------------------------------
-- ⚠️ RODAR JUNTO COM O DEPLOY, e depois da 78 (que criou o bucket).
--
-- O QUE ACONTECEU. A migration anterior criou um bucket `criativos`,
-- público, para guardar as miniaturas de criativo. Ele é DUPLICATA: o
-- bucket `ad-thumbs` existe desde a primeira migration de Storage
-- (20260803000003), com este comentário escrito lá:
--
--     ad-thumbs → miniaturas de criativos (as URLs da Meta expiram em
--                 poucas horas; copiamos para cá na sincronização)
--
-- A intenção estava registrada desde o começo — só a cópia nunca foi
-- implementada, e por isso o bucket estava vazio e não apareceu numa
-- busca por uso. O erro foi criar antes de procurar.
--
-- POR QUE O DESENHO ANTIGO É MELHOR, e não é só questão de não duplicar:
--
--   • PRIVADO, com policy de leitura que reaproveita `can_access_client`
--     sobre a primeira pasta do caminho. Isso dá controle de acesso por
--     cliente de graça — um colaborador fora da carteira não abre a
--     miniatura de um anúncio que não é dele. O bucket público não
--     tinha como oferecer isso.
--
--   • Privado NÃO recria o problema das URLs que expiram, que era o
--     receio ao escolher público. No PDF a imagem é RASTERIZADA dentro
--     do arquivo no momento da geração: o documento que chega ao
--     cliente não depende de link nenhum continuar de pé. Na tela, a
--     URL é assinada a cada carregamento, como já se faz com
--     `report-pdfs`.
--
-- ⚠️ O BUCKET NÃO É REMOVIDO AQUI, E NÃO PODE SER. A primeira versão
-- desta migration tentava `delete from storage.buckets`, e o Postgres do
-- Supabase recusa:
--
--     42501: Direct deletion from storage tables is not allowed.
--            Use the Storage API instead.
--     HINT: This prevents accidental data loss from orphaned objects.
--
-- É uma trava deliberada deles — apagar a linha do bucket deixaria os
-- objetos órfãos, ocupando espaço sem nada que os referencie. A remoção
-- foi feita pela API de Storage (`deleteBucket`), com o bucket
-- comprovadamente vazio, em 27/09/2026. Se este arquivo rodar num
-- ambiente onde `criativos` ainda exista, remova-o pelo painel de
-- Storage; nada no código aponta mais para ele.
-- =====================================================================

drop policy if exists "criativos: leitura pública" on storage.objects;

/* O contrato correto da coluna, corrigindo o que a 78 escreveu.

   CAMINHO, não URL. `ad-thumbs` é privado, então não existe endereço
   público para guardar — e é a mesma convenção de
   `report_history.storage_path`, que grava o caminho e assina na
   leitura. Quem carrega os criativos resolve o caminho em URL assinada
   antes de entregá-los à tela; ver `assinarMiniaturas`. */
comment on column public.ad_creatives.storage_path is
  'Caminho da cópia no bucket PRIVADO `ad-thumbs`, no formato `<client_id>/<external_ad_id>` — não uma URL. A primeira pasta é o que a policy compara com `can_access_client`. NULO = ainda não copiada, e quem renderiza cai em `thumbnail_url`, que expira em poucas semanas. Quem lê resolve o caminho em URL assinada antes de entregar à tela.';
