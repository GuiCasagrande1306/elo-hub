/* =====================================================================
   Grupos do WhatsApp em tabela
   ---------------------------------------------------------------------
   O seletor de destino nunca conseguiu listar os grupos, e a causa não
   era rate limit: são 231 grupos nesta conta, e `group/fetchAllGroups`
   pede metadados de CADA UM à Meta. Medido: 110 segundos para uma
   resposta completa de 124KB.

   Nenhum ajuste de timeout resolve isso. A função da Vercel morre em 60s
   no plano atual, então a varredura não cabe numa requisição — nem na
   do formulário, nem num cron.

   A saída é separar as duas coisas. A varredura vira trabalho raro,
   rodado de fora da Vercel (`node scripts/evolution.mjs sincronizar`),
   onde não existe teto de tempo. O formulário lê desta tabela e responde
   na hora. Grupo de cliente nasce uma vez por onboarding — não precisa
   ser tempo real, precisa existir.

   ESCRITA SÓ POR `service_role`. Não há policy de insert/update/delete
   para `authenticated`, de propósito: quem grava é o script, com a
   chave de serviço. Uma sessão de navegador não tem como inventar
   destino para os relatórios de outra pessoa. Mesmo desenho de
   `integration_secrets`.
   ===================================================================== */

create table if not exists public.whatsapp_groups (
  /* Dono da INSTÂNCIA, não do cliente: só se posta em grupo de que o
     próprio celular participa, então a lista é por pessoa. */
  user_id    uuid not null references auth.users(id) on delete cascade,
  jid        text not null,
  name       text not null,
  updated_at timestamptz not null default now(),

  primary key (user_id, jid)
);

comment on table public.whatsapp_groups is
  'Espelho dos grupos do WhatsApp por usuário. Preenchido por scripts/evolution.mjs sincronizar — a varredura leva ~110s e não cabe numa função da Vercel.';

/* Busca por nome no seletor. `text_pattern_ops` não serve para busca no
   meio da string; o volume aqui é de centenas de linhas por usuário, e
   ordenar por nome é o que a tela faz. */
create index if not exists whatsapp_groups_user_name_idx
  on public.whatsapp_groups (user_id, name);

alter table public.whatsapp_groups enable row level security;

/* GRANT ANTES DA POLICY, e não é redundância.

   O Postgres checa privilégio de TABELA antes de olhar RLS. Sem este
   grant a policy abaixo nunca chega a ser avaliada: o select falha por
   permissão e a aplicação recebe zero linhas, silenciosamente — que foi
   exatamente o que aconteceu aqui, e já é a terceira tabela deste
   projeto a cair nisso (ver migrations 17 e 18).

   Só SELECT. Escrita continua exclusiva do `service_role`, que ignora
   RLS e é quem o script de sincronização usa. */
grant select on public.whatsapp_groups to authenticated;

drop policy if exists whatsapp_groups_select on public.whatsapp_groups;

create policy whatsapp_groups_select on public.whatsapp_groups
  for select to authenticated
  using (user_id = auth.uid());

comment on policy whatsapp_groups_select on public.whatsapp_groups is
  'Cada um vê apenas os grupos do próprio WhatsApp. Escrita é exclusiva do service_role.';
