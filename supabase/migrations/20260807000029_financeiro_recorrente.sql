/* =====================================================================
   Recorrência do financeiro
   ---------------------------------------------------------------------
   A planilha da agência tem duas metades: ENTRADA (fee mensal por
   cliente, com dia de pagamento) e SAÍDA (folha, assinaturas, impostos).
   `financial_transactions` já sabe representar as duas — o que falta é
   de onde elas nascem todo mês.

   GERAR LINHAS, não calcular na hora. Um lançamento materializado pode
   ser baixado com atraso, receber desconto pontual ou ser cancelado sem
   mexer no contrato. Um valor calculado na leitura não tem onde
   registrar que o D'Rancho pagou dia 12 em vez do dia 3 — e é justamente
   isso que a planilha faz hoje e o sistema precisa fazer melhor.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Dia de cobrança do cliente

   1 a 28, não 1 a 31, pela mesma razão do `report_day`: fevereiro
   existe, e um cliente com vencimento no dia 30 nunca seria cobrado.
   ------------------------------------------------------------------ */

alter table public.client_financials
  add column if not exists billing_day smallint;

do $$
begin
  alter table public.client_financials
    add constraint client_financials_billing_day_valid
    check (billing_day is null or billing_day between 1 and 28);
exception
  when duplicate_object then null;
end $$;

comment on column public.client_financials.billing_day is
  'Dia do mês do vencimento do fee. NULL = cliente sem cobrança recorrente.';


/* ---------------------------------------------------------------------
   Despesas recorrentes — a metade de SAÍDA da planilha
   ------------------------------------------------------------------ */

create table if not exists public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),

  description   text not null,
  category      public.transaction_category not null default 'other',

  /* Centavos e sempre POSITIVO, como em `financial_transactions`: o
     sinal vem do tipo, não do valor. Despesa negativa faz soma ingênua
     "funcionar" e esconde erro de classificação. */
  amount_cents  bigint not null check (amount_cents > 0),

  billing_day   smallint not null check (billing_day between 1 and 28),

  /* Desligar em vez de apagar. Assinatura cancelada em março não pode
     sumir do histórico de janeiro e fevereiro — apagar reescreveria o
     passado do fluxo de caixa. */
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.recurring_expenses is
  'Folha, assinaturas, impostos — o que se repete todo mês. Materializa em financial_transactions pelo job mensal.';


/* ---------------------------------------------------------------------
   IDEMPOTÊNCIA — a parte que impede cobrar duas vezes

   Esta é a decisão central da migration, e não uma otimização.

   O job vai rodar por cron, e cron erra: reexecução manual, retry da
   Vercel depois de timeout, alguém clicando "sincronizar agora" duas
   vezes. Sem chave, a segunda passada duplica os 46 lançamentos do mês —
   e num sistema de dinheiro isso não é um bug de tela, é uma cobrança a
   mais na conta do cliente.

   `recurrence_key` identifica a ORIGEM + o MÊS de forma determinística:

       cliente:<uuid>:2026-09
       despesa:<uuid>:2026-09

   Com `unique`, a segunda inserção falha sozinha. O job vira seguro por
   construção, em vez de depender de o programador lembrar de checar
   antes de inserir.

   NULL para lançamento avulso — vários deles convivem no mesmo mês, e
   `unique` no Postgres NÃO conflita entre NULLs (contanto que ninguém
   escreva `nulls not distinct`, vide a correção no fim deste arquivo).

   CONSTRAINT, não índice parcial `where recurrence_key is not null`: o
   job insere com `on conflict do nothing`, e o Postgres só casa
   ON CONFLICT com índice parcial quando a instrução repete o predicado
   do índice — o PostgREST não envia isso. Constraint plena é o que
   mantém a inferência funcionando, e ela já permite quantos NULLs
   quiser.
   ------------------------------------------------------------------ */

alter table public.financial_transactions
  add column if not exists recurrence_key text;

do $$
begin
  alter table public.financial_transactions
    add constraint financial_transactions_recurrence_key_key
    unique (recurrence_key);
exception
  when duplicate_table or duplicate_object then null;
end $$;

comment on column public.financial_transactions.recurrence_key is
  'Origem + mês (cliente:<uuid>:2026-09). Único: impede que o job duplique a cobrança ao rodar duas vezes. NULL em lançamento avulso.';


/* ---------------------------------------------------------------------
   CORREÇÃO — `unique nulls not distinct` bloqueava lançamento manual

   A migration 07 criou:

       unique nulls not distinct (provider, external_id)

   A intenção era certa (idempotência do webhook de pagamento), mas
   `nulls not distinct` faz o Postgres tratar NULL como valor comparável.
   Consequência: a tabela inteira aceita UMA ÚNICA linha com
   (provider, external_id) = (NULL, NULL).

   Passou despercebido porque hoje o único insert é o do webhook, que
   sempre preenche os dois campos. O job de recorrência insere 46+ linhas
   por mês sem gateway nenhum — a segunda morreria com 23505, e um
   lançamento avulso digitado à mão também.

   A correção é tirar o `nulls not distinct` e ficar com o comportamento
   PADRÃO do SQL: NULL nunca conflita com NULL. O webhook continua
   protegido (dois eventos do mesmo pagamento no mesmo provedor seguem
   barrados), e linhas sem provedor deixam de disputar um único slot.

   NÃO troquei por índice parcial `where provider is not null`, que seria
   a resposta mais óbvia: o webhook faz upsert com
   `onConflict: "provider,external_id"`, e o Postgres só casa ON CONFLICT
   com índice parcial se a instrução repetir o predicado do índice —
   coisa que o PostgREST não tem como enviar. O upsert passaria a falhar
   com "no unique or exclusion constraint matching". Constraint plena
   mantém a inferência funcionando.

   Sem risco de violação ao aplicar: a regra nova é mais permissiva que a
   antiga, então nenhuma linha existente pode estar em conflito.
   ------------------------------------------------------------------ */

alter table public.financial_transactions
  drop constraint if exists financial_transactions_provider_external_id_key;

alter table public.financial_transactions
  add constraint financial_transactions_provider_external_id_key
  unique (provider, external_id);


/* ---------------------------------------------------------------------
   Acesso — financeiro é admin, e continua sendo

   Mesma regra de `client_financials` e `financial_transactions`: fee de
   cliente e folha de pagamento não são dado de operação. O GRANT vem
   antes da policy porque o Postgres checa privilégio de tabela primeiro
   — sem ele a policy nem é avaliada e o select volta vazio, sem erro.
   Terceira tabela deste projeto a precisar desse lembrete (ver 17, 18 e
   26).
   ------------------------------------------------------------------ */

alter table public.recurring_expenses enable row level security;

grant select, insert, update, delete on public.recurring_expenses to authenticated;

drop policy if exists recurring_expenses_admin on public.recurring_expenses;

create policy recurring_expenses_admin on public.recurring_expenses
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

comment on policy recurring_expenses_admin on public.recurring_expenses is
  'Folha e assinaturas são dado financeiro da agência: admin apenas.';
