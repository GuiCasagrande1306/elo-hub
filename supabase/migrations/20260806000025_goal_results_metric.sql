/* =====================================================================
   A meta guarda em que UNIDADE ela foi escrita
   ---------------------------------------------------------------------
   `planned_results` sempre foi uma CONTAGEM: 120 leads, 260 pedidos. A
   partir de agora, loja virtual e delivery passam a definir a meta em
   FATURAMENTO — e aí o mesmo campo guarda centavos.

   O número sozinho é ambíguo, e essa ambiguidade é perigosa de um jeito
   específico: uma meta antiga de 120 compras, relida como dinheiro,
   vira "R$ 1,20". A barra do card mostraria 30.000% de superação e o
   histórico inteiro passaria a contar uma história falsa — exatamente o
   tipo de número plausível-e-errado que já custou três telas aqui.

   Derivar a unidade do SEGMENTO na hora da leitura não resolve: o
   segmento é editável, e mudar um cliente de "leads" para "e-commerce"
   reinterpretaria retroativamente todas as metas já fechadas.

   Por isso a unidade vira dado da própria linha, gravada quando a meta
   é escrita. NULL = contagem, que é o que toda linha existente
   significa. Nenhum backfill: as metas antigas já estão corretas sob
   essa leitura.
   ===================================================================== */

alter table public.client_goals
  add column if not exists results_metric text;

do $$
begin
  alter table public.client_goals
    add constraint client_goals_results_metric_valid
    check (results_metric in ('count', 'revenue'));
exception
  when duplicate_object then null;
end $$;

comment on column public.client_goals.results_metric is
  'Unidade de planned_results: count = conversões, revenue = centavos. NULL = count (metas anteriores à coluna).';


/* ---------------------------------------------------------------------
   Padrão pelo segmento, no INSERT

   `create_client_with_setup` grava cliente e meta na mesma transação e
   não recebe a unidade. Em vez de mexer na assinatura da função — que
   obrigaria a recriar a RPC inteira e a atualizar o formulário de
   cadastro no mesmo deploy — o padrão fica aqui, do lado do dado.

   Só age quando a coluna vem NULL. Quem envia a unidade explicitamente
   (o formulário de meta) manda nela.

   Sem trigger no UPDATE de propósito: mudar o segmento de um cliente
   não pode reescrever a unidade de metas já fechadas.
   ------------------------------------------------------------------ */

create or replace function app.default_goal_results_metric()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.results_metric is null then
    select case c.segment
             when 'ecommerce' then 'revenue'
             when 'delivery'  then 'revenue'
             else 'count'
           end
      into new.results_metric
      from public.clients c
     where c.id = new.client_id;

    -- Cliente não encontrado (não deveria acontecer: há FK) cai em
    -- contagem, que é o padrão histórico e o mais conservador.
    new.results_metric := coalesce(new.results_metric, 'count');
  end if;

  return new;
end;
$$;

drop trigger if exists client_goals_default_metric on public.client_goals;

create trigger client_goals_default_metric
  before insert on public.client_goals
  for each row execute function app.default_goal_results_metric();
