/* =====================================================================
   Números do cliente visíveis para a equipe
   ---------------------------------------------------------------------
   Sintoma relatado: o Brazzo Pizza mostra investimento, resultados e
   ROAS para o admin, e um dashboard vazio no login do colaborador.

   Causa: `clients` virou visível para todos (`clients_select` é
   `using (true)`), mas TUDO que pendura número no cliente continuou em
   `app.can_access_client()` — que exige ser admin, ser dono da conta,
   ou ter linha em `client_members`. Essa tabela nunca recebeu um
   registro sequer, e nada no sistema escreve nela.

   O resultado é a pior combinação possível: a conta aparece na lista e
   na sidebar, abre normalmente, e todo painel dentro dela vem zerado.
   Não há mensagem de permissão em lugar nenhum — parece integração
   quebrada, e foi assim que chegou como bug.

   Cinco tabelas estavam nessa condição:
     • daily_metrics      → investimento, resultados, receita, ROAS
     • ad_creatives       → criativos em destaque
     • client_goals       → planejado vs executado
     • report_history     → relatórios já entregues
     • client_integrations→ estado das contas de mídia

   Todas passam a espelhar a visibilidade do cliente.

   O QUE CONTINUA FECHADO — e é o que torna isto seguro: honorário e
   CNPJ moram em `client_financials`, tabela separada exatamente para
   este caso, com policy de admin. Abrir métrica não abre dinheiro de
   contrato. Token de acesso segue em `integration_secrets`, que tem RLS
   ligada e ZERO policies: nenhuma sessão o alcança, só o servidor.

   ESCRITA: gerar relatório e definir meta passam a valer para a equipe.
   São o trabalho diário de quem opera tráfego, e deixá-los em
   `can_write_client` reproduziria o mesmo bug uma tela adiante — o
   colaborador veria os números e levaria "permissão negada" ao clicar
   em Gerar relatório. Editar cadastro e integração segue restrito.
   ===================================================================== */

/* Cliente existe ⇒ é visível (clients_select é `using (true)`). A
   subconsulta respeita a RLS de `clients`, então se um dia a carteira
   voltar a ser restrita, estas policies acompanham sozinhas. */
create or replace function app.client_is_visible(p_client uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.clients c where c.id = p_client);
$$;

comment on function app.client_is_visible(uuid) is
  'Espelha a visibilidade de clients. SECURITY INVOKER de propósito: precisa herdar a RLS de quem chama.';


-- --- Leitura ---------------------------------------------------------

drop policy if exists daily_metrics_select on public.daily_metrics;
create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (app.client_is_visible(client_id));

drop policy if exists ad_creatives_select on public.ad_creatives;
create policy ad_creatives_select on public.ad_creatives for select to authenticated
  using (app.client_is_visible(client_id));

drop policy if exists client_goals_select on public.client_goals;
create policy client_goals_select on public.client_goals for select to authenticated
  using (app.client_is_visible(client_id));

drop policy if exists report_history_select on public.report_history;
create policy report_history_select on public.report_history for select to authenticated
  using (app.client_is_visible(client_id));

drop policy if exists client_integrations_select on public.client_integrations;
create policy client_integrations_select on public.client_integrations for select to authenticated
  using (app.client_is_visible(client_id));


-- --- Escrita do trabalho diário --------------------------------------

drop policy if exists report_history_insert on public.report_history;
create policy report_history_insert on public.report_history for insert to authenticated
  with check (
    app.client_is_visible(client_id)
    -- Autoria não se forja: quem gera é quem está logado.
    and generated_by = (select auth.uid())
  );

drop policy if exists report_history_update on public.report_history;
create policy report_history_update on public.report_history for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));

drop policy if exists client_goals_write on public.client_goals;
create policy client_goals_write on public.client_goals for insert to authenticated
  with check (app.client_is_visible(client_id));

drop policy if exists client_goals_update on public.client_goals;
create policy client_goals_update on public.client_goals for update to authenticated
  using (app.client_is_visible(client_id))
  with check (app.client_is_visible(client_id));
