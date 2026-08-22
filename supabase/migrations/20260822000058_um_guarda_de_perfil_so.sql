/* =====================================================================
   Um guarda de perfil, não dois
   ---------------------------------------------------------------------
   A migration 55 criou `guard_client_profile` sem notar que
   `trg_profiles_guard` já existia desde a migration 2, fazendo trabalho
   sobreposto na mesma tabela e no mesmo momento.

   O ESTRAGO ERA REAL, e apareceu no teste de contenção. Os dois são
   BEFORE UPDATE, e o Postgres os dispara em ordem alfabética de NOME:
   `guard_client_profile` primeiro, `trg_profiles_guard` depois. O
   primeiro deixava a atribuição passar; o segundo, que não conhece
   `client_id`, revertia só o `role`. Sobrava a linha incoerente —
   `role=collaborator` com `client_id` preenchido — e o check
   `profiles_client_role_coerente` recusava com 23514.

   Duas defesas escritas em momentos diferentes, cada uma correta
   sozinha, produzindo juntas um estado que nenhuma das duas queria. É o
   argumento contra guardar a mesma regra em dois lugares.

   Agora é um só, e ele sabe das três colunas que precisa congelar.
   ===================================================================== */

create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  /* O SERVIDOR PASSA. É por aqui que o convite de um cliente atribui
     papel e empresa, e é a única porta pela qual isso deve acontecer —
     nenhuma sessão de usuário alcança este ponto com essa intenção,
     porque a RLS barra antes.

     `security invoker` para que `current_user` diga a verdade: sob
     `security definer` ele vira o DONO da função, e a comparação seria
     sempre contra o mesmo nome. */
  if current_user = 'service_role' then
    return new;
  end if;

  if app.is_admin() then
    return new;                     -- admin pode promover/desativar
  end if;

  new.role      := old.role;        -- colaborador nunca vira admin
  new.is_active := old.is_active;   -- nem se reativa sozinho

  /* A TERCEIRA, que faltava. Sem ela, um usuário de cliente daria um
     UPDATE em si mesmo trocando `client_id` e passaria a enxergar a
     base de outra empresa — a coluna nasceu na migration 55 e este
     guarda, escrito antes dela, não a conhecia. */
  new.client_id := old.client_id;

  return new;
end;
$$;

/* O guarda duplicado sai de cena. A regra dele foi absorvida acima. */
drop trigger if exists guard_client_profile on public.profiles;
drop function if exists app.guard_client_profile();
