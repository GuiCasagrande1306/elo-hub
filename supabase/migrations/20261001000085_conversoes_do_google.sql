/* =====================================================================
   As conversões do Google, por ação — o zero que escondia dez
   ---------------------------------------------------------------------
   SINTOMA: a ficha da Agenda Contabilidade mostrava "0 leads" ao lado
   de R$ 199,98 investidos em setembro. O próprio Google Ads mostrava
   "Conversões 0,00" na mesma janela, então o sync não estava errado.

   CAUSA, medida na API em 01/10/2026: `metrics.conversions` traz 0 e
   `metrics.all_conversions` traz 10 — 1 ligação, 6 rotas e 3
   interações. AÇÃO LOCAL vinda do Perfil da Empresa é contabilizada
   SÓ em "todas as conversões", nunca na coluna principal. É regra da
   plataforma, não defeito nosso.

   ⚠️ E A CORREÇÃO ÓBVIA ESTÁ ERRADA. Trocar a coluna lida por
   `all_conversions` inflaria o Atacado de Pratas de 175 para 9.516,
   porque 9.322 daquilo é "Adicionar ao carrinho" — 54 vezes o número
   certo, num relatório que vai para o cliente. Medido na mesma
   varredura. Por isso esta tabela guarda POR AÇÃO, e quem classifica
   é `src/lib/ads/categorias-google.ts`.

   POR QUE TABELA NOVA, e não colunas em `daily_metrics`. Uma conta tem
   de duas a cinco ações de conversão, e elas mudam quando o cliente
   mexe no rastreamento. Caberiam como jsonb, mas "quantas rotas em
   setembro" viraria varredura de json em vez de soma com índice — e
   essa é a pergunta que a tela faz.

   ESCRITA SÓ PELO SYNC, que roda com a chave de serviço. Por isso não
   há grant de escrita para `authenticated`: ninguém digita conversão à
   mão, e deixar a porta aberta convidaria a "corrigir" um número que
   veio da plataforma.
   ===================================================================== */

create table if not exists public.google_conversion_daily (
  client_id   uuid not null references public.clients (id) on delete cascade,
  metric_date date not null,

  /* O nome que o cliente deu à ação no Google Ads. Fica como veio: é
     o que ele reconhece ao conferir contra o painel dele. */
  action_name text not null check (length(action_name) between 1 and 200),

  /* `segments.conversion_action_category`. Texto e não enum: o Google
     acrescenta categoria sem avisar, e um enum exigiria migration para
     cada novidade — com o sync quebrando até alguém rodar. A lista
     conhecida mora no TypeScript; aqui entra o que vier. */
  category    text,

  /* ⚠️ OS DOIS NÚMEROS, e é o ponto da tabela. `conversions` é a
     coluna principal do Google; `all_conversions` inclui ação local e
     micro-evento. Guardar só um apagaria exatamente a diferença que
     este módulo existe para enxergar. */
  conversions     numeric(14,2) not null default 0,
  all_conversions numeric(14,2) not null default 0,

  updated_at timestamptz not null default now(),

  primary key (client_id, metric_date, action_name)
);

comment on table public.google_conversion_daily is
  'Conversões do Google por ação e por dia. Existe porque ação local do Perfil da Empresa não entra em metrics.conversions — ver migration 85.';
comment on column public.google_conversion_daily.all_conversions is
  'Inclui ação local e micro-evento. NÃO somar sem classificar: 9.322 das 9.516 do Atacado eram "adicionar ao carrinho".';

/* A consulta da tela é sempre "este cliente, esta janela". */
create index if not exists google_conversion_daily_janela_idx
  on public.google_conversion_daily (client_id, metric_date desc);

/* ------------------------------------------------------------------ */
/* Permissões                                                          */
/* ------------------------------------------------------------------ */

/* ⚠️ GRANT ANTES DE POLICY — sem o privilégio de tabela o Postgres nem
   avalia a policy, e o erro que sai é "permission denied" sem menção a
   policy nenhuma. Foi o que derrubou o link do cliente na migration 80
   e custou uma investigação inteira. Aqui só LEITURA: quem escreve é o
   sync, com a chave de serviço. */
grant select on public.google_conversion_daily to authenticated;

alter table public.google_conversion_daily enable row level security;

drop policy if exists google_conversion_daily_select on public.google_conversion_daily;
create policy google_conversion_daily_select on public.google_conversion_daily
  for select to authenticated
  using (app.client_is_visible(client_id));
