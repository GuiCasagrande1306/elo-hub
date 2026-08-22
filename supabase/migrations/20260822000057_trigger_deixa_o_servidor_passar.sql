/* =====================================================================
   O guarda de perfil estava barrando o próprio servidor
   ---------------------------------------------------------------------
   O trigger da migration 55 congela `role` e `client_id` para quem não é
   admin. A intenção continua certa: sem ele, um usuário de cliente daria
   um UPDATE em si mesmo trocando `client_id` e passaria a enxergar a
   base de outro.

   O QUE ELE ERRAVA: `app.is_admin()` lê `profiles` por `auth.uid()`.
   Numa chamada com `service_role` — que é como o servidor age no convite
   de um cliente — não existe `auth.uid()`: a função devolve nulo, o
   `if` não entra, e o trigger REVERTE a atribuição.

   E revertia EM SILÊNCIO. O UPDATE respondia 200, com a linha de volta
   no corpo, e os campos intactos. Medido em 22/08/2026 tentando marcar
   um usuário de teste como cliente: veio `role=collaborator` e o
   `client_id` inalterado, sem erro nenhum. O fluxo de convite teria
   falhado assim, e a pessoa entraria vendo a carteira inteira.

   `security invoker` para que `current_user` diga a verdade: numa função
   `security definer` ele passa a ser o DONO da função, e a checagem
   compararia sempre contra o mesmo nome. Sob RLS bypassada do
   service_role, `app.is_admin()` continua funcionando igual.
   ===================================================================== */

create or replace function app.guard_client_profile()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  /* O SERVIDOR PASSA. É ele quem atribui papel e empresa no convite, e
     é a única porta pela qual isso deve acontecer — a RLS já impede que
     qualquer sessão de usuário chegue aqui com essa intenção. */
  if current_user = 'service_role' then
    return new;
  end if;

  -- Admin manda; a checagem existe para o resto.
  if app.is_admin() then
    return new;
  end if;

  /* Papel e empresa são imutáveis para quem não é admin. */
  new.role      := old.role;
  new.client_id := old.client_id;

  return new;
end;
$$;
