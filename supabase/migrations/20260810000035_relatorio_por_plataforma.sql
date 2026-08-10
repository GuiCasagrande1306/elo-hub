/* =====================================================================
   Uma página por plataforma no relatório
   ---------------------------------------------------------------------
   Acrescenta a seção `platform_detail` a todos os templates: Meta Ads e
   Google Ads separados, cada um com o quadro completo de métricas
   (investimento, impressões, cliques, CTR, CPC, CPM, resultados, custo
   por resultado, receita, ROAS, ticket médio) e as próprias campanhas.

   POR QUE NÃO BASTAVA `platform_split`. Aquela seção responde "quanto
   do orçamento foi para cada canal" — uma barra de participação. É a
   pergunta errada: ela esconde que o Google entregou o dobro de
   resultados com metade do investimento, porque só mostra a fatia.

   ENTRA DEPOIS de `platform_split` e ANTES de `campaign_table`: a
   participação abre o assunto, o detalhe por canal desenvolve, e a
   tabela consolidada fecha.

   ⚠️ MIGRATION DE DADOS, NÃO DE ESQUEMA. Nenhuma coluna muda — o que
   muda é o conteúdo de `report_templates.sections`, que é jsonb. Sem
   isto a seção existiria no código e nunca apareceria em PDF nenhum,
   porque o documento renderiza a partir do que está gravado no
   template, não de uma lista fixa.

   IDEMPOTENTE: o `where` recusa templates que já a tenham, então rodar
   duas vezes não duplica a página.
   ===================================================================== */

update public.report_templates t
   set sections = (
     /* Reconstrói o array inserindo a nova seção logo depois de
        `platform_split`. `jsonb_agg` com `ordinality` preserva a ordem
        original — sem isso o Postgres não garante a sequência e as
        seções sairiam embaralhadas no PDF. */
     select jsonb_agg(secao order by ordem)
       from (
         select elem as secao, i * 2 as ordem
           from jsonb_array_elements(t.sections) with ordinality as e(elem, i)

         union all

         select
           jsonb_build_object(
             'type', 'platform_detail',
             'title', 'Desempenho por plataforma'
           ),
           i * 2 + 1
           from jsonb_array_elements(t.sections) with ordinality as e(elem, i)
          where elem ->> 'type' = 'platform_split'
       ) ordenado
   )
 where not exists (
   select 1
     from jsonb_array_elements(t.sections) as s(elem)
    where s.elem ->> 'type' = 'platform_detail'
 )
   and exists (
     select 1
       from jsonb_array_elements(t.sections) as s(elem)
      where s.elem ->> 'type' = 'platform_split'
   );

/* Templates que não tinham `platform_split` — nenhum hoje, mas um
   template criado à mão pela tela pode não ter. Aí a seção entra antes
   de `insights`, que é onde o texto do time começa: o detalhe por canal
   é dado, e dado vem antes de leitura. */
update public.report_templates t
   set sections = t.sections || jsonb_build_array(
     jsonb_build_object(
       'type', 'platform_detail',
       'title', 'Desempenho por plataforma'
     )
   )
 where not exists (
   select 1
     from jsonb_array_elements(t.sections) as s(elem)
    where s.elem ->> 'type' = 'platform_detail'
 );

comment on column public.report_templates.sections is
  'Seções do PDF, na ordem. `platform_detail` rende uma página por plataforma com veiculação no período — ver src/lib/reports/platform-detail.ts.';
