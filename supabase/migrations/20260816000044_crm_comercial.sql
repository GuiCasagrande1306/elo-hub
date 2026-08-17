/* =====================================================================
   CRM comercial — o funil de quem ainda não é cliente
   ---------------------------------------------------------------------
   O QUE ESTE MÓDULO É: o lugar onde uma conversa vira contrato. Quem
   procurou a agência, em que pé está, quanto vale, de quem é a bola e
   qual é o próximo passo.

   O QUE ELE NÃO É: um cadastro de cliente. `clients` continua sendo a
   carteira em operação; aqui é o que vem ANTES dela. Um negócio ganho
   vira cliente por um ato explícito, e a partir daí os dois convivem
   ligados por `crm_deals.client_id`.

   A DECISÃO CENTRAL DO ESQUEMA
   ---------------------------------------------------------------------
   `next_action_at` é coluna de primeira classe, e não uma anotação
   dentro de `notes`.

   O que faz Pipedrive funcionar não é o quadro bonito: é a pergunta
   "qual é o próximo passo, e quando?" ser obrigatória de responder.
   Negócio sem próxima ação é negócio esquecido, e a diferença entre um
   CRM e uma planilha é exatamente conseguir LISTAR os esquecidos. Com a
   data numa coluna, "parado há 12 dias" e "vence hoje" são consulta;
   dentro de um texto livre, são leitura humana de cinquenta cartões.

   POR QUE NÃO REAPROVEITEI A TABELA `leads`
   ---------------------------------------------------------------------
   Existe uma `public.leads` no banco — vazia, sem migration neste
   repositório, sem uma única referência no código, e com colunas em
   português (`nome`, `telefone`, `origem`) que não seguem a convenção de
   nenhuma outra tabela. Não dá para saber se algum formulário externo
   escreve nela. Ela fica INTACTA: apagar o que não se entende é como se
   perde dado de verdade. Se um dia alguém confirmar que é lixo, sai numa
   migration própria, que é onde essa decisão fica registrada.

   ETAPAS COMO `text` COM `check`, NÃO ENUM
   ---------------------------------------------------------------------
   Mesma razão da migration 33: enum obriga `alter type ... add value`
   para cada etapa nova e não deixa remover valor. Funil comercial muda
   com o tempo — é o tipo de lista que vai mudar. A lista canônica, com
   rótulo e cor, mora em `src/lib/crm/stages.ts`; o check aqui só impede
   que um typo crie uma etapa fantasma que nenhuma tela sabe desenhar.
   ===================================================================== */

