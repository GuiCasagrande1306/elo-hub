/* =====================================================================
   Cliente não vê a lista de gente das outras empresas
   ---------------------------------------------------------------------
   `profiles_select` é `using (true)` desde a migration 15, e a decisão
   estava certa para o que existia então: o NOME de um colega aparece no
   card da esteira, no histórico de otimização, no filtro de responsável
   e nos avatares da torre de controle. Restringir quebraria as quatro.

   O QUE MUDOU: agora existe login de fora da agência. Medido no teste de
   contenção de 22/08/2026 — um usuário de cliente lia CINCO perfis, com
   e-mail. Enquanto é só a equipe da agência, é discutível. Quando o
   segundo cliente entrar, vira o cliente A lendo nome e e-mail das
   pessoas do cliente B: dado pessoal de terceiro, de outra empresa, sem
   nenhuma relação entre as duas.

   A REGRA NOVA, e o que cada parte dela protege:

     • cliente vê os perfis da PRÓPRIA empresa — precisa, para atribuir
       um lead a um colega
     • cliente vê os perfis da AGÊNCIA (client_id nulo) — precisa, para
       saber quem da agência está com o lead dele
     • cliente NÃO vê perfis de outra empresa — é o que esta migration
       existe para impedir
     • equipe continua vendo tudo, como antes

   RESSALVA HONESTA: o e-mail da equipe da agência continua legível para
   o cliente. RLS é linha, não coluna — esconder um campo exige view ou
   `grant` por coluna. Achei aceitável (é o prestador de serviço, que o
   cliente já conhece pelo nome) e deixo registrado para o caso de a
   decisão ser outra.
   ===================================================================== */

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
  using (
    case
      when app.role_of_user() = 'client' then
        /* `is not distinct from` e não `=`: com os dois lados nulos,
           `=` devolve NULL, que numa policy vale como falso — e o
           cliente perderia de vista a equipe da agência sem erro e sem
           pista. */
        client_id is not distinct from app.client_of_user()
        or client_id is null
      else true
    end
  );

comment on policy profiles_select on public.profiles is
  'Equipe vê todos. Cliente vê a própria empresa e a agência — nunca gente de outro cliente. Ver migration 59.';
