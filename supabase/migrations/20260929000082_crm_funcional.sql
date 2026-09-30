/* =====================================================================
   CRM comercial que funciona — captura barata, avanço caro
   ---------------------------------------------------------------------
   POR QUE ESTA MIGRATION EXISTE. O módulo comercial está no ar desde
   16/08 e, em 29/09, tem ZERO negócios. Medido, não suposto. O esquema
   da migration 44 é bom; o que falhou não foi o modelo, foi o preço de
   entrada — para registrar um lead era preciso compor à mão um título
   como "Pizzaria Dom Léo — gestão de tráfego" e preencher mais seis
   campos, com a conversa acontecendo no WhatsApp ao lado. Ninguém pagou
   esse preço uma única vez.

   A CORREÇÃO É INVERTER ONDE O ATRITO MORA.

     Criar um negócio passa a custar UM campo: o nome da empresa.
     Avançar de etapa passa a custar exatamente o que aquela etapa
     precisa, cobrado na hora em que aquilo importa.

   Ninguém preenche valor de proposta no dia em que o lead chega. Todo
   mundo preenche no dia em que manda a proposta. A migration 44 pedia
   tudo no primeiro dia e não pedia nada depois; esta faz o contrário.

   TRÊS MUDANÇAS
   ---------------------------------------------------------------------
   1. `title` SAI, `company` vira obrigatório e `service` nasce.
      O título era texto livre composto à mão, e é o defeito de dado mais
      caro do módulo: com ele não dá para contar quantos negócios de
      tráfego foram perdidos, porque "tráfego", "gestão de tráfego" e
      "trafego pago" são três strings diferentes dentro de uma frase.
      Empresa e serviço em colunas próprias respondem essa pergunta.

   2. PORTÕES POR ETAPA como `check`. Espelham `PORTOES` em
      `src/lib/crm/portoes.ts`, que é a fonte única e produz a mensagem
      amigável. O check aqui é a REDE: garante que nenhum caminho —
      script, SQL na mão, um bug numa action futura — produza um negócio
      em "Proposta" sem valor. Mudou lá, muda aqui.

   3. `crm_stage_events` NASCE, e o trigger para de escrever a mudança de
      etapa como frase.
      ⚠️ ESTE É O PONTO QUE DESTRAVA "NÚMEROS CONFIÁVEIS". A migration 44
      já registrava a troca de etapa, mas em `crm_activities.body`, como
      `'Etapa mudou de novo para contato'`. É história que PARECE
      completa e não é dado: calcular conversão por etapa ou tempo de
      ciclo exigiria fazer parsing de prosa em português. Com `from_stage`
      e `to_stage` em colunas, as três perguntas que justificam um CRM —
      quanto converte de uma etapa para a próxima, quanto tempo leva, e
      onde a venda morre — viram consulta.

   A LINHA DO TEMPO CONTINUA UMA SÓ. `crm_activities` segue guardando o
   que uma pessoa escreveu (nota, ligação, reunião). A mudança de etapa
   sai de lá e passa a viver só em `crm_stage_events` — o mesmo fato em
   duas tabelas divergiria no primeiro update que esquecesse uma delas,
   que é o erro que este projeto já pagou quatro vezes.

   SEGURO RODAR: a tabela tem zero linhas. Conferido em 29/09/2026 com a
   chave de serviço. Nada é migrado porque não há nada para migrar.
   ===================================================================== */

/* ------------------------------------------------------------------ */
/* 1. Identidade do negócio: empresa e serviço, não título livre       */
/* ------------------------------------------------------------------ */

alter table public.crm_deals
  add column if not exists service text check (service in (
    'trafego', 'social', 'site', 'combo', 'outro'
  ));

comment on column public.crm_deals.service is
  'O que a Elo está vendendo neste negócio. Lista canônica em src/lib/crm/servicos.ts. Existe para "quantos negócios de tráfego perdemos" ser uma consulta.';

/* Quem indicou. A indicação é um dos dois canais reais da agência, e
   `origem = indicacao` sozinho não diz de quem veio — que é justamente
   a informação que permite agradecer, e saber qual cliente indica. */
