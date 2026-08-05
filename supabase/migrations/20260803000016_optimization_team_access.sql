/* =====================================================================
   Esteira: acesso alinhado com a visibilidade dos clientes
   ---------------------------------------------------------------------
   As policies de `optimization_history` nasceram apoiadas em
   `app.can_access_client()`, que exige ser admin, dono da conta, ou
   estar em `client_members`. Só que depois disso duas coisas mudaram:

     1. os clientes passaram a ser visíveis para toda a equipe;
     2. `client_members` continua vazia — nada no sistema escreve nela.

   O resultado, medido em produção: o único colaborador não-admin vê o
   cliente "teste" na esteira, mas

     • NÃO enxerga o histórico — a conta aparece como "sem registro" e é
       marcada ATRASADA mesmo tendo sido otimizada hoje;
     • NÃO consegue registrar — o insert é recusado com 42501 depois de
       ele já ter escrito a nota.

   Nenhum dos dois avisa que é permissão. Parecem perda de dado.

   A esteira é rotina de equipe, não propriedade individual: quem lê a
   conta lê o que foi feito nela, e quem lê pode registrar. A prova de
   autoria não vem de restringir a escrita — vem de `collaborator_id`,
   que continua obrigatoriamente sendo quem está logado, e da tabela não
   ter UPDATE nem DELETE para ninguém.

   `can_access_client` NÃO muda: ela ainda guarda métricas, honorários e
   integrações, onde a regra estrita faz sentido.
   ===================================================================== */

drop policy if exists optimization_history_select on public.optimization_history;
drop policy if exists optimization_history_insert on public.optimization_history;

create policy optimization_history_select
  on public.optimization_history for select to authenticated
  using (
    -- Espelha a visibilidade do cliente: vê a conta, vê a rotina dela.
    exists (select 1 from public.clients c where c.id = client_id)
  );

create policy optimization_history_insert
  on public.optimization_history for insert to authenticated
  with check (
    exists (select 1 from public.clients c where c.id = client_id)
    -- O autor não pode ser forjado: quem grava é quem está logado.
    and collaborator_id = (select auth.uid())
  );

comment on table public.optimization_history is
  'Registro append-only da esteira. Toda a equipe lê e escreve; a autoria vem da sessão e não há UPDATE nem DELETE.';
