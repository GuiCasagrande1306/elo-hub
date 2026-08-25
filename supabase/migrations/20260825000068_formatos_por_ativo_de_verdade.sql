/* =====================================================================
   O `format` de social_posts, agora de verdade
   ---------------------------------------------------------------------
   POR QUE ESTA MIGRATION EXISTE, se a 34 já faz isto.

   Porque a 34 nunca rodou em produção. Medido em 2026-08-25, inserindo
   uma peça de cada formato com a chave de serviço:

     feed, reels, shorts, video, carrossel, stories, artigo   aceitos
     imagem, video_vertical, video_horizontal                 RECUSADOS
     default da coluna                                        'feed'

   Ou seja: o banco continua com o vocabulário da migration 33, e o
   arquivo da 33 no repositório já foi reescrito com a lista nova — o
   que faz o repositório inteiro parecer coerente enquanto o banco
   discorda em silêncio.

   O ESTRAGO. `src/types/database.ts`, o zod de `salvarPost` e o
   compositor só conhecem a lista nova, e o formato padrão do compositor
   é 'imagem'. Então TODA tentativa de criar uma peça em produção morria
   em `violates check constraint "social_posts_format_check"`. Não é uma
   degradação parcial: o módulo de mídias sociais estava intransitável
   desde a 34, e os 0 posts da tabela não eram desuso — eram o defeito.

   Isso também é o argumento contra editar migration já publicada. A 33
   foi corrigida no arquivo em vez de ganhar uma 34 obrigatória, e o
   banco que rodou a 33 original ficou sem caminho de volta.

   IDEMPOTENTE, como a 34: o UPDATE só toca nos valores antigos e a
   constraint é recriada do zero. Rodar duas vezes não faz diferença, e
   rodar num banco que já está certo também não.
   ===================================================================== */

alter table public.social_posts
  drop constraint if exists social_posts_format_check;

/* O default sai antes do UPDATE: 'feed' não sobrevive à constraint
   nova, e uma inserção concorrente entre os dois passos pegaria o
   default velho. */
alter table public.social_posts
  alter column format drop default;

update public.social_posts p
   set format = case p.format
         when 'feed'   then 'imagem'
         when 'reels'  then 'video_vertical'
         when 'shorts' then 'video_vertical'
         /* 'video' era ambíguo: significava o vertical do TikTok E o
            horizontal do YouTube. Desempata pelo destino. */
         when 'video'  then (
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
  'O que a peça É (9:16, 16:9, imagem, carrossel...). O nome comercial de cada rede — Reels, Shorts — é apelido de interface, não valor guardado.';
