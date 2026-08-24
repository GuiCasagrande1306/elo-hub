/* =====================================================================
   Conversas de WhatsApp — receber e guardar
   ---------------------------------------------------------------------
   ⚠️ RODE 54 A 61 ANTES. A separação por empresa vive na 55, e é dela
   que estas tabelas dependem inteiramente.

   O QUE ENTRA AQUI É MENSAGEM DE TERCEIRO. Não é dado da agência nem do
   cliente: é a conversa entre o cliente e os clientes DELE — gente que
   nunca ouviu falar do Elo Hub e não escolheu ter a mensagem guardada
   num banco nosso. Três consequências de desenho:

     • A leitura é a mais fechada possível dentro do que foi combinado:
       a empresa dona do número, e a equipe da agência que atende aquela
       conta. Ninguém mais, nunca a carteira inteira.
     • Escrita NENHUMA pela sessão do usuário. Quem grava é o webhook,
       com service_role, depois de conferir de qual instância veio. Não
       existe policy de insert para `authenticated` — de propósito, e
       não por esquecimento.
     • A mídia é privada e o caminho começa pelo uuid da empresa, que é
       o que a policy do Storage compara. Mesmo desenho de `report-pdfs`
       e `social-media`.

   POR QUE `wa_` E NÃO `crm_`. Estas tabelas guardam o canal, não o
   funil. Uma conversa existe antes de virar lead e continua existindo
   depois de o lead ser perdido; amarrar o nome ao CRM convidaria a
   apagar histórico de atendimento junto com negócio encerrado.
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. Conversas

   UMA LINHA POR (EMPRESA, INTERLOCUTOR). O `jid` é o endereço do outro
   lado no WhatsApp — `5547999998888@s.whatsapp.net` para pessoa,
   `...@g.us` para grupo. Guardado cru, sem máscara: é a chave que a
   Evolution devolve e a que usamos para responder.
   ------------------------------------------------------------------ */

create table if not exists public.wa_conversas (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,

  jid        text not null check (jid ~ '^[0-9]+(-[0-9]+)?@(s\.whatsapp\.net|g\.us)$'),

  /* `pushName` do WhatsApp — como a pessoa se chama no aparelho dela.
     Não é o nome do contato no CRM, e os dois divergem de propósito:
     um é o que ela escolheu mostrar, o outro é como a empresa a
     registrou. */
  nome       text check (length(nome) <= 200),
  eh_grupo   boolean not null default false,

  /* Ligação com o CRM. As duas OPCIONAIS: conversa de número
     desconhecido chega antes de existir contato ou lead, e recusá-la
     por isso perderia justamente a primeira mensagem — a que diz que
     alguém novo apareceu. */
  contact_id uuid references public.lead_contacts (id) on delete set null,
  deal_id    uuid references public.lead_deals (id) on delete set null,

  /* Resumo para a lista, mantido por gatilho — ver a seção 4. Guardado
     e não calculado: ordenar a caixa de entrada por um `max()` sobre
     `wa_mensagens` faria uma varredura por abertura de tela. */
  ultima_em     timestamptz,
  ultima_previa text check (length(ultima_previa) <= 200),
  nao_lidas     integer not null default 0 check (nao_lidas >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_id, jid)
);

/* A caixa de entrada abre ordenada por atividade, e é a única consulta
   quente desta tabela. */
create index if not exists wa_conversas_recentes_idx
  on public.wa_conversas (client_id, ultima_em desc nulls last);

create index if not exists wa_conversas_deal_idx
  on public.wa_conversas (deal_id) where deal_id is not null;


/* ---------------------------------------------------------------------
   2. Mensagens
   ------------------------------------------------------------------ */

create table if not exists public.wa_mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.wa_conversas (id) on delete cascade,

  /* DESNORMALIZADO de propósito. A policy de leitura compara
     `client_id` direto; sem esta coluna, cada linha avaliada faria um
     join com `wa_conversas` dentro da policy — e a thread de uma
     conversa longa é exatamente onde isso pesa. O gatilho da seção 4
     garante que ela nunca discorde da conversa. */
  client_id   uuid not null references public.clients (id) on delete cascade,

  /* O id que o WhatsApp deu à mensagem. É o que torna a gravação
     idempotente: a Evolution reentrega o mesmo evento quando o nosso
     webhook demora a responder, e sem esta restrição a conversa
     encheria de duplicatas. */
  wa_id       text not null,

  de_mim      boolean not null,

  tipo        text not null default 'texto' check (tipo in (
                'texto', 'imagem', 'audio', 'video', 'documento',
                'sticker', 'localizacao', 'contato', 'sistema', 'outro'
              )),

  texto       text check (length(texto) <= 20000),

  /* Caminho no bucket `whatsapp-media`, não a URL. URL assinada vence;
     caminho não. Quem exibe assina na hora. */
  midia_path  text,
  midia_mime  text,
  midia_nome  text,

  /* O instante do WhatsApp, não o da gravação. Mensagem que chega
     atrasada — aparelho sem rede, webhook reentregue — precisa aparecer
     na posição em que foi dita. */
  enviada_em  timestamptz not null,

  created_at  timestamptz not null default now(),

  unique (conversa_id, wa_id)
);

