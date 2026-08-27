/* =====================================================================
   A marca do envio interrompido
   ---------------------------------------------------------------------
   Módulo de uma constante só, e ele existe por uma razão de fronteira:
   `relatorios/actions.ts` é `"use server"` e só pode exportar função
   assíncrona, e importar `schedule.ts` de lá arrastaria a maquinaria do
   cron para o pacote da página. A constante fica no meio, sem depender
   de nenhum dos dois.

   É CONTRATO entre quem escreve e quem lê. O cron marca com este
   prefixo a linha que ficou presa em 'sending' — ele PRECISA tirá-la
   daquele status, senão o índice parcial
   `report_history_automated_unique` bloqueia a geração daquele período
   para sempre. Mas 'failed' seco apagaria a ambiguidade: a função foi
   cortada entre gravar 'sending' e a resposta da Evolution, então a
   mensagem PODE ter saído.

   Com a marca, a fila reconhece a linha e continua oferecendo
   "Chegou / Não chegou" em vez de um "Enviar" que convidaria ao envio
   em dobro no grupo do cliente.
   ===================================================================== */

export const MARCA_INTERROMPIDO = "Interrompido durante o envio";
