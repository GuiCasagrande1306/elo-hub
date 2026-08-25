/* =====================================================================
   A hora da programação semanal, agora sem 25:00
   ---------------------------------------------------------------------
   O `check` da migration 70 era `^[0-2][0-9]:[0-5][0-9]$`, e ele tem um
   furo que só aparece quando se testa: `[0-2]` casa o "2" e `[0-9]` casa
   o "5", então 25:00 até 29:59 passam. Medido em 25/08/2026 inserindo
   `hora = '25:00'` com a chave de serviço: aceito.

   O ESTRAGO SERIA NO GERADOR, não aqui. `montarAgendamento` montaria
   "2026-08-26T25:00:00-03:00", o Postgres recusaria o timestamp, e a
   materialização daquela linha falharia toda semana — sem nada na tela
   dizendo por quê, porque o erro nasce a um passo de distância de onde
   o dado errado entrou.

   `<input type="time">` não produz 25:00, mas Server Action é endpoint
   HTTP público: ter saído de um componente nosso não torna o payload
   confiável. O zod de `programacao-actions.ts` foi corrigido junto —
   este `check` é a segunda parede, não a primeira.
   ===================================================================== */

alter table public.social_recurrences
  drop constraint if exists social_recurrences_hora_check;

alter table public.social_recurrences
  add constraint social_recurrences_hora_check
  check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
