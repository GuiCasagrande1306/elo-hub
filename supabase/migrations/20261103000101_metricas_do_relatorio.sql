-- Quais cartoes de cada plataforma aparecem no relatorio do cliente.
-- Formato: {"meta_ads": ["spend","cpm",...], "google_ads": [...]}.
-- NULO (ou plataforma ausente) = automatico: aparece o que teve numero.
-- O time edita pela aba "Relatorio" do Configurar; a policy
-- clients_update (migration 24) ja deixa colaborador gravar.
--
-- RODE ANTES DO DEPLOY: o relatorio passa a ler a coluna.

alter table public.clients
  add column if not exists report_metrics jsonb;

comment on column public.clients.report_metrics is
  'Cartoes do relatorio por plataforma (chaves de metricas-do-relatorio.ts). NULO = automatico.';
