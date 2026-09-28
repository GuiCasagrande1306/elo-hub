-- =====================================================================
-- Link público do relatório
-- ---------------------------------------------------------------------
-- ⚠️ RODAR ANTES DO DEPLOY. A rota pública consulta esta tabela; sem
-- ela, todo link responde 404 — o que é o desfecho seguro, mas a
-- funcionalidade simplesmente não existe.
--
-- O QUE É. Uma alternativa ao PDF: em vez de mandar um arquivo fechado
-- num período fixo, manda-se um endereço onde o cliente escolhe as
-- datas. Mesmo relatório, mesma apuração — muda o invólucro.
--
-- ⚠️ POR QUE UMA TABELA, e não um token assinado como o do Puppeteer.
-- O token de impressão é um HMAC com validade de minutos: serve porque
-- é usado uma vez, por uma máquina nossa, e morre sozinho. Este link
-- vai para o WhatsApp de um cliente e vive meses.
--
-- A diferença que decide é a REVOGAÇÃO. Um blob assinado não tem como
-- ser cancelado sem trocar o segredo — e trocar o segredo derrubaria os
-- links de todos os outros clientes junto. Contrato que acaba, celular
-- que troca de dono, conversa encaminhada para quem não devia: são
-- coisas que acontecem, e a resposta precisa ser desligar UM link.
--
-- SEM POLICY PÚBLICA. Quem lê esta tabela na rota aberta é o
-- `service_role`, no servidor. O visitante nunca fala com o Postgres: ele
-- manda um token na URL e recebe HTML pronto. As policies abaixo são só
-- para a equipe administrar os links pelo painel.
--
-- O TOKEN É GERADO NA APLICAÇÃO, com 32 bytes aleatórios. Fora do SQL
-- de propósito — valor secreto não deve nascer numa instrução que pode
-- parar no log de consultas do banco.
-- =====================================================================

create table if not exists public.report_share_links (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,

  -- 32 bytes em base64url = 43 caracteres. Inadivinhável por força
  -- bruta, e é o único segredo que protege o conteúdo.
  token       text not null unique,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  -- NULO = ativo. Revogar preserva a linha: saber que existiu um link e
  -- quando foi desligado importa mais do que economizar uma linha.
  revoked_at  timestamptz,

  /* Quantas vezes e quando foi aberto.
     Não é métrica de vaidade: é como se descobre que o cliente nunca
     abriu o relatório que a agência jura ter entregue — e também o
     primeiro sinal de um link circulando além de quem deveria. */
  view_count     integer not null default 0,
  last_viewed_at timestamptz
);

/* O índice cobre a consulta da rota pública, que é por token E ativo.
   Parcial porque link revogado nunca é procurado. */
create index if not exists report_share_links_ativo_idx
  on public.report_share_links (token) where revoked_at is null;

create index if not exists report_share_links_cliente_idx
  on public.report_share_links (client_id, created_at desc);

alter table public.report_share_links enable row level security;

drop policy if exists "share_links_read" on public.report_share_links;
drop policy if exists "share_links_write" on public.report_share_links;
drop policy if exists "share_links_update" on public.report_share_links;

/* Ver os links de um cliente é ver quem pode abrir o relatório dele —
   mesma fronteira de acesso do resto da conta. */
create policy "share_links_read" on public.report_share_links for select
  using (app.can_access_client(client_id));

create policy "share_links_write" on public.report_share_links for insert
  with check (app.can_write_client(client_id));

/* Só UPDATE, nunca DELETE: revogar é preencher `revoked_at`. Apagar a
   linha destruiria o registro de que o link existiu, que é justamente o
   que se quer consultar depois de uma suspeita. */
create policy "share_links_update" on public.report_share_links for update
  using (app.can_write_client(client_id))
  with check (app.can_write_client(client_id));

comment on table public.report_share_links is
  'Links públicos do relatório, um por vez por cliente na prática. O token na URL é o único segredo; a rota pública lê com service_role e o visitante nunca alcança o Postgres. Revogar = preencher revoked_at.';

/* ---------------------------------------------------------------------
   Registrar a visita
   ---------------------------------------------------------------------
   Função e não UPDATE do lado da aplicação porque `view_count + 1`
   precisa acontecer DENTRO do banco. Ler o valor, somar em JavaScript e
   gravar de volta perde contagens quando duas abas abrem juntas — e um
   contador que erra para menos é pior que contador nenhum, porque
   sustenta a conclusão errada ("o cliente nunca abriu").

   `security definer` porque quem chama é a rota pública com
   service_role, e também porque não existe — nem deve existir — policy
   de UPDATE para visitante nesta tabela.

   Devolve o `client_id` do link ativo, ou NULL quando o token não
   existe ou foi revogado. Assim a rota faz UMA ida ao banco para
   autorizar e contabilizar. */
/* ⚠️ NO SCHEMA `public`, e não em `app` como as funções de RLS ao lado.
   Não é inconsistência: o PostgREST só enxerga funções do schema
   exposto, então `app.registrar_visita_do_link` seria invisível para o
   `.rpc()` do cliente Supabase e a rota pública devolveria 404 em todo
   link — com o token certo e o registro no lugar. A companhia aqui é
   `public.create_client_with_setup`, que é chamada do mesmo jeito. */
create or replace function public.registrar_visita_do_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client uuid;
begin
  update public.report_share_links
     set view_count     = view_count + 1,
         last_viewed_at = now()
   where token = p_token
     and revoked_at is null
  returning client_id into v_client;

  return v_client;
end $$;

/* Estar em `public` não é estar aberta. Só o `service_role` executa —
   é a rota do servidor que chama, nunca o navegador do visitante.
   Sem este revoke, `anon` herdaria o EXECUTE padrão e qualquer pessoa
   poderia varrer tokens contra o banco direto pela API REST. */
revoke all on function public.registrar_visita_do_link(text)
  from public, anon, authenticated;

grant execute on function public.registrar_visita_do_link(text)
  to service_role;
