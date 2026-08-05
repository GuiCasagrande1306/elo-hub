/* =====================================================================
   Carteira de clientes visível para toda a equipe
   ---------------------------------------------------------------------
   MUDANÇA DE REGRA, não correção de defeito. Vale registrar o antes:

   `clients_select` exigia `app.can_access_client(id)` — admin, membro
   em `client_members` ou dono. Como a RPC de cadastro só torna membro
   QUEM CRIA, um cliente cadastrado pelo admin era invisível para todo
   o resto da equipe até alguém atribuir o acesso à mão.

   Isso também explicava o Realtime "quebrado": o Supabase respeita RLS
   no broadcast, então o colaborador não recebia o INSERT de uma linha
   que não podia ler. Não havia nada errado no canal.

   Agora qualquer usuário autenticado LÊ a carteira inteira. Escrita
   continua restrita: criar e apagar é de admin, editar exige
   `can_write_client`.

   ⚠️ O QUE ISSO ABRE: `clients` guarda `monthly_fee_cents` (quanto o
   cliente paga), `tax_id` e `legal_name`. A partir daqui, qualquer
   colaborador autenticado consegue lê-los via API, mesmo sem tela que
   os mostre. Se isso não for aceitável, o caminho é mover o honorário
   para uma tabela própria com policy de admin — não dá para resolver
   com RLS, que é por LINHA e não por coluna.

   O que NÃO muda: tarefas, métricas, relatórios e financeiro continuam
   com as policies próprias. Ver a conta não é ver o trabalho dela.
   ===================================================================== */

drop policy if exists clients_select on public.clients;

create policy clients_select on public.clients for select to authenticated
  using (true);

comment on policy clients_select on public.clients is
  'Carteira visível para toda a equipe. Escrita segue restrita — ver clients_insert/update/delete.';

/* Garantias de que o Realtime entrega o evento a todos.
   Idempotentes: se já estiverem aplicadas, não fazem nada. */
do $$
begin
  -- `replica identity full` faz o payload trazer a linha inteira; sem
  -- isso o UPDATE chega só com a chave e o filtro de RLS do broadcast
  -- não consegue decidir.
  execute 'alter table public.clients replica identity full';

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'clients'
  ) then
    execute 'alter publication supabase_realtime add table public.clients';
  end if;
end
$$;
