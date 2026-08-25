/* =====================================================================
   O objetivo da campanha, junto da métrica do dia
   ---------------------------------------------------------------------
   POR QUE. O custo por resultado e o ROAS eram divididos pelo gasto da
   CONTA INTEIRA. Na Satö, 17–23/08/2026:

     04 | CONVERSÃO       R$335,08 · 20 compras · R$4.138,21
     03 | RECONHECIMENTO  R$ 40,00 ·  2 compras · R$  336,60
     01 | TRÁFEGO         R$106,66 ·  0
     02 | WHATSAPP        R$ 68,55 ·  0
     ----------------------------------------------------------
     conta inteira        R$550,29 · 22 compras · R$4.474,81

   Dividir tudo dá R$25,01 por compra e ROAS 8,13. Isolando a campanha
   que existe para vender: R$16,75 e 12,35. Os R$215,21 de alcance,
   tráfego e WhatsApp não são custo de compra nenhuma — eles pagam outra
   coisa, e somá-los faz uma conta lucrativa parecer no prejuízo.

   Para isolar é preciso saber PARA QUE cada campanha foi criada, e isso
   o banco não guardava: `daily_metrics` tinha o gasto por campanha desde
   sempre (11.276 linhas, nenhuma agregada em '_all'), mas nada dizia se
   a campanha era de venda ou de alcance.

   POR QUE AQUI E NÃO NUMA TABELA DE CAMPANHAS. O objetivo é atributo da
   campanha, não do dia — uma tabela `campaigns` seria mais normalizada.
   Só que toda leitura desta métrica é "some as linhas deste período" e
   passaria a exigir join; e o job de sync já escreve uma linha por
   campanha por dia, então preencher duas colunas a mais não custa
   chamada nova. A repetição é o preço, e é barato: são dois textos
   curtos por linha.

   NULO É ESTADO LEGÍTIMO, em três casos, e quem lê precisa tratá-los:
     - Google Ads, que não tem `objective` equivalente
     - linha antiga, gravada antes desta migration
     - campanha que a Meta devolve sem o campo
   A regra em `campanha-de-origem.ts` trata nulo como "não sei": a
   campanha entra na conta se PRODUZIU o resultado. Nunca vira zero.
   ===================================================================== */

alter table public.daily_metrics
  add column if not exists objective         text,
  add column if not exists optimization_goal text;

comment on column public.daily_metrics.objective is
  'Objetivo da campanha na plataforma (OUTCOME_SALES, OUTCOME_LEADS...). NULL = desconhecido, não "nenhum". Ver campanha-de-origem.ts.';

comment on column public.daily_metrics.optimization_goal is
  'O que o leilão otimiza (OFFSITE_CONVERSIONS, REPLIES...). Mais específico que `objective` e tem precedência sobre ele.';
