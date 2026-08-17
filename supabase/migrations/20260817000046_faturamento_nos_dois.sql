/* =====================================================================
   "Faturamento" nos dois, não "Receita" num e "Faturamento" no outro
   ---------------------------------------------------------------------
   A migration 45 gravou o rótulo "Faturamento" para `revenue` no template
   de DELIVERY e deixou o de E-COMMERCE sem rótulo próprio — que cai no
   padrão da métrica, "Receita" (`METRIC_DEFINITIONS.revenue` em
   `src/lib/metrics/kpi.ts`).

   O resultado é o mesmo número saindo com dois nomes em relatórios da
   mesma agência, e é justamente o tipo de coisa que o cliente nota
   quando compara com outro documento que já recebeu. As duas palavras
   são defensáveis isoladamente; o que não se defende é usar as duas.

   O NOME DO TEMPLATE VEM JUNTO. "E-commerce — Receita & ROAS" passaria a
   contradizer o rótulo da própria métrica que ele destaca, e esse nome
   aparece na tela de templates ao lado do campo corrigido — a
   contradição ficaria à vista de quem for configurar.

   Isto também dá para fazer pela TELA (Relatórios → Templates → aba
   E-commerce → o campo ao lado de Receita). Está aqui como migration
   porque mudança feita só pelo painel deixa o repositório em desacordo
   com o banco, e foi assim que a migration 36 passou semanas sem rodar
   sem ninguém perceber.
   ===================================================================== */

update public.report_templates
   set metric_labels = coalesce(metric_labels, '{}'::jsonb)
                       || '{"revenue": "Faturamento"}'::jsonb,
       name = 'E-commerce — Faturamento & ROAS',
       description = 'Para loja virtual: quanto o investimento faturou, a que custo e qual o retorno sobre a mídia.'
 where segment = 'ecommerce';