alter table public.crm_deals
  add column if not exists referred_by text check (length(referred_by) <= 200);

comment on column public.crm_deals.referred_by is
  'Quem indicou. Obrigatório a partir de "Contato feito" quando origem = indicacao.';

/* `company` vira a identidade obrigatória e `title` sai.
   A ordem importa: preencher antes de exigir. Com zero linhas o update
   não toca em nada, e fica aqui para o caso de alguém rodar esta
   migration num banco que já recebeu uso. */
/* Guardado por `if exists`: sem isso a segunda execução desta migration
   quebraria em `update ... set company = title`, referenciando uma
   coluna que a primeira já removeu. */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crm_deals'
      and column_name = 'title'
  ) then
    update public.crm_deals set company = title where company is null;
    alter table public.crm_deals alter column title drop not null;
    alter table public.crm_deals drop column title;
  end if;
end $$;

alter table public.crm_deals
  alter column company set not null;

alter table public.crm_deals
  drop constraint if exists crm_deals_company_check;

alter table public.crm_deals
  add constraint crm_deals_company_check
  check (length(btrim(company)) between 1 and 200);

comment on column public.crm_deals.company is
  'A empresa. É o ÚNICO campo exigido para criar um negócio — ver o cabeçalho desta migration.';

/* ------------------------------------------------------------------ */
/* 2. Portões por etapa                                                */
/* ------------------------------------------------------------------ */
/* Cada portão libera 'novo' e 'perdido': entrar custa nada, e perder é
   possível em qualquer ponto do funil — exigir dados de qualificação
   para registrar uma perda faria a equipe deixar o negócio apodrecendo
   em "Proposta" em vez de marcar que morreu, apagando exatamente o dado
   que o campo de motivo existe para colher. */

alter table public.crm_deals drop constraint if exists crm_deals_portao_contato;
alter table public.crm_deals add constraint crm_deals_portao_contato check (
  stage in ('novo', 'perdido')
  or contact_phone is not null
  or contact_email is not null
);

alter table public.crm_deals drop constraint if exists crm_deals_portao_reuniao;
alter table public.crm_deals add constraint crm_deals_portao_reuniao check (
  stage in ('novo', 'contato', 'perdido')
  or (owner_id is not null and contact_name is not null)
);

alter table public.crm_deals drop constraint if exists crm_deals_portao_proposta;
alter table public.crm_deals add constraint crm_deals_portao_proposta check (
  stage in ('novo', 'contato', 'reuniao', 'perdido')
  or (service is not null and (monthly_fee_cents > 0 or setup_fee_cents > 0))
);

alter table public.crm_deals drop constraint if exists crm_deals_portao_negociacao;
alter table public.crm_deals add constraint crm_deals_portao_negociacao check (
  stage in ('novo', 'contato', 'reuniao', 'proposta', 'perdido')
  or expected_close_date is not null
);

/* Próxima ação em todo negócio ABERTO fora de 'novo'.
   É a regra que impede o funil de apodrecer, e a única que a migration
   44 já tinha como par (ação e data juntas) sem nunca exigir o par. Na
   tela ela chega pré-preenchida — obrigatória não quer dizer digitada. */
alter table public.crm_deals drop constraint if exists crm_deals_portao_proxima_acao;
alter table public.crm_deals add constraint crm_deals_portao_proxima_acao check (
  stage in ('novo', 'ganho', 'perdido')
  or next_action_at is not null
);

/* Perder sem dizer por quê joga fora a única informação que o funil
   produz de graça. A migration 44 garantia a metade fraca (motivo só em
   perdido); esta fecha a outra (perdido exige motivo). */
alter table public.crm_deals drop constraint if exists crm_deals_portao_perdido;
alter table public.crm_deals add constraint crm_deals_portao_perdido check (
  stage <> 'perdido' or lost_reason is not null
);

alter table public.crm_deals drop constraint if exists crm_deals_portao_indicacao;
alter table public.crm_deals add constraint crm_deals_portao_indicacao check (
  origem <> 'indicacao' or stage = 'novo' or referred_by is not null
);

