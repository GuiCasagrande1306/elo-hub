/* Remove a constraint que só aceitava dígitos em lead_notify_phone —
   agora o campo também aceita JID de grupo do WhatsApp (ex.: 120363...@g.us). */
alter table public.clients
  drop constraint if exists clients_lead_notify_phone_check;
