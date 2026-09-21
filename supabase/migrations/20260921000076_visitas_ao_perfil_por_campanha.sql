/* =====================================================================
   Visita ao perfil, por campanha
   ---------------------------------------------------------------------
   A tabela de campanhas do PDF imprime, na coluna de resultado, o que a
   CONTA conta como conversão — um número só, escolhido por segmento em
   `conversion-action.ts`. Numa conta de captação isso é conversa
   iniciada; e a campanha que compra visita ao perfil não gera nenhuma.

   Medido na Meu Case, 11–17/09/2026:

     01 | ENGAJAMENTO INSTAGRAM   R$ 79,80   PROFILE_AND_PAGE_ENGAGEMENT
                                  resultado impresso: 0
     02 | ENGAJAMENTO WHATSAPP    R$ 23,79   REPLIES
                                  resultado impresso: 4

   O cliente lê "gastei R$ 79,80 e tive zero" sobre a campanha que
   entregou 131 visitas ao perfil — número que o MESMO PDF imprime, no
   card do criativo logo abaixo da tabela.

   O DADO JÁ ERA BUSCADO E JOGADO FORA. `instagram_profile_visits` é
   campo próprio do Insights, disponível no nível de campanha, e já está
   no `fields` do sync desde que visita virou conversão de negócio
   local. Só que `toNormalizedRow` colapsa tudo em `conversions` usando
   os tipos da conta: quem não é `local_business` busca o número e o
   descarta. Esta coluna é o lugar para ele.

   ⚠️⚠️ RODE ANTES DO DEPLOY — O INVERSO DA MIGRATION 75. Lá o código
   novo tinha de estar no ar primeiro; aqui é o contrário, e por um
   motivo mecânico: `upsertMetrics` passa a mandar `profile_visits` no
   corpo do upsert, e o PostgREST recusa a requisição inteira quando a
   coluna não existe. Com o deploy na frente, a sincronização da
   madrugada falha em TODAS as contas até alguém rodar isto.

   Rodar esta migration com o código ANTIGO no ar não quebra nada: a
   coluna fica nula, que é exatamente o que ela significa.

   ⚠️ NULO, E NÃO ZERO. É a diferença entre "esta campanha não teve
   visita" e "este dia foi sincronizado antes desta coluna existir".
   Todas as linhas já gravadas caem no segundo caso: com `default 0`,
   um relatório de período antigo imprimiria "0 visitas" com a mesma
   confiança de um número apurado — exatamente o defeito que esta
   migration conserta, só que ao contrário.

   Com nulo, o relatório imprime "—", que é verdade, e o número aparece
   assim que aquele intervalo for sincronizado de novo.

   O Google Ads grava nulo sempre: não existe visita ao perfil do
   Instagram lá, e zero afirmaria que houve zero.

   DEPOIS DO DEPLOY, PERÍODO ANTIGO CONTINUA "—" até ser sincronizado
   de novo: o dado só entra quando aquela janela é buscada na Meta
   outra vez. A sincronização de rotina cobre o mês corrente, então o
   relatório da próxima semana já sai com o número; para um mês
   fechado, é preciso pedir a sincronização daquele intervalo.
   ===================================================================== */

alter table public.daily_metrics
  add column if not exists profile_visits integer;

comment on column public.daily_metrics.profile_visits is
  'Visitas ao perfil do Instagram da campanha no dia, do campo instagram_profile_visits do Insights. NULO = não apurado (linha anterior à coluna, ou plataforma sem o conceito) — nunca confundir com zero.';
