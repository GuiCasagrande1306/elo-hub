/* =====================================================================
   A função do funil precisa morar onde a API enxerga
   ---------------------------------------------------------------------
   `app.criar_funil_padrao` foi criada no schema `app`, junto das outras
   funções auxiliares. Faz sentido para as que só a RLS chama — mas esta
   é chamada pelo APLICATIVO, ao abrir o CRM, e o PostgREST expõe apenas
   `public`.

   Medido em 22/08/2026: a chamada volta 404 PGRST202, "Searched for the
   function public.criar_funil_padrao... but no". O funil nunca era
   criado, e a tela mostraria um quadro vazio sem dizer por quê.

   AS DUAS VIRAM `security invoker`, e isso é conserto, não detalhe.
   `security definer` faria os INSERTs passarem por cima da RLS — e aí a
   única coisa impedindo um cliente de criar funil na empresa de outro
   seria a checagem escrita à mão dentro da função. Com `invoker`, quem
   decide é a mesma policy que decide todo o resto: uma regra, um lugar.

   E a checagem à mão nem funcionaria: `app.client_is_visible` é
   `security invoker` e lê `clients` sob a RLS de quem chama. Dentro de
   uma função `definer`, quem chama passa a ser o DONO — a visibilidade
   daria sempre verdadeiro, e a checagem seria decorativa.
   ===================================================================== */

create or replace function app.criar_funil_padrao(p_client uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pipeline uuid;
begin
  select id into v_pipeline
  from public.lead_pipelines
  where client_id = p_client and is_default
  limit 1;

  if v_pipeline is not null then
    return v_pipeline;
  end if;

  insert into public.lead_pipelines (client_id, name, is_default, position)
  values (p_client, 'Funil de vendas', true, 0)
  returning id into v_pipeline;

  insert into public.lead_stages (pipeline_id, name, kind, color, position)
  values
    (v_pipeline, 'Novo contato',  'aberto',  '#64748B', 0),
    (v_pipeline, 'Em conversa',   'aberto',  '#3B82F6', 1),
    (v_pipeline, 'Proposta',      'aberto',  '#A855F7', 2),
    (v_pipeline, 'Ganho',         'ganho',   '#1F7A4D', 3),
    (v_pipeline, 'Perdido',       'perdido', '#B03A2E', 4);

  return v_pipeline;
end;
$$;

/* A porta pública. Fina de propósito: só encaminha, para a lógica viver
   num lugar só. */
create or replace function public.criar_funil_padrao(p_client uuid)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$
  select app.criar_funil_padrao(p_client);
$$;

comment on function public.criar_funil_padrao(uuid) is
  'Cria o funil inicial de um cliente. Idempotente. Exposta em public porque o PostgREST só enxerga esse schema.';

grant execute on function public.criar_funil_padrao(uuid) to authenticated;
grant execute on function app.criar_funil_padrao(uuid)    to authenticated;
