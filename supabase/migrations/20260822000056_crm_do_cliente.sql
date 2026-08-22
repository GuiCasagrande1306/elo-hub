/* =====================================================================
   CRM do cliente — funil, contatos, leads
   ---------------------------------------------------------------------
   ⚠️ RODE 54 E 55 ANTES. A contenção de acesso vive na 55.

   POR QUE TABELAS NOVAS E NÃO `crm_deals`. Aquela tabela é o funil de
   VENDA DA AGÊNCIA: tem `monthly_fee_cents`, `setup_fee_cents` e
   `owner_id` apontando para a equipe. Ela responde "quanto MRR entra se
   fechar". Estas respondem "o lead do cliente virou cliente dele" — são
   negócios diferentes, com donos diferentes e ciclos diferentes.
   Espremer os dois numa tabela só produziria colunas que só valem para
   metade das linhas.

   O DESENHO SEGUE O KOMMO no que ele acertou:

     • FUNIL SEPARADO DE ETAPA. O cliente que vende bolo e aluga espaço
       tem dois processos; um funil só, com etapas de ambos, obriga a
       ignorar metade das colunas o tempo todo.
     • ETAPA COM TIPO, não só nome. "Ganho" e "Perdido" precisam ser
       reconhecíveis pelo sistema para a conta de conversão existir —
       procurar pela palavra "ganho" no nome quebraria no dia em que
       alguém escrever "Fechado".
     • CONTATO SEPARADO DO LEAD. A mesma pessoa volta a comprar. Com
       nome e telefone dentro do card, a segunda compra não sabe que é a
       mesma pessoa, e o histórico do cliente nunca existe.
     • TAREFA COM PRAZO E DONO. É o que faz CRM ser CRM em vez de
       planilha bonita: sem lembrete, o lead esfria em silêncio.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Funis
   ------------------------------------------------------------------ */

create table if not exists public.lead_pipelines (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),

  /* Um funil por cliente nasce como padrão. É onde lead sem destino
     declarado cai — sem isso, a entrada automática (formulário, WhatsApp)
     não teria para onde ir e o lead se perderia. */
  is_default boolean not null default false,
  position   integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* No máximo UM padrão por cliente. Índice parcial e único: dois padrões
   fariam a entrada automática escolher por sorte. */
create unique index if not exists lead_pipelines_um_padrao
  on public.lead_pipelines (client_id) where is_default;

create index if not exists lead_pipelines_client_idx
  on public.lead_pipelines (client_id, position);


/* ---------------------------------------------------------------------
   2. Etapas
   ------------------------------------------------------------------ */

create table if not exists public.lead_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.lead_pipelines (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),

  /* TIPO, não nome. 'aberto' é etapa de trabalho; 'ganho' e 'perdido'
     encerram o lead e são o que a conta de conversão soma. */
  kind        text not null default 'aberto'
              check (kind in ('aberto', 'ganho', 'perdido')),

  /* Cor da coluna no quadro. Guardada por etapa e não derivada do
     índice: reordenar as colunas trocaria a cor de todas, e a equipe
     reconhece a coluna pela cor antes de ler o nome. */
  color       text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  position    integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_stages_pipeline_idx
  on public.lead_stages (pipeline_id, position);


/* ---------------------------------------------------------------------
   3. Contatos
   ------------------------------------------------------------------ */

