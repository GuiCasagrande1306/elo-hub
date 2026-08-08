/* =====================================================================
   Conexão do Instagram Direct — a base do EloChat
   ---------------------------------------------------------------------
   TABELAS PRÓPRIAS, E NÃO UM VALOR NOVO EM `ad_platform`.

   Era o caminho de uma linha: `alter type ad_platform add value
   'instagram'` e reaproveitar `client_integrations`. Está errado pela
   mesma razão que o GA4 não entrou lá (migration 28): aquele enum é de
   plataformas de ANÚNCIO, e toda leitura que agrupa por ele pressupõe
   que existe gasto. O card "Canais — onde o orçamento foi alocado"
   passaria a listar Instagram com R$ 0,00 investidos, que é afirmação
   falsa sobre alocação de verba.

   E não é a mesma conexão: o token do Meta Ads vem do Facebook Login e
   fala com `graph.facebook.com`; este vem do Instagram Login e fala com
   `graph.instagram.com`. Credenciais diferentes, ciclo diferente,
   permissões com outros nomes. Um cliente pode ter um sem o outro.

   DUAS TABELAS, espelhando `client_integrations` + `integration_secrets`:
   o vínculo é legível pela equipe, o token não é lido por ninguém além
   do `service_role`.
   ===================================================================== */

create table if not exists public.instagram_connections (
  /* Um Instagram por cliente. Chave primária no `client_id` em vez de
     um uuid próprio: não existe caso de uma conta com dois perfis
     automatizados, e a PK aqui elimina o "qual dos dois é o certo". */
  client_id      uuid primary key references public.clients (id) on delete cascade,

  /* Identificador do perfil na API, e o @ para a tela ter o que mostrar.
     `ig_user_id` NÃO é o id do Facebook nem o `act_` de anúncios. */
  ig_user_id     text not null,
  username       text,
  account_type   text,

  /* Permissões CONCEDIDAS, como a própria Meta devolveu na troca do
     código por token.

     Diferente da coluna `scopes` de `integration_secrets`, que guarda o
     que foi PEDIDO (lista fixa no código) e por isso não serve de prova:
     quem recusa uma permissão fica lá registrado como se tivesse
     concedido. Aqui o valor vem da resposta da Meta, então vale. */
  granted_scopes text[] not null default '{}',

  /* Token longo dura ~60 dias e é renovável. Guardar o vencimento
     permite avisar ANTES de a automação parar, em vez de descobrir pelo
     fluxo que não disparou. */
  expires_at     timestamptz,

  /* Último erro da API para esta conexão. Some quando reconecta. */
  last_error     text,

  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.instagram_connections is
  'Perfil do Instagram autorizado para automação de direct (EloChat). Separado de client_integrations: outro login, outro host de API, e não é plataforma de anúncio.';

create table if not exists public.instagram_secrets (
  client_id    uuid primary key
                 references public.instagram_connections (client_id) on delete cascade,
  access_token text not null,
  updated_at   timestamptz not null default now()
);

comment on table public.instagram_secrets is
  'RLS habilitada SEM nenhuma policy: nega tudo para anon/authenticated. Acesso apenas via service_role no servidor.';

do $$
begin
  create trigger trg_instagram_connections_touch
    before update on public.instagram_connections
    for each row execute function app.touch_updated_at();
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create trigger trg_instagram_secrets_touch
    before update on public.instagram_secrets
    for each row execute function app.touch_updated_at();
exception
  when duplicate_object then null;
end $$;


/* ---------------------------------------------------------------------
   Acesso

   GRANT ANTES DA POLICY. Sétima vez neste projeto: o Postgres checa
   privilégio de tabela antes de avaliar a policy, e sem o grant a
   consulta volta vazia ou com 42501 — sem a policy sequer rodar.
   Ver as migrations 17, 18, 26, 29, 30 e 31.

   `instagram_connections` segue a visibilidade da carteira: quem enxerga
   o cliente enxerga se ele tem Instagram ligado. Não é dado sensível —
   sensível é o token, que mora na outra tabela.

   `instagram_secrets` NÃO RECEBE GRANT NENHUM, de propósito. É a mesma
   proteção de `integration_secrets`: RLS ligada, zero policy, zero
   privilégio. Só `service_role` chega nela.
   ------------------------------------------------------------------ */

alter table public.instagram_connections enable row level security;
alter table public.instagram_secrets      enable row level security;

grant select, insert, update, delete on public.instagram_connections to authenticated;

drop policy if exists instagram_connections_select on public.instagram_connections;
drop policy if exists instagram_connections_write  on public.instagram_connections;

create policy instagram_connections_select on public.instagram_connections
  for select to authenticated
  using (app.client_is_visible(client_id));

/* Escrita só de admin: conectar e desconectar Instagram é ato
   administrativo, como vincular conta de anúncios. O fluxo de OAuth em
   si grava com `service_role` e não passa por aqui — esta policy cobre
   o "desconectar" feito pela tela. */
create policy instagram_connections_write on public.instagram_connections
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());
