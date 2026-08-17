/* =====================================================================
   Relatório travado deixa de bloquear a retentativa para sempre
   ---------------------------------------------------------------------
   O DEFEITO. `report_history_automated_unique` é único por
   (cliente, período) para toda linha automática — SEM olhar o status. A
   linha nasce em 'queued' antes de o PDF existir (orchestrator.ts:130),
   então basta a função ser cortada no meio para sobrar uma linha em
   'queued' ou 'generating' que nunca vira nada e que passa a recusar,
   pelo índice, qualquer nova tentativa daquele período.

   O cliente não recebe o relatório daquele mês. Nunca. E a única pista é
   uma linha com status parado numa tabela que ninguém abre — a tela lista
   'ready' e 'failed', então a linha travada não aparece em lugar nenhum.

   ISSO NÃO É HIPÓTESE. A auditoria do módulo mediu o caminho: o cron
   dividia o teto de 60s da função com a sincronização da carteira
   inteira, e a trava de orçamento dos relatórios só começava a contar
   quando a fase dela iniciava — autorizando seis relatórios num espaço
   que comportava um. Os que não terminavam ficavam exatamente assim.

   A CORREÇÃO É EM DOIS TEMPOS, e este arquivo é o primeiro:

   1. O índice passa a IGNORAR linhas em 'failed'. Uma tentativa que
      falhou fica registrada — é o que responde "por que o cliente não
      recebeu?" — mas deixa de trancar a porta.

   2. `dispatchScheduledReports` marca como 'failed' toda linha
      automática presa em 'queued'/'generating' há mais de 15 minutos,
      antes de começar a rodada. Sem esse passo o índice novo não ajuda:
      a linha continuaria em 'generating', que segue sendo um status que
      o índice enxerga.

   POR QUE NÃO APAGAR A LINHA TRAVADA. Seria mais simples e apaga a única
   evidência de que houve tentativa. Um relatório que não chegou é
   pergunta de cliente, e "não há registro" é a pior resposta possível.

   POR QUE 'failed' E NÃO UM STATUS NOVO. 'failed' já existe, a tela já
   sabe desenhá-lo e a fila já o lista. Um 'expired' exigiria tocar em
   todos esses lugares para dizer a mesma coisa: não foi entregue.
   ===================================================================== */

drop index if exists report_history_automated_unique;

create unique index if not exists report_history_automated_unique
  on public.report_history (client_id, period_start, period_end)
  where is_automated and status <> 'failed';

comment on index public.report_history_automated_unique is
  'Impede envio automático duplicado do mesmo período. IGNORA linhas failed: tentativa que falhou fica no histórico sem trancar a retentativa.';

/* ---------------------------------------------------------------------
   Limpeza do que já está preso

   A carteira ainda não tem envio automático ligado (medido: 0 clientes
   com report_enabled), então isto deve afetar ZERO linhas hoje. Fica
   assim mesmo, porque a migration precisa ser correta quando alguém
   rodar o repositório inteiro num banco que já operou.
   --------------------------------------------------------------------- */
update public.report_history
   set status = 'failed',
       error_message = coalesce(
         error_message,
         'Interrompido antes de terminar — a função foi cortada no meio da geração.'
       )
 where is_automated
   and status in ('queued', 'generating')
   and created_at < now() - interval '15 minutes';
