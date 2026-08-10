/* =====================================================================
   Formato da peça descrito pelo ATIVO, não pelo nome comercial
   ---------------------------------------------------------------------
   A migration 33 listava `feed`, `reels`, `stories`, `carrossel`,
   `video`, `shorts` e `artigo`. Três desses — `reels`, `shorts` e
   `video` — são o MESMO ARQUIVO: um vídeo 9:16. Só mudava o nome que
   cada plataforma dá a ele.

   O efeito prático, medido: NENHUM dos sete formatos servia para postar
   um vertical em Instagram, Facebook, TikTok e YouTube ao mesmo tempo,
   que é o fluxo mais comum que existe hoje.

     feed       → avisava em tiktok, youtube
     reels      → avisava em tiktok, youtube
     video      → avisava em instagram
     shorts     → avisava em instagram, facebook, tiktok

   Qualquer escolha produzia um aviso FALSO, e um aviso que sempre
   aparece é um aviso que ninguém mais lê.

   Agora um formato é um ativo. O nome comercial virou apelido na
   interface: o mesmo `video_vertical` aparece como "Reels" no Instagram,
   "Shorts" no YouTube e "Idea Pin" no Pinterest.

   IDEMPOTENTE. Roda igual se a 33 já tiver sido aplicada com a lista
   antiga ou se ela já vier com a nova: o UPDATE só toca em valores
   antigos, e a constraint é recriada do zero.
   ===================================================================== */

alter table public.social_posts
  drop constraint if exists social_posts_format_check;

/* O default sai de cena antes do UPDATE: 'feed' não existe mais e a
   constraint nova o recusaria na primeira inserção. */
alter table public.social_posts
  alter column format drop default;

update public.social_posts p
   set format = case p.format
         when 'feed'      then 'imagem'
         when 'reels'     then 'video_vertical'
         when 'shorts'    then 'video_vertical'
         /* `video` era ambíguo — significava o vertical do TikTok E o
            horizontal do YouTube. Desempata pelo destino: se a peça tem
            TikTok entre as redes, era vertical. */
         when 'video'     then (
           case when exists (
             select 1 from public.social_post_targets t
              where t.post_id = p.id and t.network = 'tiktok'
           ) then 'video_vertical' else 'video_horizontal' end
         )
         else p.format
       end
 where p.format in ('feed', 'reels', 'shorts', 'video');

alter table public.social_posts
  alter column format set default 'imagem';

alter table public.social_posts
  add constraint social_posts_format_check check (format in (
    'video_vertical', 'video_horizontal', 'imagem',
    'carrossel', 'stories', 'artigo'
  ));

comment on column public.social_posts.format is
  'O que a peça É (9:16, 16:9, imagem, carrossel...). O nome comercial de cada rede — Reels, Shorts, Idea Pin — é apelido de interface, não valor guardado.';
