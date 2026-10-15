/* =====================================================================
   Lead Notify — config por cliente para disparo automático via WhatsApp
   =====================================================================

   meta_page_id   — ID numérico da Página do Facebook vinculada a este
                    cliente. Usado para rotear o webhook de Lead Ads:
                    quando o Meta bate na porta, este campo diz a quem
                    pertence o lead. Único: uma página por cliente.

   lead_notify_phone — Número que recebe a mensagem de WhatsApp quando
                    um lead chega. Pode ser o próprio cliente (número
                    já existente em whatsapp_phone) ou o gestor da
                    conta. Nulo = sem notificação automática.

   Separado de whatsapp_phone propositalmente: o número de contato do
   cliente (whatsapp_phone) é para relatórios; o de notificação é para
   o dono da empresa ser avisado de lead em tempo real — podem ser a
   mesma pessoa ou não.
   ===================================================================== */

alter table public.clients
  add column if not exists meta_page_id      text unique,
  add column if not exists lead_notify_phone text
    check (lead_notify_phone is null or lead_notify_phone ~ '^[0-9]{10,15}$');
