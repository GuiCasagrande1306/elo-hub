/* =====================================================================
   A métrica que o cliente procura primeiro
   ---------------------------------------------------------------------
   O PEDIDO: pôr em evidência a métrica principal de cada segmento —
   faturamento para loja e delivery, visitas ao perfil para negócio
   local, leads para captação.

   O QUE JÁ ESTAVA CERTO, e por isso este arquivo é pequeno: a COLETA.
   `conversion-action.ts` já escolhe o evento certo por segmento —
   `fb_pixel_purchase` para loja e delivery (é ele que carrega o valor, e
   sem ele não há receita nem ROAS), o trio de formulário/Direct/WhatsApp
   para captação, e o campo `instagram_profile_visits` para negócio
   local. Medido em produção desde 01/07:

       delivery         16 contas   R$  91.015,94 de faturamento
       ecommerce         4 contas   R$ 226.232,61
       leads             5 contas          358 conversões
       local_business   16 contas       11.707 visitas ao perfil

   O QUE ESTAVA ERRADO ERA A VITRINE. A capa do relatório mostra as três
   PRIMEIRAS métricas do template, e:

     • o template de DELIVERY não tinha `revenue` em lugar nenhum. A
       agência coleta R$ 91 mil em pedidos faturados e o cliente recebia
       um documento que não citava o número uma única vez;
     • NEGÓCIO LOCAL chamava a métrica de "Contatos". O dado é visita ao
       perfil do Instagram, que é outra coisa — e o rótulo errado faz o
       cliente comparar com um número que ele mede em outro lugar.

   ⚠️ FATURAMENTO ZERO NÃO É RARO, e o desenho tem que aguentar isso.
   Das 16 contas de delivery, 5 têm receita e conversão zeradas — o pixel
   não registra compra nelas (D'Mori, Bar Desembargador, Hago Pizza, Des
   Cucina, Dom Leonello). Uma delas em ecommerce (Brother Hood). Destacar
   "Faturamento" nessas contas põe um R$ 0,00 gigante na capa do
   documento que vai ao cliente. Por isso o PDF trata o destaque zerado
   como CASO PREVISTO: imprime a frase que explica, em vez do número
   sozinho. Ver `CoverSummary` em `pdf/document.tsx`.

   POR QUE COLUNA E NÃO REGRA NO CÓDIGO. Um `switch (segment)` no
   gerador resolveria hoje e seria mentira amanhã: a tela de templates
   deixa a agência escolher as métricas de cada relatório, e o destaque é
   uma dessas escolhas. Coluna é o que permite mudar sem deploy.
   ===================================================================== */

alter table public.report_templates
  add column if not exists highlight_metric text;

comment on column public.report_templates.highlight_metric is
  'Métrica que abre a capa, em tamanho grande. Precisa estar em `metrics`. Null = capa sem destaque, só a fileira de três.';

/* O destaque tem que ser uma das métricas do próprio template — senão a
   capa exibiria um número que o corpo do relatório não explica.

   ⚠️ `metrics` é `text[]`, NÃO jsonb (schema.sql:335). O operador `?` de
   existência de chave não se aplica; a checagem correta é `= any(...)`.
   `metric_labels`, ao lado, É jsonb (migration 09) — as duas colunas
   guardam listas e têm tipos diferentes, o que é fácil de confundir. */
alter table public.report_templates
  drop constraint if exists report_templates_highlight_in_metrics;

alter table public.report_templates
  add constraint report_templates_highlight_in_metrics check (
    highlight_metric is null
    or highlight_metric = any (metrics)
  );

/* ------------------------------------------------------------------ */
/* Os quatro templates semeados                                        */
/* ------------------------------------------------------------------ */

/* LOJA VIRTUAL — já tinha `revenue` na segunda posição; só ganha o
   destaque. */
update public.report_templates
   set highlight_metric = 'revenue'
 where segment = 'ecommerce'
   and 'revenue' = any (metrics);

/* DELIVERY — GANHA `revenue`, que não existia. Entra logo depois do
   investimento, que é a ordem em que se lê um relatório de mídia:
   quanto entrou, quanto voltou. O rótulo "Faturamento" é o mesmo da
   loja: é a mesma coisa para quem recebe. */
update public.report_templates
   set metrics = array['spend', 'revenue', 'results', 'cpa', 'ctr', 'cpc'],
       metric_labels = coalesce(metric_labels, '{}'::jsonb)
                       || '{"revenue": "Faturamento"}'::jsonb,
       highlight_metric = 'revenue',
       /* O nome e a descrição prometiam o que o template não entregava —
          "conversas geradas" é métrica de captação, não de delivery. */
       name = 'Delivery — Faturamento & Pedidos',
       description = 'Para operação de delivery: quanto os pedidos faturaram, quantos foram e quanto custou cada um.'
 where segment = 'delivery';

/* CAPTAÇÃO — `leads` já é a segunda métrica e já tem o rótulo certo. O
   número inclui formulário do site, formulário nativo da Meta e conversa
   iniciada no WhatsApp/Direct, que é o que a agência entrega. */
update public.report_templates
   set highlight_metric = 'leads'
 where segment = 'leads'
   and 'leads' = any (metrics);

/* NEGÓCIO LOCAL — o dado sempre foi visita ao perfil; o rótulo é que
   dizia "Contatos". Corrigido junto com o custo, que passa a ser por
   visita — "custo por contato" sobre um número de visitas é uma conta
   que não descreve nada. */
update public.report_templates
   set metric_labels = coalesce(metric_labels, '{}'::jsonb) || jsonb_build_object(
         'results', 'Visitas ao perfil',
         'cpa',     'Custo por visita'
       ),
       highlight_metric = 'results',
       /* Nome e descrição diziam "contatos" sobre um número de visitas.
          A tela de templates mostra os dois ao lado do rótulo corrigido,
          e a contradição ficaria à vista de quem for configurar. */
       name = 'Negócio Local — Visitas ao Perfil & Alcance',
       description = 'Para negócio físico: quantas visitas ao perfil a mídia gerou, a que custo, e quanta gente foi impactada.'
 where segment = 'local_business';
