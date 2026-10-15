/* lead_deals.position nasceu integer (migration 56), mas o quadro grava
   Date.now() para "topo da coluna" e a média dos vizinhos ao arrastar.
   Os dois estouram/recusam em integer: o webhook do Meta não conseguia
   gravar nenhum lead, e Qualificar/Descartar falhavam. */

alter table public.lead_deals
  alter column position type double precision;
