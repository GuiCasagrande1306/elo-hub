/* =====================================================================
   O papel 'client' — sozinho, num arquivo só
   ---------------------------------------------------------------------
   `alter type ... add value` NÃO PODE SER USADO NA MESMA TRANSAÇÃO em
   que é criado. O Postgres aceita adicionar o valor, e recusa qualquer
   comparação com ele até a transação fechar — um `check (role =
   'client')` logo abaixo falharia com "unsafe use of new value".

   Por isso esta migration tem uma linha. A de número 55 usa o valor.
   Rode esta primeiro, inteira, e só então a seguinte.

   É a mesma armadilha que o cabeçalho da migration 33 já descrevia ao
   explicar por que as redes sociais usam `check` e não `enum`. Aqui o
   enum já existia; resta conviver com ele.
   ===================================================================== */

alter type public.user_role add value if not exists 'client';
