/* =====================================================================
   Editar otimização da esteira
   ---------------------------------------------------------------------
   A tabela nasceu APPEND-ONLY de propósito, e o comentário dela dizia
   isso: "a autoria vem da sessão e não há UPDATE nem DELETE". O motivo
   era bom — o histórico é o que explica a variação do mês seguinte, e
   reescrevê-lo em silêncio apaga o registro do que de fato foi feito.

   O que muda aqui é o "em silêncio", não o append-only inteiro:

     • UPDATE liberado para o AUTOR e para ADMIN. Autor porque errar de
       dedo ao registrar o que acabou de fazer é rotina; admin porque
       numa equipe pequena quem revisa a conta precisa poder corrigir o
       registro de quem já saiu do expediente.

     • DELETE continua PROIBIDO. Corrigir texto é uma coisa; fazer uma
       rodada inteira desaparecer do histórico é outra, e não há caso de
       uso que peça isso.

     • `edited_at` e `edited_by` gravam que houve edição, e a tela mostra.
       Sem eles, a correção seria indistinguível do original — que é
       exatamente o que o desenho append-only queria evitar.

   ⚠️ AS COLUNAS DE AUDITORIA NÃO SÃO CONFIÁVEIS SE O CLIENTE PUDER
   ESCREVÊ-LAS. A policy sozinha não impede alguém de mandar
   `edited_by = <outra pessoa>` no mesmo UPDATE. Por isso o trigger
   abaixo as sobrescreve SEMPRE, com a sessão — do mesmo jeito que o
   `insert` já força `collaborator_id = auth.uid()`.

   ⚠️ GRANT ANTES DE POLICY. O Postgres checa o privilégio da tabela
   ANTES de avaliar RLS: sem o `grant update`, a policy nova nunca é
   alcançada e o update falha com permissão negada, sem explicação.
   ===================================================================== */

alter table public.optimization_history
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.profiles (id) on delete set null;

comment on column public.optimization_history.edited_at is
  'Quando o registro foi editado pela última vez. Null = nunca editado.';
comment on column public.optimization_history.edited_by is
  'Quem editou por último. Preenchido pelo trigger, nunca pelo cliente.';

grant update on public.optimization_history to authenticated;

/* ------------------------------------------------------------------ */
/* Autoria da edição, forçada no servidor                              */
/* ------------------------------------------------------------------ */

create or replace function app.stamp_optimization_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  /* Descarta o que o cliente mandou nestas colunas e no que não pode
     mudar. `client_id` e `collaborator_id` fixos: mover uma otimização
     de conta, ou reatribuir a autoria, reescreveria a história em vez de
     corrigir o texto dela. */
  new.client_id       := old.client_id;
  new.collaborator_id := old.collaborator_id;
  new.created_at      := old.created_at;

  new.edited_at := now();
  new.edited_by := (select auth.uid());

  return new;
end;
$$;

drop trigger if exists stamp_optimization_edit on public.optimization_history;

create trigger stamp_optimization_edit
  before update on public.optimization_history
  for each row execute function app.stamp_optimization_edit();

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

drop policy if exists optimization_history_update on public.optimization_history;

create policy optimization_history_update
  on public.optimization_history for update to authenticated
  using (
    exists (select 1 from public.clients c where c.id = client_id)
    and (collaborator_id = (select auth.uid()) or app.is_admin())
  )
  /* O `with check` repete a condição de propósito: sem ele, a linha
     poderia ser editada para um estado que a própria policy recusaria
     na leitura seguinte. */
  with check (
    exists (select 1 from public.clients c where c.id = client_id)
    and (collaborator_id = (select auth.uid()) or app.is_admin())
  );

comment on table public.optimization_history is
  'Registro da esteira. Toda a equipe lê e escreve; a autoria vem da sessão. O autor e o admin editam, e a edição fica carimbada em edited_at/edited_by. Não há DELETE.';
