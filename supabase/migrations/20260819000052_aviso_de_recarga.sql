/* =====================================================================
   Quando o cliente foi avisado da recarga
   ---------------------------------------------------------------------
   A tela de alertas passa a preparar um aviso para o GRUPO DO CLIENTE
   quando o saldo chega a cinco dias. Quem envia é uma pessoa, pelo
   próprio WhatsApp — mesmo desenho do relatório, e pelo mesmo motivo:
   pedido de recarga no grupo errado, ou com valor estranho, não tem
   desfazer.

   ESTA COLUNA É A TRAVA DE REPETIÇÃO. Sem ela, a conta reaparece na
   fila no dia seguinte com o mesmo aviso, e o cliente recebe a mesma
   cobrança todo dia até pagar — que é a forma mais rápida de a agência
   virar spam no próprio grupo.

   Guarda o INSTANTE, não um booleano: passados alguns dias sem recarga,
   avisar de novo é legítimo. O booleano não saberia dizer quando.
   ===================================================================== */

alter table public.client_integrations
  add column if not exists recharge_notice_sent_at timestamptz;

comment on column public.client_integrations.recharge_notice_sent_at is
  'Último aviso de recarga enviado ao grupo do cliente. NULL = nunca avisado.';
