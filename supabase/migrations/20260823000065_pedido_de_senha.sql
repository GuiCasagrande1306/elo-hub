/* =====================================================================
   "Esqueci minha senha" — a fila que a Elo enxerga
   ---------------------------------------------------------------------
   POR QUE NÃO BASTA O E-MAIL DO SUPABASE. A recuperação padrão manda um
   link por e-mail, e isso depende de SMTP configurado no projeto. Medido
   em 23/08/2026: o endpoint `/auth/v1/recover` responde 200, mas 200 não
   prova entrega — ele responde assim mesmo quando o envio falha adiante,
   e o SMTP padrão do Supabase só entrega para endereços da equipe do
   projeto, com limite de poucos e-mails por hora.

   Some a isso o fato de que o e-mail de acesso de um cliente muitas
   vezes NÃO É UM E-MAIL QUE ELE LÊ: o convite chega por WhatsApp, e o
   endereço é só o identificador de login. Um fluxo que depende de o
   cliente abrir a caixa de entrada falha justamente para quem mais
   precisa dele.

   ENTÃO SÃO DOIS CAMINHOS, e esta tabela é o segundo. O pedido dispara o
   e-mail (que chega se o SMTP estiver de pé) E fica registrado aqui, à
   vista da agência, que gera um link novo e cola no WhatsApp. O caminho
   lento sempre funciona; o rápido é bônus.

   O QUE ESTA TABELA NÃO GUARDA: nada que sirva para entrar. Sem token,
   sem link, sem senha. É um aviso de que alguém pediu ajuda — o link é
   gerado na hora em que a agência clica, e vive só na tela dela.
   ===================================================================== */

create table if not exists public.password_requests (
  id         uuid primary key default gen_random_uuid(),

  /* O e-mail COMO FOI DIGITADO, em minúsculas. Guardado mesmo quando não
     corresponde a ninguém: é a única pista quando o cliente jura que
     pediu e a agência não viu nada — quase sempre porque digitou o
     endereço errado, e ver o que ele digitou resolve em dez segundos. */
  email      text not null check (length(email) between 3 and 200),

  /* Preenchidos só quando o e-mail bate com um acesso existente.
     `on delete set null` para o pedido sobreviver à remoção do acesso —
     o histórico continua fazendo sentido. */
  profile_id uuid references public.profiles (id) on delete set null,
  client_id  uuid references public.clients (id) on delete set null,

  /* Quando a agência gerou o link novo. `null` = ainda na fila. */
  atendido_em  timestamptz,
  atendido_por uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now()
);

/* A fila é lida por "o que está aberto, mais recente primeiro". */
create index if not exists password_requests_abertos_idx
  on public.password_requests (created_at desc) where atendido_em is null;


/* ---------------------------------------------------------------------
   Quem lê

   SÓ ADMIN. A lista diz quem tem acesso ao sistema e quem está com
   problema para entrar — não é informação de colaborador, e muito menos
   de outro cliente.

   ESCRITA POR NINGUÉM. O pedido é gravado pela server action com
   `service_role`, porque quem pede está DESLOGADO por definição: não
   existe sessão para uma policy avaliar.
   ------------------------------------------------------------------ */

alter table public.password_requests enable row level security;

grant select on public.password_requests to authenticated;

drop policy if exists password_requests_admin on public.password_requests;

create policy password_requests_admin on public.password_requests
  for select to authenticated
  using (app.is_admin());

comment on table public.password_requests is
  'Pedidos de "esqueci minha senha". Não guarda token nem link — só o aviso de que alguém precisa de um acesso novo. Ver migration 65.';
