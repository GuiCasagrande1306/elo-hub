/* =====================================================================
   Perfis legíveis por toda a equipe
   ---------------------------------------------------------------------
   `profiles_select` exigia: ser o próprio perfil, ser admin, ou
   compartilhar uma tarefa com a pessoa. A regra fazia sentido quando o
   sistema era só tarefas — mas hoje o NOME de um colega aparece em
   lugares que não têm tarefa nenhuma:

     • "última: Fulano" no card da esteira
     • o autor de cada registro no histórico de otimização
     • o filtro "Todos os responsáveis"
     • os avatares no radar da torre de controle

   Em todos eles o join com `profiles` voltava NULL para quem não
   compartilhava tarefa, e a tela exibia "Autor removido" — um erro que
   parece perda de dado e não é.

   Nome de colega é lista de equipe, não segredo. A partir daqui,
   qualquer autenticado lê a tabela.

   ⚠️ O QUE ISSO ABRE: `profiles` guarda `email` e `job_title`, que
   passam a ser legíveis por qualquer membro da equipe via API. Numa
   agência isso é o crachá; se um dia deixar de ser, o caminho é o mesmo
   do honorário — mover para tabela própria, porque RLS é por linha e
   não por coluna.

   O que NÃO muda: escrever continua restrito. `profiles_update_self`
   limita cada um ao próprio registro, e o trigger
   `guard_profile_privileges` impede autopromoção a admin.
   ===================================================================== */

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
  using (true);

comment on policy profiles_select on public.profiles is
  'Equipe visível para todos os autenticados. Escrita segue restrita ao próprio perfil.';