create index if not exists wa_mensagens_thread_idx
  on public.wa_mensagens (conversa_id, enviada_em);


/* ---------------------------------------------------------------------
   3. Quem lê

   LEITURA para a empresa dona do número e para a equipe que atende a
   conta — `app.client_is_visible` já resolve os dois casos porque
   herda a RLS de `clients`, restringida na migration 55.

   ESCRITA para ninguém. `alter table ... enable row level security` sem
   policy de insert/update/delete significa recusa para toda sessão
   autenticada. Só `service_role` grava, e ele entra pelo webhook.
   ------------------------------------------------------------------ */

alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;

drop policy if exists wa_conversas_select on public.wa_conversas;
create policy wa_conversas_select on public.wa_conversas for select to authenticated
  using (app.client_is_visible(client_id));

drop policy if exists wa_mensagens_select on public.wa_mensagens;
create policy wa_mensagens_select on public.wa_mensagens for select to authenticated
  using (app.client_is_visible(client_id));

comment on table public.wa_mensagens is
  'Mensagens de WhatsApp do número de um cliente. Conteúdo de terceiros: leitura restrita à empresa dona e à equipe que atende; escrita só por service_role, pelo webhook da Evolution.';


/* ---------------------------------------------------------------------
   4. O resumo da conversa acompanha a mensagem

   POR GATILHO E NÃO PELA APLICAÇÃO. São dois caminhos de escrita hoje
   (webhook de entrada e, em breve, o envio pela tela) e a lista de
   conversas ficaria errada no dia em que um deles esquecesse de
   atualizar. A regra de negócio mora onde o dado mora.

   `client_id` é COPIADO da conversa, não confiado ao chamador: é a
   coluna que a policy de leitura usa, e um insert com o id de outra
   empresa a colocaria à vista de quem não deve. Sobrescrever custa uma
   linha e fecha a porta.
   ------------------------------------------------------------------ */

create or replace function app.wa_resumo_da_conversa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client uuid;
begin
  select client_id into v_client
    from public.wa_conversas where id = new.conversa_id;

  if v_client is null then
    raise exception 'wa_mensagens: conversa % não existe', new.conversa_id;
  end if;

  new.client_id := v_client;

  update public.wa_conversas c
     set ultima_em     = greatest(coalesce(c.ultima_em, new.enviada_em), new.enviada_em),
         ultima_previa = left(
           coalesce(
             nullif(btrim(new.texto), ''),
             case new.tipo
               when 'imagem'      then '📷 Imagem'
               when 'audio'       then '🎤 Áudio'
               when 'video'       then '🎬 Vídeo'
               when 'documento'   then '📎 ' || coalesce(new.midia_nome, 'Documento')
               when 'sticker'     then 'Figurinha'
               when 'localizacao' then '📍 Localização'
               when 'contato'     then 'Contato'
               else 'Mensagem'
             end
           ), 200),
         /* Só conta como não lida a que VEIO de fora. Mensagem enviada
            pelo próprio atendente zera o contador: se ele respondeu, ele
            leu. */
         nao_lidas     = case when new.de_mim then 0 else c.nao_lidas + 1 end,
         updated_at    = now()
   where c.id = new.conversa_id;

  return new;
end;
$$;

drop trigger if exists wa_mensagens_resumo on public.wa_mensagens;

create trigger wa_mensagens_resumo
  before insert on public.wa_mensagens
  for each row
  execute function app.wa_resumo_da_conversa();


/* ---------------------------------------------------------------------
   5. A mídia

   PRIVADO. Áudio e foto que um consumidor mandou para a pizzaria não
   podem estar a um endereço adivinhável de distância.

   16MB é o teto do próprio WhatsApp para vídeo e áudio em boa parte dos
   aparelhos; documento vai até 100MB, e por isso o limite fica nos 100.

   Sem `allowed_mime_types`: o que chega é o que o consumidor mandou, e
   uma lista branca aqui descartaria em silêncio o formato esquisito que
   justamente alguém precisa abrir.
   ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 104857600)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      public          = excluded.public;

drop policy if exists "whatsapp_media_leitura" on storage.objects;

create policy "whatsapp_media_leitura"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'whatsapp-media'
    /* Primeira pasta do caminho é o uuid da empresa —
       `<client_id>/<conversa_id>/<arquivo>`. `nullif` porque objeto
       solto na raiz tem `name` sem barra, e string vazia não converte
       para uuid: derrubaria a consulta inteira em vez de só negar. */
    and app.client_is_visible(nullif(split_part(name, '/', 1), '')::uuid)
  );
