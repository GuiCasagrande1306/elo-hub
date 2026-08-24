/* =====================================================================
   As conversas chegando sozinhas na tela — e alcançáveis
   ---------------------------------------------------------------------
   DUAS COISAS QUE FALTARAM NA 62.

   1. O GRANT. A migration 62 criou as tabelas, ligou a RLS e escreveu a
      policy de leitura — e esqueceu de dar `select` a `authenticated`.
      Policy sem grant não é meio caminho: o Postgres nem chega a
      avaliar a policy, responde `permission denied for table` antes.
      A diferença importa no diagnóstico, porque parece problema de RLS
      e não é.

      Só apareceu ao abrir a tela com um usuário de cliente de verdade;
      o webhook grava com `service_role`, que passa por cima de tudo, e
      por isso a gravação funcionava com a leitura quebrada. As tabelas
      do CRM (migration 56) já traziam esses grants — o esquecimento foi
      só aqui.

      SÓ `select`. Escrita continua fora do alcance de qualquer sessão:
      quem grava é o webhook, e quem responde passa pela server action.
      Ver o cabeçalho da migration 62.

   2. O REALTIME. Sem isto a caixa de entrada precisaria de F5. Num
      funil de vendas isso é tolerável; numa conversa de WhatsApp, não —
      a pessoa está falando com alguém do outro lado, e uma resposta que
      só aparece ao recarregar faz o atendente responder duas vezes ou
      deixar no vácuo.

      O Realtime do Supabase respeita RLS no broadcast: a policy de
      select vale para o WebSocket como vale para o REST, e quem não
      pode ler a linha não recebe o evento. O canal não é um caminho
      paralelo de vazamento — o que importa aqui, onde o conteúdo é
      mensagem de terceiro.

      `replica identity full` pelo mesmo motivo da migration 3: sem ele
      o evento de UPDATE/DELETE só carrega a chave primária, e a RLS não
      tem colunas para avaliar no momento do broadcast.
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. Alcance
   ------------------------------------------------------------------ */

grant select on public.wa_conversas to authenticated;
grant select on public.wa_mensagens to authenticated;


/* ---------------------------------------------------------------------
   2. Ao vivo
   ------------------------------------------------------------------ */

do $$
declare t text;
begin
  foreach t in array array['wa_conversas', 'wa_mensagens'] loop
    execute format('alter table public.%I replica identity full', t);

    -- Idempotente: ignora se a tabela já está na publicação.
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'Publicação supabase_realtime inexistente — rodando fora do Supabase?';
    end;
  end loop;
end $$;
