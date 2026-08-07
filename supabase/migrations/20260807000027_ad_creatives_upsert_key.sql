/* =====================================================================
   Chave de upsert dos criativos
   ---------------------------------------------------------------------
   `ad_creatives` nasceu com `unique (client_id, platform, external_ad_id,
   period_start)`. Faz sentido para um histórico de "como este anúncio
   performou em cada janela", mas não é o que a galeria precisa: ela
   mostra o que está NO AR AGORA, um card por anúncio.

   Com `period_start` na chave, cada sincronização abriria uma linha nova
   — a janela desliza todo dia — e a galeria passaria a repetir o mesmo
   anúncio dezenas de vezes.

   A tabela está vazia: nada nunca escreveu nela (era lida pela galeria
   desde o começo e nunca alimentada, o que explica o "Nenhum criativo
   ativo sincronizado" permanente). Então trocar a chave não migra dado
   nenhum.

   `period_start` e `period_end` continuam como COLUNAS, para registrar a
   janela da última sincronização. Só deixam de fazer parte da
   identidade da linha.
   ===================================================================== */

alter table public.ad_creatives
  drop constraint if exists ad_creatives_client_id_platform_external_ad_id_period_start_key;

do $$
begin
  alter table public.ad_creatives
    add constraint ad_creatives_client_platform_ad_key
    unique (client_id, platform, external_ad_id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

comment on constraint ad_creatives_client_platform_ad_key on public.ad_creatives is
  'Um card por anúncio. A janela sincronizada fica em period_start/period_end, fora da chave.';
