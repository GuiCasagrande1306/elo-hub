/* =====================================================================
   A mensagem que acompanha o relatório, editável
   ---------------------------------------------------------------------
   O texto vivia no código (`src/lib/reports/mensagem-do-cliente.ts`).
   Mudar a voz com que a agência fala com o cliente exigia deploy, e o
   resultado previsível é que ninguém muda: a mensagem que sai hoje é a
   que alguém escreveu uma vez.

   UMA LINHA SÓ, mesma trava de `balance_alert_settings`: `check (id)`
   sobre um boolean com default `true`, então a chave primária só aceita
   `true` e a segunda inserção colide. Duas linhas de configuração e
   nenhuma forma de saber qual vale é pior que configuração nenhuma.

   ⚠️ O TEXTO NÃO GUARDA NÚMERO, e a coluna não impede isso — quem
   impede é a substituição, que só conhece `{periodo}` e `{cliente}`.
   A razão está no cabeçalho daquele arquivo: enquanto a mensagem
   repetia investimento, custo e retorno, ela discordava do PDF que
   acompanhava. Medido em 27/08/2026, oito contas mandavam ROAS
   diferente no texto e no anexo — na Satö, 8,11x contra 12,35x. Um
   número que aparece em dois lugares é um número que vai divergir.

   `{periodo}` VIRA "dos últimos 7 dias" OU A DATA POR EXTENSO, conforme
   a janela. É a mesma regra que derrubou o primeiro seletor de período
   da estação de comando: ele trocava a frase sem trocar o dado. Por
   isso o período é substituído e não digitado — quem escrever "últimos
   7 dias" na mão volta a ter uma frase que mente no dia em que o
   relatório for mensal.
   ===================================================================== */

create table if not exists public.report_message_settings (
  id boolean primary key default true check (id),

  /* O texto com os marcadores. NOT NULL: a ausência de mensagem não é
     um estado válido — o relatório sempre sai com legenda. Para voltar
     ao texto de fábrica a interface reescreve o padrão, não apaga. */
  template text not null,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  /* 900 e não 1024: o WhatsApp corta a legenda em 1024 caracteres, e a
     substituição de `{periodo}` CRESCE o texto — "de 1 – 26 de agosto
     de 2026" tem 25 caracteres onde o marcador tinha 9. A folga evita
     que uma mensagem salva sem aviso chegue truncada no meio de uma
     frase. Vazio também não passa. */
  constraint report_message_template_tamanho
    check (char_length(btrim(template)) between 1 and 900)
);

comment on table public.report_message_settings is
  'A legenda enviada junto do PDF. Uma linha só. Marcadores: {periodo} e {cliente}.';

comment on column public.report_message_settings.template is
  'Texto com marcadores. {periodo} vira "dos últimos 7 dias" ou a data; {cliente} vira o nome da conta.';

alter table public.report_message_settings enable row level security;

/* LEITURA para qualquer autenticado: a estação de comando mostra a
   mensagem enquanto a pessoa confere o relatório, e esconder o texto de
   quem despacha não protegeria nada. */
drop policy if exists "report_message_settings_leitura" on public.report_message_settings;
create policy "report_message_settings_leitura"
  on public.report_message_settings for select
  to authenticated
  using (true);

/* ESCRITA só para admin, como os templates: é a voz da agência com o
   cliente final, não uma preferência de quem está operando hoje. */
drop policy if exists "report_message_settings_escrita" on public.report_message_settings;
create policy "report_message_settings_escrita"
  on public.report_message_settings for all
  to authenticated
  using (app.is_admin())
  with check (app.is_admin());

/* ⚠️ GRANT, e não só policy. Sem ele o Postgres recusa antes de avaliar
   a policy, com 42501, e a tela mostra "permissão negada" para um admin
   — foi exatamente o que aconteceu com `report_templates` até a
   migration 30. */
grant select on public.report_message_settings to authenticated;
grant insert, update on public.report_message_settings to authenticated;

/* A linha nasce com o texto que estava no código. A tela precisa de
   algo para editar, e um `upsert` que cria na primeira gravação
   esconderia da leitura o fato de que a configuração já existe. */
insert into public.report_message_settings (id, template)
values (
  true,
  'Olá! Aqui está o nosso relatório de performance {periodo}.

Qualquer dúvida, é só chamar por aqui.'
)
on conflict (id) do nothing;
