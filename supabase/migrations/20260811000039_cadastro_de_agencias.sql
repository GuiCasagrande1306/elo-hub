/* =====================================================================
   Agências viram cadastro, não constante
   ---------------------------------------------------------------------
   A lista de agências parceiras morava numa `const` do TypeScript
   (`AGENCY_PARTNERS`), e o comentário dela avisava o preço disso:
   renomear uma agência exigia UPDATE em duas tabelas E deploy de código,
   e esquecer o deploy fazia o formulário empurrar os clientes daquela
   agência de volta para a conta própria — voltando a cobrá-los
   individualmente.

   Cadastrar uma agência nova era, literalmente, mudar código.

   AGORA A LISTA É `agency_contracts`, que já era a tabela por agência e
   já tinha `agency` como chave primária.

   `is_own` SUBSTITUI A COMPARAÇÃO POR NOME. A regra de faturamento
   ("cliente de agência parceira não gera cobrança individual; quem paga
   é a agência") era decidida comparando com a string "Elo Marketing" em
   `AGENCIA_PROPRIA`. Isso amarrava a lógica de dinheiro a um literal —
   e, num sistema que agora emite relatório com a marca de cada agência,
   deixa de fazer sentido que uma delas seja especial no código.

   Exatamente UMA linha pode ter `is_own = true`: o índice único parcial
   abaixo garante. Duas agências próprias fariam a régua de faturamento
   responder coisas diferentes conforme a ordem da consulta.
   ===================================================================== */

alter table public.agency_contracts
  add column if not exists is_own boolean not null default false;

comment on column public.agency_contracts.is_own is
  'A agência que opera este painel. Clientes dela são faturados individualmente; os das demais entram na cobrança da parceira. Só uma linha pode ser true.';

/* A que já existe assume o papel, sem depender do nome. */
update public.agency_contracts
   set is_own = true
 where agency = 'Elo Marketing';

create unique index if not exists agency_contracts_uma_propria
  on public.agency_contracts (is_own)
  where is_own;

/* ------------------------------------------------------------------ */
/* As parceiras que só existiam no código viram linha                  */
/* ------------------------------------------------------------------ */

/* Sem isto, o seletor de agência do cadastro de cliente nasceria com
   menos opções do que tinha antes: as parceiras que nunca fecharam
   contrato de honorário não têm linha em `agency_contracts`, e a lista
   passa a sair daqui. `monthly_fee_cents` zero significa "combinado não
   fechado" — o job de recorrência já pula essas. */
insert into public.agency_contracts (agency, monthly_fee_cents, notes)
select nome, 0, 'Migrada da lista fixa do código em 11/08/2026.'
  from (values
    ('Brava Reels'),
    ('Bagano'),
    ('Ampla Marketing'),
    ('Grupo Tasty'),
    ('Agência Send')
  ) as t(nome)
on conflict (agency) do nothing;

/* ------------------------------------------------------------------ */
/* Escrita para admin                                                  */
/* ------------------------------------------------------------------ */

/* GRANT ANTES DA POLICY: o Postgres checa o privilégio da tabela antes
   de avaliar RLS, e sem ele a policy nunca é alcançada.

   Leitura para toda a equipe, porque o seletor de agência aparece no
   cadastro de cliente e o relatório precisa resolver quem assina.
   Escrita só para admin: mexer aqui move dinheiro de lugar. */
grant select on public.agency_contracts to authenticated;
grant insert, update, delete on public.agency_contracts to authenticated;

drop policy if exists agency_contracts_select on public.agency_contracts;
drop policy if exists agency_contracts_write  on public.agency_contracts;

create policy agency_contracts_select
  on public.agency_contracts for select to authenticated
  using (true);

create policy agency_contracts_write
  on public.agency_contracts for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

comment on table public.agency_contracts is
  'Cadastro das agências: identidade do relatório (nome, cor, logo) e contrato de honorário. Toda a equipe lê; só admin escreve.';

/* ------------------------------------------------------------------ */
/* Logo de agência no bucket `brand`                                   */
/* ------------------------------------------------------------------ */

/* A policy de escrita do bucket assumia que TODO caminho começa pelo id
   de um cliente: `app.can_write_client(split_part(name,'/',1)::uuid)`.
   Um logo de agência, em `agencias/<nome>/<arquivo>`, faria esse cast
   estourar com "invalid input syntax for type uuid" — erro de banco cru
   chegando à tela, não uma recusa educada.

   `case` e não `and`/`or`: o CASE garante ordem de avaliação, então o
   cast para uuid só acontece no ramo em que o segmento JÁ foi conferido
   como uuid. Com `or`, o planejador pode avaliar o outro lado e estourar
   assim mesmo.

   Pasta `agencias/` reservada e restrita a admin — é a mesma régua do
   cadastro: mexer em agência move dinheiro de lugar. */

drop policy if exists "storage_brand_write" on storage.objects;

create policy "storage_brand_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand'
    and case
          when split_part(name, '/', 1) = 'agencias' then app.is_admin()
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then app.can_write_client(split_part(name, '/', 1)::uuid)
          else false
        end
  );