/* ------------------------------------------------------------------ */
/* 3. A história da etapa vira dado                                    */
/* ------------------------------------------------------------------ */

create table if not exists public.crm_stage_events (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.crm_deals (id) on delete cascade,

  /* `null` só no evento de criação: não se veio de lugar nenhum. */
  from_stage text check (from_stage in (
               'novo', 'contato', 'reuniao', 'proposta',
               'negociacao', 'ganho', 'perdido'
             )),
  to_stage   text not null check (to_stage in (
               'novo', 'contato', 'reuniao', 'proposta',
               'negociacao', 'ganho', 'perdido'
             )),

  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),

  /* Ir para a etapa em que já se está não é evento. */
  constraint crm_stage_events_mudou check (from_stage is distinct from to_stage)
);

comment on table public.crm_stage_events is
  'Cada passagem de etapa, como DADO. Conversão por etapa, tempo de ciclo e onde a venda morre saem daqui — nunca de texto.';

/* A consulta que as métricas fazem é sempre "todos os eventos deste
   funil, em ordem", e a de uma ficha é "os deste negócio". */
create index if not exists crm_stage_events_deal_idx
  on public.crm_stage_events (deal_id, changed_at);
create index if not exists crm_stage_events_janela_idx
  on public.crm_stage_events (changed_at desc);

/* ------------------------------------------------------------------ */
/* Gatilhos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Registra a etapa inicial.
 *
 * Sem este evento, um negócio criado e nunca movido não aparece em
 * conta nenhuma — e "quantos leads entraram este mês" é a primeira
 * pergunta do funil. AFTER INSERT porque precisa do id já gravado.
 */
create or replace function app.crm_registra_entrada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.crm_stage_events (deal_id, from_stage, to_stage, changed_by)
  values (new.id, null, new.stage, (select auth.uid()));
  return new;
end;
$$;

drop trigger if exists crm_registra_entrada on public.crm_deals;
create trigger crm_registra_entrada
  after insert on public.crm_deals
  for each row execute function app.crm_registra_entrada();

/**
 * Carimba o desfecho e registra a passagem de etapa COMO DADO.
 *
 * Substitui `app.stamp_crm_deal` da migration 44, que escrevia a frase
 * 'Etapa mudou de X para Y' em `crm_activities`. A parte de carimbar
 * `won_at`/`lost_at` continua idêntica; o que muda é para onde vai o
 * registro. Ver o cabeçalho desta migration.
 *
 * Continua `security definer` porque escreve numa tabela cuja policy de
 * insert é fechada para a aplicação — o autor gravado segue sendo a
 * sessão, não um id escolhido aqui.
 *
 * BEFORE para o carimbo e AFTER para o evento seria o desenho limpo,
 * mas exigiria dois gatilhos lendo a mesma condição. Fica em BEFORE: o
 * insert usa `new.id`, que num UPDATE já existe.
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

    insert into public.crm_stage_events (deal_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, (select auth.uid()));
  end if;

  return new;
end;
$$;

/* ------------------------------------------------------------------ */
/* Permissões                                                          */
/* ------------------------------------------------------------------ */

/* ⚠️ GRANT ANTES DE POLICY — a nota da migration 44 vale igual aqui: o
   Postgres checa o privilégio da tabela ANTES de avaliar RLS, e sem o
   grant o erro que sai é "permission denied", sem menção a policy. */
grant select on public.crm_stage_events to authenticated;

alter table public.crm_stage_events enable row level security;

/* Leitura livre para a equipe, igual a `crm_deals_select`: o funil é de
   todos. SEM policy de insert, update ou delete, e isso é a decisão que
   faz o número ser confiável — a história da etapa é escrita
   exclusivamente pelo trigger, que roda como definer. Nenhum caminho da
   aplicação pode inventar, corrigir ou apagar uma passagem de etapa. */
drop policy if exists crm_stage_events_select on public.crm_stage_events;
create policy crm_stage_events_select on public.crm_stage_events
  for select to authenticated
  using (true);
