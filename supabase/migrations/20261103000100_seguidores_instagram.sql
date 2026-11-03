-- Seguidores do Instagram atribuidos aos anuncios, por campanha e dia:
-- a coluna "Seguidores no Instagram" do Gerenciador, campo
-- instagram_profile_follow do Insights (fora da documentacao publica).
--
-- RODE ANTES DO DEPLOY, como a 76: o upsert passa a mandar
-- instagram_follows e o PostgREST recusa a requisicao inteira se a
-- coluna nao existir. Com o codigo antigo no ar ela so fica nula.
--
-- NULO = nao apurado (linha anterior a coluna, ou Google), nunca zero.

alter table public.daily_metrics
  add column if not exists instagram_follows integer;

comment on column public.daily_metrics.instagram_follows is
  'Seguidores do Instagram atribuidos aos anuncios da campanha no dia (campo instagram_profile_follow do Insights). NULO = nao apurado.';
