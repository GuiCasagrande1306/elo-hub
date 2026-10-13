/* =====================================================================
   Vínculo Asaas ↔ cliente
   ---------------------------------------------------------------------
   Cada cliente pode ter um `customer_id` no Asaas. Com ele:
     - o webhook de pagamento encontra o cliente sem depender de CNPJ
     - o backfill de assinaturas vincula recebimento ao cliente certo
     - o painel financeiro mostra assinaturas com nome do cliente Elo Hub

   Coluna nullable: clientes que ainda não estão no Asaas não precisam
   do campo, e a restrição unique garante que dois clientes não apontem
   para o mesmo cadastro.
   ===================================================================== */

alter table public.client_financials
  add column if not exists asaas_customer_id text unique;

comment on column public.client_financials.asaas_customer_id is
  'ID do cliente no Asaas (ex: cus_000190375377). Permite vincular cobranças e assinaturas sem depender de CNPJ ou e-mail.';