create table if not exists public.crm_deals (
  id            uuid primary key default gen_random_uuid(),

  /* O NOME DO NEGÓCIO, não da empresa. "Pizzaria Dom Léo — gestão de
     tráfego" e "Pizzaria Dom Léo — social media" são dois negócios com
     a mesma empresa, e essa é a situação normal, não a exceção. */
  title         text not null check (length(btrim(title)) between 1 and 200),
  company       text check (length(company) <= 200),

  contact_name  text check (length(contact_name) <= 200),
  contact_phone text check (length(contact_phone) <= 60),
  contact_email text check (length(contact_email) <= 200),

  stage         text not null default 'novo' check (stage in (
                  'novo', 'contato', 'reuniao', 'proposta',
                  'negociacao', 'ganho', 'perdido'
                )),

  origem        text not null default 'outro' check (origem in (
                  'indicacao', 'instagram', 'trafego_pago', 'prospeccao',
                  'site', 'evento', 'outro'
                )),

  /* DINHEIRO EM CENTAVOS, como em todo o resto do sistema.
     Dois valores porque a agência vende os dois: a mensalidade é o que
     entra no MRR, o setup é uma vez só. Somar os dois num campo faria a
     previsão de receita recorrente mentir todo mês. */
  monthly_fee_cents integer not null default 0 check (monthly_fee_cents >= 0),
  setup_fee_cents   integer not null default 0 check (setup_fee_cents >= 0),

  /* De quem é a bola. `set null` e não `cascade`: quem sai da equipe não
     leva o histórico comercial junto. */
  owner_id      uuid references public.profiles (id) on delete set null,

  expected_close_date date,

  /* ⚠️ O CORAÇÃO DO MÓDULO — ver o comentário do topo.
     `next_action` é o que fazer; `next_action_at` é quando. Os dois
     juntos ou nenhum: metade disso é lembrete sem prazo, que é o mesmo
     que nada. O check abaixo garante o par. */
  next_action    text check (length(next_action) <= 300),
  next_action_at date,

  /* Só faz sentido em 'perdido', e o check amarra isso. Perder sem dizer
     por quê é jogar fora a única informação que o funil produz de graça:
     onde a venda morre. */
  lost_reason   text check (lost_reason in (
                  'preco', 'timing', 'concorrente', 'sem_retorno',
                  'nao_qualificado', 'outro'
                )),

  notes         text,

  /* Preenchido quando o negócio vira conta em `clients`. `set null`
     porque apagar um cliente não pode apagar a história de como ele
     chegou. */
  client_id     uuid references public.clients (id) on delete set null,

  /* Carimbos de desfecho. Derivados por trigger a partir de `stage` —
     duas fontes para o mesmo fato divergiriam no primeiro update que
     esquecesse uma delas. */
  won_at        timestamptz,
  lost_at       timestamptz,

  /* Ordem dentro da coluna do quadro. Mesmo padrão de `tasks.position`:
     um número grande vindo do relógio, que deixa arrastar sem
     renumerar a coluna inteira. */
  position      bigint not null default 0,

  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  /* Próxima ação é par ou nada. */
  constraint crm_deals_next_action_par check (
    (next_action is null and next_action_at is null)
    or (next_action is not null and next_action_at is not null)
  ),

  /* Motivo de perda só existe em negócio perdido. Impede o resto do
     sistema de ter que perguntar "este motivo ainda vale?" ao ler uma
     linha que voltou para negociação. */
  constraint crm_deals_motivo_so_em_perdido check (
    lost_reason is null or stage = 'perdido'
  )
);

comment on table public.crm_deals is
  'Funil comercial: quem ainda não é cliente. Um negócio ganho vira conta em clients por ato explícito.';
comment on column public.crm_deals.next_action_at is
  'Quando é o próximo passo. É esta coluna que permite listar negócio esquecido — a razão de o módulo existir.';
comment on column public.crm_deals.monthly_fee_cents is
  'Mensalidade proposta, em CENTAVOS. Separada do setup para a previsão de recorrente não misturar valor de uma vez só.';

/* Índices pelas três perguntas que a tela faz:
   "o que está em cada coluna", "o que está atrasado", "o que é meu". */
create index if not exists crm_deals_stage_idx
  on public.crm_deals (stage, position desc);
create index if not exists crm_deals_next_action_idx
  on public.crm_deals (next_action_at) where stage not in ('ganho', 'perdido');
create index if not exists crm_deals_owner_idx
  on public.crm_deals (owner_id) where stage not in ('ganho', 'perdido');

/* ------------------------------------------------------------------ */
/* Linha do tempo                                                      */
/* ------------------------------------------------------------------ */

/* O que aconteceu no negócio, em ordem. É o que HubSpot e Pipedrive
   chamam de timeline, e é o que transforma "status atual" em história:
   sem isto, ninguém consegue responder "por que este negócio está há
   três semanas em proposta?".

   Mudança de etapa entra aqui SOZINHA, por trigger — depender de a
   aplicação lembrar de registrar produz um histórico com buracos, que é
   pior que não ter histórico, porque parece completo. */
