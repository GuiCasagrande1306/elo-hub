/* =====================================================================
   ROAS no relatório de delivery
   ---------------------------------------------------------------------
   O template de delivery listava `spend, revenue, results, cpa, ctr,
   cpc, aov` — sem ROAS. Dezenove clientes, entre eles Satö, Brazzo,
   D'Billys e Seu Parma, nunca viram o retorno no relatório.

   Isso passou a doer agora porque o custo e o ROAS deixaram de ser
   divididos pelo gasto da conta inteira (migration 69) e passaram a sair
   da campanha que gera o resultado. Na Satö, 17–23/08/2026, o retorno
   isolado é 12,35 contra os 8,13 diluídos — e era exatamente esse número
   que o cliente não tinha como ver. Ele ficava fazendo a conta de
   cabeça: R$4.474,81 sobre R$550,29, chegando ao 8,13 que a correção
   acabara de aposentar.

   ONDE O ROAS ENTRA NA ORDEM: logo depois de `revenue`, como no template
   de e-commerce. Os dois números são lidos juntos — quanto voltou, e
   quantas vezes o investimento.

   PRESERVA CUSTOMIZAÇÃO. O `update` insere `roas` na posição certa em
   vez de reescrever a lista inteira: quem tiver ajustado as métricas
   deste template pela tela (Relatórios → Templates) não perde o ajuste.
   E o `where` com `not (... = any(metrics))` torna a migration
   idempotente — rodar de novo não duplica o card.

   Está aqui como migration, e não como um clique na tela, pelo motivo
   que a migration 46 já registrou: mudança feita só pelo painel deixa o
   repositório em desacordo com o banco. Nesta mesma sessão isso custou
   caro — a migration 34 nunca rodou em produção e deixou o módulo de
   mídias sociais intransitável por semanas, sem ninguém perceber.
   ===================================================================== */

update public.report_templates
   set metrics =
         metrics[1 : coalesce(array_position(metrics, 'revenue'), 1)]
         || array['roas']
         || metrics[coalesce(array_position(metrics, 'revenue'), 1) + 1
                    : array_length(metrics, 1)]
 where segment = 'delivery'
   and not ('roas' = any (metrics));
