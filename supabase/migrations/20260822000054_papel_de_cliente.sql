/* =====================================================================
   O papel 'client' — sozinho, num arquivo só
   ---------------------------------------------------------------------
   DUAS ARMADILHAS, e esta migration existe por causa das duas.

   1. `alter type ... add value` NÃO RODA DENTRO DE UMA TRANSAÇÃO — e o
      SQL Editor do Supabase envolve o que se cola nele numa. Rodado
      assim, ele falha (ou é revertido) sem deixar o valor no enum.

      O `commit;` da primeira linha fecha a transação implícita antes do
      alter. Fora de transação ele apenas avisa "there is no transaction
      in progress" e segue — inofensivo nos dois casos.

   2. O valor novo não pode ser USADO na mesma transação em que é
      criado: o Postgres aceita adicioná-lo e recusa qualquer comparação
      até a transação fechar. Um `check (role = 'client')` logo abaixo
      falharia com "unsafe use of new value".

   Por isso esta migration tem duas linhas de efeito e nada mais. A 55
   usa o valor; rode esta primeiro, sozinha, e confira antes de seguir.

   COMO CONFERIR, e não confie em ausência de erro: rode

       select unnest(enum_range(null::public.user_role));

   Tem de listar admin, collaborator e client. Um `update` de teste em
   linha que não existe NÃO serve — nenhuma linha casa, o enum nunca é
   validado, e o silêncio parece confirmação. Foi exatamente o erro que
   me fez dizer que esta migration tinha sido aplicada quando não tinha.
   ===================================================================== */

commit;

alter type public.user_role add value if not exists 'client';
