/* =====================================================================
   Relatórios: templates editáveis e histórico por autor
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. GRANT que faltava — quarta vez neste projeto

   `report_templates` tem a policy `report_templates_admin FOR ALL` desde
   a migration 02, mas o GRANT é só de SELECT:

       grant select on public.report_templates to authenticated;

   O Postgres checa PRIVILÉGIO DE TABELA antes da policy. Sem o grant de
   escrita, o UPDATE de um admin é recusado com 42501 e a policy nem
   chega a ser avaliada — a tela salva, não dá erro visível e nada muda.
   Mesmo defeito das migrations 17, 18, 26 e 29.
   ------------------------------------------------------------------ */

grant insert, update, delete on public.report_templates to authenticated;


/* ---------------------------------------------------------------------
   2. Histórico: admin vê tudo, colaborador vê o que é dele

   A policy anterior liberava todo o histórico dos clientes visíveis —
   ou seja, um colaborador via os envios dos colegas na mesma conta.

   ⚠️ `generated_by IS NULL` CONTINUA VISÍVEL, e não é descuido.

   Quem gera o PDF da madrugada é o cron, com `service_role` e sem
   usuário na ponta: essas linhas nascem com `generated_by` nulo. Elas
   são a FILA DE TRABALHO — o fluxo do sistema é "o robô prepara, uma
   pessoa confere e dispara pelo WhatsApp dela". Escondê-las de quem não
   é admin deixaria a fila vazia para a equipe inteira e quebraria a
   rotina diária.

   O que a regra esconde é o que interessa esconder: envio COM autor,
   feito por outra pessoa.
   ------------------------------------------------------------------ */

drop policy if exists report_history_select on public.report_history;

create policy report_history_select on public.report_history
  for select to authenticated
  using (
    app.client_is_visible(client_id)
    and (
      app.is_admin()
      or generated_by = auth.uid()
      or generated_by is null
    )
  );

comment on policy report_history_select on public.report_history is
  'Admin vê todo o histórico. Colaborador vê os próprios envios e a fila do cron (generated_by nulo), que é o trabalho dele.';


/* ---------------------------------------------------------------------
   3. Índice para o filtro por período

   A tela passa a filtrar por intervalo de datas, e o histórico cresce
   um registro por cliente por mês. Sem índice a varredura é sequencial
   desde o começo.
   ------------------------------------------------------------------ */

create index if not exists report_history_created_idx
  on public.report_history (created_at desc);
