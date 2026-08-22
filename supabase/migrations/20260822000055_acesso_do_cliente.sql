/* =====================================================================
   Acesso do cliente ao painel — a contenção
   ---------------------------------------------------------------------
   ⚠️ RODE A MIGRATION 54 ANTES. Ela cria o valor 'client' no enum, e
   este arquivo o usa.

   O QUE ESTA MIGRATION DECIDE, e é a decisão mais perigosa do sistema:
   a partir daqui existem pessoas de FORA da agência com login. Um erro
   de policy aqui não mostra um número errado — mostra a base de leads
   de um cliente para outro.

   A CONTENÇÃO É UMA SÓ, E FICA EM `clients`.
   ---------------------------------------------------------------------
   `clients_select` era `using (true)`: toda a carteira visível para
   qualquer autenticado, o que era correto quando só a equipe entrava.

   Quase todas as outras policies do sistema perguntam
   `app.client_is_visible(client_id)`, que é `exists (select 1 from
   clients where id = ...)` rodando SOB A RLS DE QUEM CHAMA. Então
   restringir `clients` restringe, de uma vez e sem tocar em mais nada,
   `daily_metrics`, `tasks`, `social_posts`, `client_goals`,
   `ad_creatives` e o resto.

   Uma trava central em vez de trinta espalhadas: é o desenho que dá
   para conferir lendo, e o único em que uma tabela nova criada daqui a
   seis meses nasce contida por padrão.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. De qual cliente é esta pessoa
   ------------------------------------------------------------------ */

alter table public.profiles
  add column if not exists client_id uuid references public.clients (id)
  on delete cascade;

comment on column public.profiles.client_id is
  'Preenchido só para role = client: a empresa que esta pessoa representa. NULL para a equipe da agência.';

/* O par tem de fazer sentido nos dois sentidos. Pessoa da agência com
   `client_id` teria a visão recortada sem motivo; usuário de cliente
   sem `client_id` enxergaria a carteira inteira — que é exatamente o
   acidente que esta migration existe para impedir. */
alter table public.profiles
  drop constraint if exists profiles_client_role_coerente;

alter table public.profiles
  add constraint profiles_client_role_coerente check (
    (role = 'client' and client_id is not null)
    or (role <> 'client' and client_id is null)
  );

create index if not exists profiles_client_idx
  on public.profiles (client_id) where client_id is not null;


/* ---------------------------------------------------------------------
   2. Quem é quem, sem passar por RLS

   `security definer` de propósito: estas funções são consultadas DENTRO
   das policies, e se elas próprias passassem pela RLS de `profiles` a
   avaliação entraria em recursão — a policy de profiles perguntaria a
   função, que leria profiles, que chamaria a policy.

   `search_path` fixo porque `security definer` sem isso é a receita
   clássica de escalada: um schema no caminho do usuário poderia
   sequestrar o nome de uma tabela.
   ------------------------------------------------------------------ */

create or replace function app.role_of_user()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function app.client_of_user()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select client_id from public.profiles where id = auth.uid();
$$;

comment on function app.client_of_user() is
  'A empresa do usuário logado, ou NULL para a equipe. Usada na policy de clients — ver migration 55.';


/* ---------------------------------------------------------------------
   3. A trava
   ------------------------------------------------------------------ */

drop policy if exists clients_select on public.clients;

create policy clients_select on public.clients for select to authenticated
  using (
    /* Equipe continua vendo tudo; cliente vê a própria linha e mais
       nada. `is not distinct from` e não `=`: com `client_of_user()`
       nulo por qualquer motivo, `=` devolveria NULL, que numa policy é
       tratado como falso — e o usuário ficaria sem ver nem a própria
       empresa, sem erro e sem pista. Aqui a comparação é explícita. */
    case
      when app.role_of_user() = 'client'
        then id is not distinct from app.client_of_user()
      else true
    end
  );

comment on policy clients_select on public.clients is
  'Equipe vê a carteira; usuário de cliente vê só a própria empresa. É a trava central — quase toda outra policy pergunta client_is_visible, que lê esta.';


/* ---------------------------------------------------------------------
   4. Cliente não escreve na própria ficha

   As policies de escrita de `clients` já exigem admin. Isto aqui é o
   cinto extra sobre `profiles`: impedir que um usuário de cliente mude
   o próprio papel ou se mova para outra empresa.
   ------------------------------------------------------------------ */

create or replace function app.guard_client_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Admin manda; a checagem existe para o resto.
  if app.is_admin() then
    return new;
  end if;

  /* Papel e empresa são imutáveis para quem não é admin. Sem isto, um
     usuário de cliente daria um UPDATE em si mesmo trocando `client_id`
     e passaria a enxergar a base de outro. */
  new.role      := old.role;
  new.client_id := old.client_id;

  return new;
end;
$$;

drop trigger if exists guard_client_profile on public.profiles;

create trigger guard_client_profile
  before update on public.profiles
  for each row
  execute function app.guard_client_profile();
