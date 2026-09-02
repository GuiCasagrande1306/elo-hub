/* =====================================================================
   Os números de volta na legenda do WhatsApp
   ---------------------------------------------------------------------
   A migration 73 criou `report_message_settings` com um texto de
   fábrica que só anunciava o anexo:

       Olá! Aqui está o nosso relatório de performance {periodo}.

       Qualquer dúvida, é só chamar por aqui.

   Ele nasceu assim em 27/08/2026 porque a legenda ANTIGA recalculava
   investimento, custo e retorno por conta própria e discordava do PDF
   em oito de 54 contas — Satö com 8,11x no texto e 12,35x no arquivo.
   Tirar os números fechou a divergência tirando um lado dela.

   AGORA ELES VOLTAM, e o que mudou não é a decisão: é que a legenda
   deixou de calcular. O marcador novo `{numeros}` é preenchido a partir
   de `payload.kpis` — os mesmos objetos que o react-pdf imprime nos
   cartões da capa —, com os rótulos da conta e com o selo "(de 1
   campanha)" na mesma frase que o documento usa. Ver o cabeçalho de
   `src/lib/reports/mensagem-do-cliente.ts`.

   O CÓDIGO SOZINHO NÃO MUDA NADA, e é por isso que esta migration
   existe. `MENSAGEM_PADRAO` é só o valor de fábrica; quem manda é a
   linha desta tabela, e ela continuaria com o texto sem `{numeros}`
   depois do deploy. O sintoma seria silencioso e caro: envio normal,
   sem erro, sem número — exatamente o que se está corrigindo.

   ⚠️⚠️ RODE DEPOIS DO DEPLOY, NUNCA ANTES. O código em produção hoje
   não conhece `{numeros}`: `mensagemDoCliente` só substitui `{periodo}`
   e `{cliente}`, e o que ele não conhece ele deixa passar CRU. Rodando
   esta migration com a versão antiga no ar, o próximo relatório sai com
   a palavra "{numeros}" literal na mensagem do cliente, entre as chaves.
   Não há validação no caminho do envio que barre isso — a que existe
   está na tela de edição, e a migration não passa por ela.

   ⚠️ SÓ SOBRESCREVE O TEXTO DE FÁBRICA. O `where` compara com o padrão
   ANTIGO, palavra por palavra. Se alguém editou a mensagem pela tela, a
   escrita dessa pessoa fica de pé e nada acontece aqui — trocar a voz
   da agência por uma decisão de migration seria pior do que não ter
   números. Quem editou e quiser os números de volta clica em "Restaurar
   padrão" no diálogo, ou acrescenta `{numeros}` onde preferir.

   Idempotente pela mesma razão: rodando duas vezes, na segunda o
   `where` não casa mais.
   ===================================================================== */

update public.report_message_settings
   set template = 'Olá! Aqui está o nosso relatório de performance {periodo}.

{numeros}

O detalhamento completo está no PDF em anexo. Qualquer dúvida, é só chamar por aqui.',
       updated_at = now()
 where id = true
   and template = 'Olá! Aqui está o nosso relatório de performance {periodo}.

Qualquer dúvida, é só chamar por aqui.';
