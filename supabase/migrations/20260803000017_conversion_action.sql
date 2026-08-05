/* =====================================================================
   Qual ação do pixel conta como conversão
   ---------------------------------------------------------------------
   `meta-ads.ts` já lê `request.conversionActionType` para escolher, de
   dentro do array `actions` da Graph API, QUAL tipo representa a
   conversão daquela conta. Só que não existia coluna para guardar essa
   escolha, e `sync.ts` nunca passava o valor — então todo cliente caía
   no padrão do código: `offsite_conversion.fb_pixel_lead`.

   O estrago é silencioso e específico por segmento. Numa conta de
   e-commerce a Meta devolve `offsite_conversion.fb_pixel_purchase`;
   procurar por `..._lead` não acha nada, e o relatório sai com

     conversões: 0        receita: R$ 0,00        ROAS: 0

   que não parece defeito — parece mês ruim. O mesmo vale para negócio
   local, onde a conversão é conversa iniciada no WhatsApp.

   NULL aqui não é "sem valor": é "usa o padrão do segmento", resolvido
   em `conversionActionFor()`. Assim uma conta nova de e-commerce já
   nasce contando compra, sem depender de alguém lembrar de configurar —
   e quem tem um pixel fora do comum ainda pode sobrescrever.
   ===================================================================== */

alter table public.client_integrations
  add column if not exists conversion_action_type text;

comment on column public.client_integrations.conversion_action_type is
  'action_type da Graph API que conta como conversão. NULL = usa o padrão do segmento do cliente.';


/* ---------------------------------------------------------------------
   Privilégio de escrita que faltava
   ---------------------------------------------------------------------
   `client_integrations` tinha `grant select` e nada mais, embora a
   policy `client_integrations_admin` seja `for all`. Postgres checa o
   PRIVILÉGIO DE TABELA antes da RLS: sem o grant, a policy nunca chega
   a ser avaliada e todo UPDATE volta 42501, "permission denied".

   Na prática o cartão de contas de mídia era somente-leitura — "Vincular
   conta", "Conta pré-paga" e agora o seletor de conversão falhariam os
   três. Passou despercebido porque o INSERT vem do callback de OAuth,
   que usa service_role e ignora grants; só as edições posteriores, que
   passam pela sessão, é que quebravam.

   Quem pode escrever continua sendo decidido pela policy — ou seja,
   admin. O grant apenas permite que ela seja consultada.
   --------------------------------------------------------------------- */

grant insert, update, delete on public.client_integrations to authenticated;