create table if not exists public.lead_contacts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,

  name       text not null check (length(btrim(name)) between 1 and 200),

  /* Telefone guardado SÓ COM DÍGITOS, normalizado na escrita. Com
     máscara, "(47) 9 9999-9999" e "47999999999" viram duas pessoas — e
     a deduplicação, que é o motivo de o contato existir, não acontece. */
  phone      text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  email      text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  notes      text check (length(notes) <= 4000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* Mesmo telefone, mesmo cliente = mesma pessoa. Índice parcial porque
   contato sem telefone é legítimo (veio por e-mail, por indicação). */
create unique index if not exists lead_contacts_telefone_unico
  on public.lead_contacts (client_id, phone) where phone is not null;

create index if not exists lead_contacts_client_idx
  on public.lead_contacts (client_id, name);


/* ---------------------------------------------------------------------
   4. Leads — a tabela chama `lead_deals`, e não `leads`

   ⚠️ JÁ EXISTE UMA TABELA `public.leads` NESTE BANCO, e ela não é deste
   módulo: colunas `nome, telefone, origem, servico, observacao, status,
   criado_em`, em português, com cara de captação de formulário de
   landing page. Está vazia, mas está lá.

   Um `create table if not exists public.leads` vira NO-OP silencioso
   sobre ela — foi o que aconteceu na primeira tentativa desta migration,
   e o erro só apareceu adiante, na policy: "column client_id does not
   exist". A tabela não era minha, e o `if not exists` escondeu isso.

   `lead_deals` porque é o vocabulário do próprio CRM: o que anda pelo
   funil é um negócio. E não colide com `crm_deals`, que é o funil de
   venda DA AGÊNCIA.
   ------------------------------------------------------------------ */

create table if not exists public.lead_deals (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  pipeline_id uuid not null references public.lead_pipelines (id) on delete cascade,
  stage_id    uuid not null references public.lead_stages (id) on delete restrict,

  /* Contato OPCIONAL de propósito. Lead que chega por formulário sem
     telefone ainda é lead; exigir contato faria a entrada automática
     recusar metade do que recebe. */
  contact_id  uuid references public.lead_contacts (id) on delete set null,

  title       text not null check (length(btrim(title)) between 1 and 200),
  value_cents integer not null default 0 check (value_cents >= 0),

  /* De onde veio. `meta_ads` já está aqui para quando a permissão
     `leads_retrieval` sair — hoje o token só tem `ads_read`, medido em
     22/08/2026, então a entrada é manual. */
  source      text not null default 'manual' check (source in (
                'manual', 'meta_ads', 'google_ads', 'whatsapp',
                'instagram', 'site', 'indicacao', 'telefone', 'outro'
              )),

  /* Quem cuida. Aponta para `profiles`, então serve tanto para a equipe
     da agência quanto para uma pessoa do cliente. */
  owner_id    uuid references public.profiles (id) on delete set null,

  /* Ordem DENTRO da coluna, para o arrastar-e-soltar. Inteiro com passo
     largo na escrita: mover um card entre dois vizinhos consecutivos
     não deve obrigar a renumerar a coluna inteira. */
  position    integer not null default 0,

  /* Fechamento: quando e por quê. `lost_reason` só faz sentido em etapa
     'perdido', e o motivo é a única coisa que um funil produz de graça —
     onde a venda morre. */
  closed_at   timestamptz,
  lost_reason text check (length(lost_reason) <= 300),

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_deals_quadro_idx
  on public.lead_deals (client_id, pipeline_id, stage_id, position);

create index if not exists lead_deals_contato_idx
  on public.lead_deals (contact_id) where contact_id is not null;

/* Entrada por formulário precisa ser idempotente: a Meta reenvia o
   mesmo lead quando o webhook não confirma, e sem isto o mesmo contato
   aparece três vezes no quadro. Preenchido só pela ingestão. */
alter table public.lead_deals
  add column if not exists external_id text;

create unique index if not exists lead_deals_externo_unico
  on public.lead_deals (client_id, source, external_id)
  where external_id is not null;


/* ---------------------------------------------------------------------
   5. Anotações e tarefas
   ------------------------------------------------------------------ */

create table if not exists public.lead_notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.lead_deals (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists lead_notes_deal_idx
  on public.lead_notes (deal_id, created_at desc);

create table if not exists public.lead_tasks (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.lead_deals (id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 200),

  /* PRAZO OBRIGATÓRIO. Tarefa de CRM sem data é lembrete que ninguém
     lembra — e a tela que lista "o que vence hoje" não teria como
     existir. */
  due_at     timestamptz not null,
  assignee_id uuid references public.profiles (id) on delete set null,

  done_at    timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_tasks_agenda_idx
  on public.lead_tasks (deal_id, due_at) where done_at is null;


/* ---------------------------------------------------------------------
   6. RLS — no MESMO arquivo das tabelas, de propósito

   Tabela criada sem policy, num sistema onde agora existe login de
   cliente, é porta aberta: o PostgREST concede pelo `grant`, e sem RLS
   qualquer autenticado lê tudo. Separar isso em outra migration cria
   uma janela entre rodar uma e rodar a outra — e essa janela é o
   intervalo em que a base de um cliente fica visível para outro.

   A REGRA É SEMPRE A MESMA: `app.client_is_visible(client_id)`. Ela lê
   `clients` sob a RLS de quem chama, e a migration 55 já restringiu
   `clients` ao próprio cliente para quem tem papel 'client'. Uma trava,
   herdada por todas.
   ------------------------------------------------------------------ */

alter table public.lead_pipelines  enable row level security;
alter table public.lead_stages     enable row level security;
alter table public.lead_contacts   enable row level security;
alter table public.lead_deals      enable row level security;
alter table public.lead_notes      enable row level security;
alter table public.lead_tasks      enable row level security;

grant select, insert, update, delete on public.lead_pipelines to authenticated;
grant select, insert, update, delete on public.lead_stages    to authenticated;
grant select, insert, update, delete on public.lead_contacts  to authenticated;
grant select, insert, update, delete on public.lead_deals     to authenticated;
grant select, insert, update, delete on public.lead_notes     to authenticated;
grant select, insert, update, delete on public.lead_tasks     to authenticated;

/* ⚠️ O GRANT É CHECADO ANTES DA POLICY. Sem a linha acima, uma policy
   perfeita devolveria 42501 — o mesmo código de "violação de policy" —
   e a busca pelo erro começaria no lugar errado. */

do $$
declare
  t text;
begin
  foreach t in array array['lead_pipelines', 'lead_contacts', 'lead_deals'] loop
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format($f$
      create policy %I_rw on public.%I for all to authenticated
        using (app.client_is_visible(client_id))
        with check (app.client_is_visible(client_id))
    $f$, t, t);
  end loop;
end $$;

/* Etapas não têm `client_id` — o dono é o funil. A policy sobe um nível
   em vez de duplicar a coluna: coluna duplicada é coluna que um dia
   discorda do pai, e aí a etapa de um cliente aparece no funil de
   outro. */
drop policy if exists lead_stages_rw on public.lead_stages;

create policy lead_stages_rw on public.lead_stages for all to authenticated
  using (
    exists (
      select 1 from public.lead_pipelines p
      where p.id = pipeline_id and app.client_is_visible(p.client_id)
    )
  )
  with check (
    exists (
      select 1 from public.lead_pipelines p
      where p.id = pipeline_id and app.client_is_visible(p.client_id)
    )
  );

/* Anotação e tarefa herdam do lead, pelo mesmo motivo. */
do $$
declare
  t text;
begin
  foreach t in array array['lead_notes', 'lead_tasks'] loop
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format($f$
      create policy %I_rw on public.%I for all to authenticated
        using (
          exists (
            select 1 from public.lead_deals d
            where d.id = deal_id and app.client_is_visible(d.client_id)
          )
        )
        with check (
          exists (
            select 1 from public.lead_deals d
            where d.id = deal_id and app.client_is_visible(d.client_id)
          )
        )
    $f$, t, t);
  end loop;
end $$;


/* ---------------------------------------------------------------------
   7. O funil que nasce pronto

   Cliente que abre o CRM e encontra um quadro vazio, sem colunas, não
   descobre sozinho o que fazer — e "crie sua primeira etapa" é pedir
   que ele projete o próprio processo antes de ter usado a ferramenta
   uma vez. As cinco etapas abaixo são o caminho comum de quem vende por
   contato: chegou, falou, propôs, fechou ou não.
   ------------------------------------------------------------------ */

create or replace function app.criar_funil_padrao(p_client uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipeline uuid;
begin
  -- Já existe? Devolve o que há. A função é chamada na abertura da tela.
  select id into v_pipeline
  from public.lead_pipelines
  where client_id = p_client and is_default
  limit 1;

  if v_pipeline is not null then
    return v_pipeline;
  end if;

  insert into public.lead_pipelines (client_id, name, is_default, position)
  values (p_client, 'Funil de vendas', true, 0)
  returning id into v_pipeline;

  insert into public.lead_stages (pipeline_id, name, kind, color, position)
  values
    (v_pipeline, 'Novo contato',  'aberto',  '#64748B', 0),
    (v_pipeline, 'Em conversa',   'aberto',  '#3B82F6', 1),
    (v_pipeline, 'Proposta',      'aberto',  '#A855F7', 2),
    (v_pipeline, 'Ganho',         'ganho',   '#1F7A4D', 3),
    (v_pipeline, 'Perdido',       'perdido', '#B03A2E', 4);

  return v_pipeline;
end;
$$;

comment on function app.criar_funil_padrao(uuid) is
  'Cria o funil inicial de um cliente, com as cinco etapas comuns. Idempotente: devolve o existente.';
