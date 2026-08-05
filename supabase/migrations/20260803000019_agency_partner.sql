/* =====================================================================
   Agência de origem do cliente
   ---------------------------------------------------------------------
   Parte da carteira vem de terceirização: outra agência fecha o
   contrato e a Elo opera a mídia. Hoje nada distingue essas contas das
   próprias — e a pergunta "quanto a gente roda para a Bagano?" só é
   respondível de cabeça.

   `not null` com default: a coluna decide o que aparece no filtro, e um
   NULL viraria uma quarta categoria invisível — a conta some de "Elo
   Marketing" e de todas as parceiras ao mesmo tempo, sem erro nenhum.
   O default cobre o cadastro; o UPDATE cobre quem já existia.

   TEXT e não enum: a lista de parceiras muda por decisão comercial, e
   um enum obrigaria migração a cada acordo novo. A restrição de valores
   fica no formulário, onde é barata de mudar.
   ===================================================================== */

alter table public.clients
  add column if not exists agency_partner text not null default 'Elo Marketing';

update public.clients
   set agency_partner = 'Elo Marketing'
 where agency_partner is null
    or btrim(agency_partner) = '';

comment on column public.clients.agency_partner is
  'Agência que detém o contrato. "Elo Marketing" = conta própria; demais valores são terceirização.';

/* O filtro roda em toda abertura da tela de clientes. Índice pequeno,
   mas evita varredura completa quando a carteira crescer. */
create index if not exists clients_agency_partner_idx
  on public.clients (agency_partner);
