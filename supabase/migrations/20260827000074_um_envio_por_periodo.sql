/* =====================================================================
   Um envio por período, de cada vez
   ---------------------------------------------------------------------
   A reserva atômica em `enviarRelatorio` condiciona o UPDATE ao `id`:
   ela serializa dois cliques na MESMA linha, e só. A proteção contra
   duplicar o PERÍODO é um SELECT seguido de decisão na aplicação — sem
   lock, sem atomicidade.

   E linhas irmãs do mesmo período existem por desenho: quando um envio
   falha, a tentativa seguinte feita pela estação de comando INSERE uma
   linha nova em vez de reaproveitar a que falhou. Então o mesmo
   (cliente, janela) pode ter uma 'failed' e uma 'ready' na fila ao
   mesmo tempo.

   O CENÁRIO: Ana clica Enviar na linha 'ready'; Bruno clica na 'failed'
   dois segundos depois. As duas consultas de irmãs rodam antes de
   qualquer uma virar 'sent' e as duas voltam vazias; as duas reservas
   casam, porque são ids diferentes. Dois PDFs do mesmo período caem no
   grupo do cliente, com snapshots de datas diferentes.

   ESTE ÍNDICE FECHA A JANELA. Com no máximo uma linha em 'sending' por
   (cliente, período), a segunda reserva viola a restrição e o PostgREST
   devolve 23505 — que `enviarRelatorio` já trata como reserva recusada,
   porque a guarda de lá é `erroReserva || reservadas !== 1`.

   ⚠️ SÓ 'sending', E NÃO 'sent'. Incluir 'sent' pareceria mais forte,
   mas transformaria "já entreguei este período" em erro de banco na
   hora do UPDATE final — depois de a mensagem já ter saído. A recusa
   por período já entregue acontece antes, em código, com frase legível.
   Aqui o índice cobre só o instante da corrida.

   ⚠️ NÃO É ÍNDICE DE UNICIDADE DE RELATÓRIO. Nada impede duas linhas
   'ready' do mesmo período — isso é normal e é o estado que a fila
   mostra. O que ele impede é as duas estarem SAINDO ao mesmo tempo.
   ===================================================================== */

create unique index if not exists report_history_um_envio_por_periodo
  on public.report_history (client_id, period_start, period_end)
  where status = 'sending';

comment on index public.report_history_um_envio_por_periodo is
  'Uma linha em sending por cliente+período. Serializa a corrida entre linhas irmãs; a recusa por período já entregue é feita em código, antes.';
