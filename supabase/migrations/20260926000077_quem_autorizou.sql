-- =====================================================================
-- Quem autorizou cada integração
-- ---------------------------------------------------------------------
-- ⚠️ RODAR ANTES DO DEPLOY. `getIntegrationStatuses` passa a pedir estas
-- colunas no select, e o PostgREST recusa a consulta inteira com 42703
-- quando uma delas não existe — devolvendo `data: null`, o que faria
-- TODO cliente aparecer como "não conectado" na tela de configurações.
-- É o mesmo acidente de 19/08/2026, quando `recharge_notice_sent_at`
-- entrou no select antes da migration e quatro contas sumiram do alerta
-- de saldo sem aviso nenhum.
--
-- O QUE ISTO CONSERTA. O token do Meta não é da agência: é da PESSOA que
-- concluiu o consentimento, e o seletor de contas de anúncio lista
-- exatamente o que `me/adaccounts` daquela pessoa alcança. Medido em
-- 26/09/2026: as 60 integrações Meta ativas tinham as autorizações vivas
-- todas no mesmo usuário do Facebook, com uma única BM alcançável.
--
-- Sem registrar isso, "por que esta conta de anúncios não aparece na
-- lista?" é uma pergunta sem resposta na tela — e a resposta é sempre a
-- mesma: porque quem autorizou não enxerga essa conta. Com dois
-- autorizadores diferentes na carteira, a pergunta passa a aparecer
-- toda semana.
--
-- NOME GRAVADO, NÃO CHAVE ESTRANGEIRA. É registro histórico de um ato:
-- se a pessoa sai da agência, a linha deve continuar dizendo quem
-- autorizou. Um join com `profiles` apagaria o registro junto com o
-- perfil, e ainda dependeria de a RLS de `profiles` deixar passar.
-- =====================================================================

alter table public.client_integrations
  add column if not exists authorized_by_name        text,
  add column if not exists authorized_by_external_id text,
  add column if not exists authorized_by_user_name   text,
  add column if not exists authorized_at             timestamptz;

comment on column public.client_integrations.authorized_by_name is
  'Dono do token na PLATAFORMA, como ela mesma informa (Meta: nome do usuário do Facebook). É quem define quais contas de anúncio o seletor consegue listar. Nulo no Google: o escopo pedido é só `adwords`, que não revela identidade — e acrescentar `openid` mudaria a tela de consentimento.';

comment on column public.client_integrations.authorized_by_external_id is
  'Id do dono do token na plataforma. Serve para distinguir dois homônimos e para conferir na Graph API sem precisar do token.';

comment on column public.client_integrations.authorized_by_user_name is
  'Quem, DENTRO do Elo Hub, conduziu o consentimento. Fotografia do nome no momento do ato — ver a nota sobre chave estrangeira no cabeçalho.';

comment on column public.client_integrations.authorized_at is
  'Quando o consentimento foi concluído. Diferente de `last_synced_at`, que é quando dado entrou pela última vez.';
