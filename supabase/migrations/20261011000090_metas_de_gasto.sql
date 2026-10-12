/* =====================================================================
   Meta de gasto por categoria, mês a mês
   ---------------------------------------------------------------------
   Pedido do Guilherme em 11/10/2026, junto com a reforma do setor
   financeiro: além de registrar o que saiu, dizer quanto PODIA sair.

   ⚠️ O LADO DA DESPESA ESTÁ VAZIO HOJE. Medido em 11/10/2026: as 79
   linhas de `financial_transactions` são TODAS receita, todas digitadas
   à mão, todas `client_fee`. Nenhuma despesa foi lançada desde que a
   tabela existe, e `recurring_expenses` tem zero linhas.

   Isso muda o que esta tabela significa no começo: ela não vai
   "apertar" um gasto que já é medido — ela é o primeiro lugar do
   sistema onde a agência escreve quanto pretende gastar. O confronto
   com o realizado só fica honesto quando a despesa começar a entrar,
   e é por isso que a tela precisa mostrar "sem lançamento no mês" em
   vez de "0% da meta": zero gasto e zero registro são coisas
   diferentes, e confundir as duas faz o mês parecer excelente
   justamente quando ninguém anotou nada.

   UMA LINHA POR MÊS E CATEGORIA, e não uma meta "vigente" que vale
   para sempre. Orçamento de agência muda com a carteira: dezembro tem
   13º, janeiro tem imposto, o mês que entra um cliente grande tem mais
   freelancer. Uma meta única obrigaria a reescrever a história para
   corrigir o mês que vem.

   O MÊS É SEMPRE DIA 1. Sem a normalização, "setembro" vira três
   linhas diferentes conforme quem digitou escolheu 01, 05 ou 30 — e a
   junção com `financial_monthly_summary`, que agrupa por
   `date_trunc('month', ...)`, passaria a somar errado sem erro nenhum.
   ===================================================================== */

create table if not exists public.expense_budgets (
  id          uuid primary key default gen_random_uuid(),

  /* Sempre o primeiro dia do mês — ver a nota acima. */
  month       date not null,
  category    public.transaction_category not null,

  /* Zero é meta legítima: "nesta categoria não quero gastar nada" é
     uma decisão, diferente de não ter meta (que é a linha não existir). */
  limit_cents bigint not null check (limit_cents >= 0),

  /* Por que a agência escolheu este número. Some na tela quando vazio;
     existe porque "R$ 4.000 em freelancer" sem contexto vira discussão
     no mês seguinte sobre o que estava combinado. */
  note        text,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint expense_budgets_month_normalizado
    check (month = date_trunc('month', month)::date),

  /* ⚠️ META SÓ EM CATEGORIA DE DESPESA. `client_fee` e `project_fee`
     são receita; "meta de gasto em honorário de cliente" não quer
     dizer nada, e uma linha dessas apareceria na tela somando contra
     um realizado que é entrada. O enum é compartilhado entre os dois
     lados, então a trava mora aqui.

     Se um dia entrar categoria de despesa nova no enum, ela precisa
     ser acrescentada aqui — e é de propósito que o banco recuse em vez
     de aceitar em silêncio. */
  constraint expense_budgets_so_despesa
    check (category in (
      'ad_spend', 'salary', 'contractor', 'software', 'office', 'tax', 'other'
    )),

  unique (month, category)
);

create index if not exists expense_budgets_month_idx
  on public.expense_budgets (month desc);

drop trigger if exists touch_expense_budgets on public.expense_budgets;
create trigger touch_expense_budgets
  before update on public.expense_budgets
  for each row execute function app.touch_updated_at();

comment on table public.expense_budgets is
  'Quanto a agência pretende gastar por categoria em cada mês. Confrontada com financial_transactions do tipo expense. Admin-only, como todo o financeiro.';

/* ---------------------------------------------------------------------
   ⚠️ GRANT ANTES DE POLICY. Terceira vez nesta base (ver migrations 44,
   84 e 89): o Postgres confere privilégio de TABELA antes de avaliar
   RLS. Sem o grant, a policy abaixo nunca chega a ser lida e o erro é
   "permission denied for table expense_budgets", sem uma palavra sobre
   policy — manda a pessoa depurar no lugar errado.
   ------------------------------------------------------------------ */

grant select, insert, update, delete on public.expense_budgets to authenticated;

alter table public.expense_budgets enable row level security;

drop policy if exists expense_budgets_admin_only on public.expense_budgets;

/* Mesma régua de `financial_transactions`: dinheiro da agência é
   admin. Decisão confirmada pelo Guilherme em 11/10/2026. */
create policy expense_budgets_admin_only on public.expense_budgets
  for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());


/* ---------------------------------------------------------------------
   Meta contra realizado, num round trip
   ---------------------------------------------------------------------
   Devolve TODA categoria de despesa, mesmo sem meta e sem lançamento —
   pelo mesmo motivo que `financial_monthly_summary` usa
   `generate_series`: categoria que some da lista não é lida como
   "zerada", é lida como inexistente, e some da conferência.

   `tem_meta` separado de `limite_cents = 0`: meta zero é decisão, meta
   ausente é esquecimento. A tela precisa distinguir as duas.

   `lancamentos` existe para a tela poder dizer "sem lançamento no mês"
   em vez de "0% da meta" — ver a nota no topo do arquivo.

   PAGO E PREVISTO SEPARADOS. `financial_monthly_summary` só conta
   `paid`, e para o fechamento isso está certo. Aqui não: quem olha a
   meta no dia 10 precisa ver o que já comprometeu, senão estoura o
   orçamento com contas que já existem e ainda não venceram.

   `security invoker` para herdar a policy acima — sem isso a função
   viraria um buraco na trava de admin.
   ------------------------------------------------------------------ */

create or replace function public.expense_budget_status(p_month date)
returns table (
  category        public.transaction_category,
  tem_meta        boolean,
  limite_cents    bigint,
  pago_cents      bigint,
  previsto_cents  bigint,
  lancamentos     int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mes as (
    select date_trunc('month', p_month)::date as m
  ),
  categorias as (
    select unnest(array[
      'ad_spend', 'salary', 'contractor', 'software', 'office', 'tax', 'other'
    ]::public.transaction_category[]) as category
  ),
  gasto as (
    select
      t.category,
      sum(t.amount_cents) filter (where t.status = 'paid')    as pago,
      sum(t.amount_cents) filter (where t.status = 'pending') as previsto,
      count(*) filter (where t.status <> 'canceled')          as n
    from public.financial_transactions t, mes
    where t.type = 'expense'
      and date_trunc('month', coalesce(t.paid_date, t.due_date))::date = mes.m
    group by t.category
  )
  select
    c.category,
    (b.id is not null)                  as tem_meta,
    coalesce(b.limit_cents, 0)::bigint  as limite_cents,
    coalesce(g.pago, 0)::bigint         as pago_cents,
    coalesce(g.previsto, 0)::bigint     as previsto_cents,
    coalesce(g.n, 0)::int               as lancamentos
  from categorias c
  cross join mes
  left join public.expense_budgets b
    on b.category = c.category and b.month = mes.m
  left join gasto g on g.category = c.category
  order by c.category;
$$;

comment on function public.expense_budget_status(date) is
  'Meta contra realizado por categoria de despesa num mês. Toda categoria aparece, com ou sem meta e com ou sem lançamento — ver a nota no arquivo da migration 90.';
