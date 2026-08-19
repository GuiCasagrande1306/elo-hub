/* =====================================================================
   Para onde vai o aviso de saldo
   ---------------------------------------------------------------------
   A página de alertas já sabia quais contas estão prestes a zerar, e não
   avisava ninguém: era preciso abrir a tela para descobrir. Para um
   problema que o próprio módulo descreve como "silencioso, e o prejuízo
   só aparece no resultado do mês", uma página passiva é meio caminho.

   UMA LINHA SÓ, e a trava é o `check (id)` sobre um boolean com default
   `true`: a chave primária só aceita o valor `true`, então a segunda
   inserção colide. Sem isso, duas linhas de configuração e nenhuma
   forma de saber qual vale.

   O GRUPO DEFINE A INSTÂNCIA. `whatsapp_groups` já guarda de qual
   usuário cada grupo veio; escolher o grupo escolhe junto o WhatsApp que
   envia. Guardar os dois aqui evita um join no caminho do cron e
   sobrevive ao grupo sumir da sincronização.
   ===================================================================== */

create table if not exists public.balance_alert_settings (
  id boolean primary key default true check (id),

  /* JID do grupo, terminando em @g.us. NULL = ninguém escolheu ainda, e
     o cron não envia nada — silêncio explícito, não erro. */
  group_jid  text check (group_jid is null or group_jid like '%@g.us'),
  group_name text,

  /* De quem é o WhatsApp que envia. Vem do dono do grupo escolhido. */
  sender_id  uuid references public.profiles (id) on delete set null,

  /* Último dia em que o aviso saiu, no fuso do Brasil.
     TRAVA DE REPETIÇÃO: o cron roda uma vez por dia, mas `?etapa=` e
     retentativas podem chamá-lo de novo. Sem isto, uma reexecução
     manda o mesmo aviso duas vezes — e aviso repetido é a forma mais
     rápida de ensinar a equipe a ignorá-lo. */
  last_sent_on date,

  updated_at timestamptz not null default now()
);

comment on table public.balance_alert_settings is
  'Destino do aviso diário de saldo. Uma linha só; group_jid nulo = não avisa.';

alter table public.balance_alert_settings enable row level security;

/* LEITURA para qualquer autenticado: a tela de alertas mostra para onde
   o aviso vai, e esconder isso faria a equipe supor que não há aviso. */
drop policy if exists "balance_alert_settings_leitura" on public.balance_alert_settings;
create policy "balance_alert_settings_leitura"
  on public.balance_alert_settings for select
  to authenticated
  using (true);

/* ESCRITA só para admin: escolher o grupo é escolher para onde a
   agência manda mensagem automática. */
drop policy if exists "balance_alert_settings_escrita" on public.balance_alert_settings;
create policy "balance_alert_settings_escrita"
  on public.balance_alert_settings for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

/* A linha nasce vazia: a tela precisa de algo para editar, e um
   `upsert` que cria na primeira gravação esconderia da leitura o fato
   de que a configuração existe e está em branco. */
insert into public.balance_alert_settings (id)
values (true)
on conflict (id) do nothing;