create table if not exists public.crm_activities (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.crm_deals (id) on delete cascade,

  kind       text not null default 'nota' check (kind in (
               'nota', 'ligacao', 'reuniao', 'email', 'whatsapp', 'etapa'
             )),
  body       text not null check (length(btrim(body)) between 1 and 4000),

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.crm_activities is
  'Linha do tempo do negócio. O tipo "etapa" é escrito por trigger, nunca pela aplicação.';

create index if not exists crm_activities_deal_idx
  on public.crm_activities (deal_id, created_at desc);

/* ------------------------------------------------------------------ */
/* Gatilhos                                                            */
/* ------------------------------------------------------------------ */

drop trigger if exists crm_deals_touch on public.crm_deals;
create trigger crm_deals_touch
  before update on public.crm_deals
  for each row execute function app.touch_updated_at();

/**
 * Carimba o desfecho e registra a mudança de etapa na linha do tempo.
 *
 * SECURITY DEFINER porque escreve em `crm_activities` em nome de quem
 * moveu o cartão — e a policy de insert daquela tabela exige
 * `created_by = auth.uid()`, que continua sendo respeitado aqui: o
 * valor gravado é a sessão, não um id escolhido pelo trigger.
 */
create or replace function app.stamp_crm_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.stage is distinct from old.stage then
    /* Voltar de 'ganho'/'perdido' LIMPA o carimbo. Sem isso um negócio
       reaberto continuaria contando como ganho no relatório do mês. */
    new.won_at  := case when new.stage = 'ganho'   then now() else null end;
    new.lost_at := case when new.stage = 'perdido' then now() else null end;

    if new.stage <> 'perdido' then
      new.lost_reason := null;
    end if;

    insert into public.crm_activities (deal_id, kind, body, created_by)
    values (
      new.id,
      'etapa',
      format('Etapa mudou de %s para %s', old.stage, new.stage),
      (select auth.uid())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_crm_deal on public.crm_deals;
create trigger stamp_crm_deal
  before update on public.crm_deals
  for each row execute function app.stamp_crm_deal();

/* ------------------------------------------------------------------ */
/* Permissões                                                          */
/* ------------------------------------------------------------------ */

/* ⚠️ GRANT ANTES DE POLICY: o Postgres checa o privilégio da tabela
   ANTES de avaliar RLS, e sem o grant a policy nunca chega a ser lida —
   o erro que sai é "permission denied", sem menção a policy nenhuma.
   Foi exatamente o que segurou a edição de otimização por semanas. */
grant select, insert, update, delete on public.crm_deals      to authenticated;
grant select, insert, update on public.crm_activities to authenticated;

alter table public.crm_deals      enable row level security;
alter table public.crm_activities enable row level security;

drop policy if exists crm_deals_select on public.crm_deals;
drop policy if exists crm_deals_insert on public.crm_deals;
drop policy if exists crm_deals_update on public.crm_deals;
drop policy if exists crm_deals_delete on public.crm_deals;

/* O FUNIL É DA EQUIPE, não de cada vendedor. Mesma régua de `clients`,
   que é `using (true)` desde a migration 10: numa agência deste tamanho
   quem atende precisa saber o que está entrando. `owner_id` diz de quem
   é a bola; não é uma cerca. */
create policy crm_deals_select on public.crm_deals
  for select to authenticated using (true);

/* Autoria vem da sessão — não pode ser forjada pelo formulário. */
create policy crm_deals_insert on public.crm_deals
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy crm_deals_update on public.crm_deals
  for update to authenticated using (true) with check (true);

/* Apagar é só de admin. Perder um negócio é mudar a ETAPA para
   'perdido', que preserva o motivo e a história; `delete` é para
   duplicata e engano de digitação, e não precisa estar na mão de todos. */
create policy crm_deals_delete on public.crm_deals
  for delete to authenticated using (app.is_admin());

drop policy if exists crm_activities_select on public.crm_activities;
drop policy if exists crm_activities_insert on public.crm_activities;

create policy crm_activities_select on public.crm_activities
  for select to authenticated using (true);

create policy crm_activities_insert on public.crm_activities
  for insert to authenticated
  with check (created_by = (select auth.uid()));

/* SEM policy de update nem de delete, e sem grant para eles: a linha do
   tempo é append-only. Reescrever o histórico de uma negociação é
   apagar a única prova do que foi combinado — a mesma regra que vale
   para a esteira. */
