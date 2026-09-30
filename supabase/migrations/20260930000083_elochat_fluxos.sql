/* =====================================================================
   EloChat — o fluxo deixa de se perder ao recarregar
   ---------------------------------------------------------------------
   O construtor está no ar desde 08/08 e nunca gravou nada: os nós vivem
   em `useNodesState` e somem no F5. "Publicar" não publica. Esta
   migration é o primeiro pedaço do motor — sem lugar para guardar o
   fluxo não há o que executar, e todo o resto (webhook, disparo, estado
   por contato) depende de existir uma linha para ler.

   O FLUXO É POR CLIENTE, e não global, porque a conexão é.
   `instagram_connections` tem `client_id` como chave primária: o token,
   o @ e as permissões são de uma conta específica. Um fluxo global não
   teria como saber por qual conta responder — e a tela, que hoje não
   pede cliente nenhum, passa a pedir.

   UM PUBLICADO POR CLIENTE. O índice parcial abaixo é o que garante.
   Dois fluxos publicados na mesma conta significam duas respostas para
   o mesmo comentário, e o segundo disparo é o que a Meta enxerga como
   comportamento automatizado — exatamente o que restringiu a conta do
   Geraldo duas vezes em setembro. Rascunho pode ter quantos quiser.

   ⚠️ NÃO EXECUTA NADA AINDA. Publicar aqui marca a intenção e congela a
   versão; quem dispara é o motor, que não existe. Isto está escrito
   para ninguém publicar um fluxo achando que ele já está respondendo.
   ===================================================================== */

create table if not exists public.elochat_flows (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,

  name       text not null default 'Fluxo sem nome'
             check (length(btrim(name)) between 1 and 120),

  /* O grafo como o React Flow o entende: `nodes` carrega posição e
     `data` (ver `DadosDoNo` em components/elochat/blocks.ts), `edges`
     carrega origem, destino e o `sourceHandle` que diz de qual botão
     a aresta saiu.

     JSONB e não tabelas normalizadas de nó e aresta, e é uma decisão:
     o grafo é lido e escrito SEMPRE inteiro — o construtor salva o
     canvas completo, o motor carrega o fluxo completo. Normalizar
     custaria duas tabelas, dois índices e uma transação por salvar,
     para servir uma consulta que ninguém faz. Se um dia alguém
     perguntar "quais fluxos usam o bloco de carrossel", aí normaliza. */
  nodes      jsonb not null default '[]'::jsonb,
  edges      jsonb not null default '[]'::jsonb,

  status     text not null default 'rascunho'
             check (status in ('rascunho', 'publicado')),

  /* Quando foi publicado. Fica null ao voltar para rascunho — mesmo
     princípio de `won_at` no CRM: carimbo derivado do estado, não uma
     segunda verdade que diverge no primeiro update esquecido. */
  published_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint elochat_flows_carimbo_confere check (
    (status = 'publicado' and published_at is not null)
    or (status = 'rascunho' and published_at is null)
  )
);

comment on table public.elochat_flows is
  'Fluxos de automação de direct, um por cliente publicado. NÃO EXECUTA: o motor ainda não existe.';
comment on column public.elochat_flows.nodes is
  'Grafo inteiro em JSONB — lido e escrito sempre completo. Ver o cabeçalho da migration 83.';

/* ⚠️ O ÍNDICE QUE IMPEDE DUAS RESPOSTAS. Parcial: só olha os
   publicados, então rascunho não conflita com nada. */
create unique index if not exists elochat_flows_um_publicado
  on public.elochat_flows (client_id)
  where status = 'publicado';

create index if not exists elochat_flows_client_idx
  on public.elochat_flows (client_id, updated_at desc);

drop trigger if exists elochat_flows_touch on public.elochat_flows;
create trigger elochat_flows_touch
  before update on public.elochat_flows
  for each row execute function app.touch_updated_at();

/* ------------------------------------------------------------------ */
/* Permissões                                                          */
/* ------------------------------------------------------------------ */

/* ⚠️ GRANT ANTES DE POLICY — o Postgres checa o privilégio da tabela
   antes de avaliar RLS, e sem o grant o erro é "permission denied", sem
   menção a policy nenhuma. */
grant select, insert, update, delete on public.elochat_flows to authenticated;

alter table public.elochat_flows enable row level security;

/* Ler segue a visibilidade da carteira, como em toda tabela ligada a
   cliente. */
drop policy if exists elochat_flows_select on public.elochat_flows;
create policy elochat_flows_select on public.elochat_flows
  for select to authenticated
  using (app.client_is_visible(client_id));

/* ESCREVER É DE ADMIN, e aqui a régua é mais alta que a de conteúdo de
   propósito: um fluxo publicado manda mensagem no direct EM NOME DO
   CLIENTE, sem ninguém revisando cada envio. Isso é mais perto de
   credencial do que de pauta — e é a mesma régua de
   `instagram_connections`, que guarda o token da mesma conta.

   Custa o colaborador não poder desenhar. Com a equipe em cinco
   pessoas e duas admin, o custo é pequeno perto de um fluxo entrar no
   ar sem alguém responsável ter olhado. */
drop policy if exists elochat_flows_write on public.elochat_flows;
create policy elochat_flows_write on public.elochat_flows
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());
