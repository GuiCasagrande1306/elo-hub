/* =====================================================================
   Meta de gasto percentual
   ---------------------------------------------------------------------
   Complemento da migration 90, que só suportava valor fixo em centavos.
   Alguns gestores preferem pensar em percentual do faturamento ("folha
   não pode passar de 40%") — que muda de mês para mês e seria inútil
   como valor fixo.

   EXCLUSÃO MÚTUA: `limit_cents` e `percent` não podem coexistir na
   mesma linha. A check abaixo garante isso, e a UI só envia um dos dois.

   NULL EM AMBOS = sem meta — o mesmo significado de antes.
   ===================================================================== */

alter table public.expense_budgets
  add column if not exists percent numeric(5,2)
    check (percent > 0 and percent <= 100);

/* limit_cents era NOT NULL na migration 90, mas agora é exclusivo com
   percent — quando a meta é percentual, limit_cents deve ficar NULL. */
alter table public.expense_budgets
  alter column limit_cents drop not null;

alter table public.expense_budgets
  drop constraint if exists expense_budgets_limit_or_percent;

alter table public.expense_budgets
  add constraint expense_budgets_limit_or_percent check (
    NOT (limit_cents IS NOT NULL AND percent IS NOT NULL)
  );

comment on column public.expense_budgets.percent is
  'Meta como percentual do faturamento do mês (0–100). Exclusivo com limit_cents.';

/* Atualizar a função para devolver também o percent e calcular o
   limite efetivo quando a meta é percentual.

   p_income_cents: receita recebida no mês (para calcular o valor
   equivalente da meta %). Pode ser 0 — a função devolve o percent e
   o chamador decide como exibir. */
create or replace function public.expense_budget_status(
  p_month date,
  p_income_cents bigint default 0
)
returns table (
  category          text,
  tem_meta          boolean,
  tipo_meta         text,      -- 'fixed' | 'percent' | 'none'
  percent           numeric,
  limite_cents      bigint,
  pago_cents        bigint,
  previsto_cents    bigint,
  lancamentos       bigint
)
language sql
stable
security definer
as $$
  with categorias(cat) as (
    values
      ('ad_spend'::text),
      ('salary'::text),
      ('contractor'::text),
      ('software'::text),
      ('office'::text),
      ('tax'::text),
      ('other'::text)
  ),
  metas as (
    select
      category,
      limit_cents,
      percent
    from public.expense_budgets
    where month = date_trunc('month', p_month)::date
  ),
  gastos as (
    select
      category::text,
      coalesce(sum(amount_cents) filter (where status = 'paid'),    0) as pago,
      coalesce(sum(amount_cents) filter (where status = 'pending'), 0) as previsto,
      count(*) as n
    from public.financial_transactions
    where
      type     = 'expense'
      and status not in ('canceled')
      and date_trunc('month', coalesce(paid_date, due_date)) = date_trunc('month', p_month)
    group by category
  )
  select
    c.cat                                                              as category,
    (m.limit_cents is not null or m.percent is not null)              as tem_meta,
    case
      when m.limit_cents is not null then 'fixed'
      when m.percent     is not null then 'percent'
      else                                'none'
    end                                                               as tipo_meta,
    m.percent                                                         as percent,
    case
      when m.limit_cents is not null then m.limit_cents
      when m.percent     is not null then round(p_income_cents * m.percent / 100)
      else                                0
    end                                                               as limite_cents,
    coalesce(g.pago,     0)                                           as pago_cents,
    coalesce(g.previsto, 0)                                           as previsto_cents,
    coalesce(g.n,        0)                                           as lancamentos
  from categorias c
  left join metas  m on m.category::text = c.cat
  left join gastos g on g.category       = c.cat
  order by c.cat;
$$;
