/* =====================================================================
   Conversa iniciada, por campanha
   ---------------------------------------------------------------------
   A migration 76 consertou METADE deste problema e a outra metade está
   escrita lá, sem ter sido resolvida: na mesma medição da Meu Case
   aparecia "02 | ENGAJAMENTO WHATSAPP, REPLIES" ao lado da campanha de
   perfil. A 76 deu coluna própria à visita; a conversa continuou caindo
   na conversão da CONTA.

   Medido no Atman Cozinha, setembro/2026 — `local_business`, cuja
   conversão de conta é visita ao perfil:

     01 | ENGAJAMENTO | INSTAGRAM   PROFILE_AND_PAGE_ENGAGEMENT
                                    1.215 visitas  ✔ já certo pela 76
     02 | RECONHECIMENTO | 22.08    IMPRESSIONS
                                    67.976 impressões  ✔ já certo
     01 | ENGAJAMENTO WHATSAPP      REPLIES
                                    R$ 285,32 e "409 visitas ao perfil"  ✘

   As 409 não são conversas: são as visitas ao perfil daquela campanha,
   porque `conversions` guarda o tipo escolhido para a conta. O cliente
   lê, na linha de uma campanha de WhatsApp, o resultado de outra
   pergunta — e o número é plausível, que é o que o torna perigoso.

   O DADO JÁ CHEGA E É JOGADO FORA, igual ao caso da 76.
   `onsite_conversion.messaging_conversation_started_7d` vem dentro de
   `actions`, no mesmo Insights que o sync já pede; `toNormalizedRow`
   colapsa `actions` em `conversions` usando os tipos da conta e
   descarta o resto. Quem não é `leads` busca a conversa e a despreza.

   ⚠️⚠️ RODE ANTES DO DEPLOY, pelo mesmo motivo mecânico da 76:
   `upsertMetrics` passa a mandar `conversations` no corpo do upsert, e
   o PostgREST recusa a requisição INTEIRA quando a coluna não existe.
   Com o deploy na frente, a sincronização da madrugada falha em todas
   as contas até alguém rodar isto.

   Rodar esta migration com o código antigo no ar não quebra nada: a
   coluna fica nula, que é exatamente o que ela significa.

   ⚠️ NULO, E NÃO ZERO — a mesma regra da 76. Nulo é "este dia foi
   sincronizado antes da coluna existir"; zero é "esta campanha não teve
   conversa". Todas as linhas já gravadas caem no primeiro caso, e com
   `default 0` um relatório de setembro imprimiria "0 conversas" com
   cara de número apurado. Com nulo o relatório imprime "—", que é
   verdade, e o número aparece quando aquele intervalo for sincronizado
   de novo — `scripts/backfill-historico.mts` faz isso por mês.

   ⚠️ UMA COLUNA, NÃO TRÊS. A Meta devolve três eventos de mensageria
   que se CONTÊM — medido em `conversion-action.ts`: 129
   `total_messaging_connection` ⊃ 122 `messaging_conversation_started_7d`
   ⊃ 117 `messaging_first_reply`. Guardar os três convidaria alguém a
   somá-los e publicar 368 conversas onde houve 122. Guardamos o do
   meio, que é o que a Meta chama de resultado numa campanha de
   mensagem e o mesmo que `POR_SEGMENTO` já usa para captação.
   ===================================================================== */

alter table public.daily_metrics
  add column if not exists conversations integer;

comment on column public.daily_metrics.conversations is
  'Conversas iniciadas (onsite_conversion.messaging_conversation_started_7d) da campanha no dia. NULO = linha sincronizada antes desta coluna existir, não zero conversas. Ver a migration 91.';
