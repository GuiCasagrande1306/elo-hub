/* =====================================================================
   Quatro redes, e a arte passa a morar no painel
   ---------------------------------------------------------------------
   DUAS MUDANÇAS, pedidas juntas.

   1. AS REDES CAEM DE NOVE PARA QUATRO. A agência opera Instagram,
      Facebook, TikTok e YouTube. LinkedIn, X, Pinterest, Threads e
      Google Meu Negócio estavam no `check` desde o começo e nunca foram
      usados: medido antes de remover — 1 perfil cadastrado (Instagram),
      0 posts, 0 destinos. Não há linha para migrar.

      O `check` volta com a lista curta. Foi por isso que ele é `check` e
      não `enum` (ver o cabeçalho da migration 33): valor de enum não se
      remove.

   2. A ARTE PASSA A SER ARQUIVO, não só link. `media_urls` guardava
      endereços do Drive porque o sistema não guardava arte. Agora
      guarda: o bucket `social-media` recebe o upload, e a coluna passa a
      aceitar as duas coisas — caminho interno do Storage e URL externa.
      Nada a converter, porque não há linha com arte.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Redes
   ------------------------------------------------------------------ */

alter table public.social_accounts
  drop constraint if exists social_accounts_network_check;

alter table public.social_accounts
  add constraint social_accounts_network_check
  check (network in ('instagram', 'facebook', 'tiktok', 'youtube'));

alter table public.social_post_targets
  drop constraint if exists social_post_targets_network_check;

alter table public.social_post_targets
  add constraint social_post_targets_network_check
  check (network in ('instagram', 'facebook', 'tiktok', 'youtube'));


/* ---------------------------------------------------------------------
   2. Bucket da arte

   PRIVADO, como `report-pdfs` e `ad-thumbs`. Arte de campanha é material
   do cliente antes de ir ao ar — um bucket público significa que
   qualquer pessoa com a URL vê a peça de amanhã. A tela mostra por URL
   assinada, com validade curta.

   50MB porque um Reels de 30s em qualidade de publicação fica entre 20 e
   40MB. Abaixo disso o upload falharia justo no formato que mais
   circula.
   ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-media',
  'social-media',
  false,
  52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime'
  ]
)
on conflict (id) do update
  set file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;


/* ---------------------------------------------------------------------
   3. Quem alcança a arte

   O CAMINHO COMEÇA PELO UUID DO CLIENTE — `<client_id>/<post_id>/<arquivo>`
   — e é isso que a policy usa para autorizar. Mesmo desenho de
   `report-pdfs`: a primeira pasta é a unidade de visibilidade, então a
   regra é uma comparação de prefixo contra a RLS que já existe.

   O UPLOAD não passa por aqui: sobe pela Server Action com
   service_role, que valida sessão e vínculo antes. Policy de INSERT para
   o usuário final daria a ele o direito de escrever em qualquer pasta
   cujo nome ele adivinhasse.
   ------------------------------------------------------------------ */

drop policy if exists "social_media_leitura" on storage.objects;

create policy "social_media_leitura"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'social-media'
    and app.client_is_visible(
      /* Primeira pasta do caminho. `nullif` porque um objeto solto na
         raiz do bucket tem `name` sem barra, e `split_part` devolveria
         string vazia — que não converte para uuid e derrubaria a
         consulta inteira com erro de sintaxe, em vez de só negar. */
      nullif(split_part(name, '/', 1), '')::uuid
    )
  );
