/* =====================================================================
   Financeiro do cliente fora da tabela pública
   ---------------------------------------------------------------------
   A migração anterior abriu `clients` para leitura de toda a equipe —
   decisão certa para a carteira, errada para o contrato. Honorário e
   CNPJ ficaram legíveis por qualquer colaborador via API, mesmo sem
   tela que os mostrasse.

   RLS é por LINHA, não por coluna: não há policy capaz de esconder uma
   coluna de quem pode ler a linha. A única saída é separar a tabela.

   Depois desta migração, `clients` guarda o que é operacional (nome,
   nicho, marca, destino de relatório) e `client_financials` guarda o
   que é contratual, trancado em admin.

   `legal_name` FICA em `clients` de propósito: razão social é dado
   público de registro, não competitivo, e aparece no cabeçalho de
   documento que o próprio time emite.
   ===================================================================== */

create table if not exists public.client_financials (
  /* PK = FK. Um cliente tem no máximo uma linha financeira, e o vínculo
     é o próprio identificador — evita a linha órfã que uma PK própria
     permitiria. `on delete cascade`: contrato sem cliente não existe. */
  client_id uuid primary key
    references public.clients (id) on delete cascade,

  monthly_fee_cents bigint not null default 0
    check (monthly_fee_cents >= 0),

  -- CNPJ/CPF. O webhook de pagamento casa o pagador por este campo.
  tax_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.client_financials is
  'Dados contratuais do cliente. Acesso exclusivo de admin — ver policies.';

drop trigger if exists client_financials_touch on public.client_financials;

create trigger client_financials_touch
  before update on public.client_financials
  for each row execute function app.touch_updated_at();

/* --- Transferência ---------------------------------------------------
   Antes do DROP, e só para quem tem algo a transferir. `on conflict do
   nothing` torna a migração repetível sem duplicar. */
insert into public.client_financials (client_id, monthly_fee_cents, tax_id)
select id, coalesce(monthly_fee_cents, 0), tax_id
  from public.clients
 on conflict (client_id) do nothing;

alter table public.clients drop column if exists monthly_fee_cents;
alter table public.clients drop column if exists tax_id;

/* --- Cofre -----------------------------------------------------------
   Uma policy `for all`, não quatro. Menos superfície para divergir: com
   políticas separadas, um SELECT esquecido em `using (true)` abriria a
   tabela inteira sem que as outras três denunciassem.

   `using` governa quais linhas são vistas/alteradas; `with check`
   governa o que pode ser gravado. As duas com `app.is_admin()` porque
   colaborador não lê NEM escreve aqui. */
alter table public.client_financials enable row level security;

revoke all on public.client_financials from anon, authenticated;
grant select, insert, update, delete on public.client_financials to authenticated;

drop policy if exists client_financials_admin on public.client_financials;

create policy client_financials_admin on public.client_financials
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

comment on policy client_financials_admin on public.client_financials is
  'Somente admin. Colaborador não lê nem escreve — é o contrato da agência.';

/* Sem Realtime nesta tabela: o broadcast respeita RLS, mas cada linha
   que trafega é uma chance a mais de vazamento por configuração errada.
   Dado contratual não precisa de tempo real. */
