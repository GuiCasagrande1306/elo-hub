-- NPS da agência parceira (pedido de 16/11/2026).
--
-- Cliente de agência parceira não paga a Elo: quem paga, e portanto
-- quem responde o NPS, é a própria agência. O painel deixa de listar
-- esses clientes e passa a listar a agência, com link próprio.

-- 1) Link por agência, igual ao do cliente (64 hex).
alter table public.agency_contracts
  add column if not exists nps_token text unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

update public.agency_contracts
   set nps_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where nps_token is null;

-- 2) A resposta é de um cliente OU de uma agência — exatamente um.
alter table public.nps_responses
  alter column client_id drop not null;

alter table public.nps_responses
  add column if not exists agency text
    references public.agency_contracts (agency) on update cascade on delete cascade;

do $$
begin
  alter table public.nps_responses
    add constraint nps_responses_um_respondente
    check ((client_id is null) <> (agency is null));
exception
  when duplicate_object then null;
end $$;

create index if not exists nps_responses_agencia_idx
  on public.nps_responses (agency, submitted_at desc);
