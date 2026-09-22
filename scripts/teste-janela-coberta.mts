/* =====================================================================
   Teste de mesa da trava de janela incompleta
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-janela-coberta.mts

   Esta regra decide se um relatório PODE SAIR. Ela nasceu de um caso
   real: em 22/09/2026, 46 das 52 integrações Meta estavam com o token
   invalidado desde o dia 18, e a estação de comando continuava
   liberando o envio — a trava de então só reagia a zero linha, e havia
   linhas, só que velhas.

   Os dois erros que ela precisa evitar são opostos, e é por isso que os
   casos abaixo vêm em pares:

     • deixar sair um período somado pela metade sob o rótulo inteiro
     • barrar quem está certo — conta pausada no fim de semana não tem
       linha no sábado, e isso não é defeito
   ===================================================================== */

import { estadoDaJanela } from "../src/lib/reports/janela-coberta";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const HOJE = "2026-09-22";
const emDia = { comErro: false, ate: "2026-09-22" };
const comErro = { comErro: true, ate: "2026-09-22" };
const atrasada = { comErro: false, ate: "2026-09-18" };

/* --- o caso que originou a trava ------------------------------------ */

/* Dispare Visão Esportiva: dado até 18/09, relatório de 15–21/09,
   token morto desde o dia 18. Quatro dias sob o rótulo de sete. */
ok("Dispare: dado até 18, período até 21, coleta com erro → barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: comErro }),
   { incompleta: true, naoApurada: true });

/* --- o alarme falso que a trava NÃO pode dar ------------------------ */

/* Conta pausada no domingo: dado até sábado, coleta rodou depois do
   fim do período. O buraco é do anúncio, não da coleta. */
ok("conta pausada no domingo, coleta em dia → avisa, não barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-20", semDado: false, sincronizacao: emDia }),
   { incompleta: true, naoApurada: false });

/* --- janela coberta -------------------------------------------------- */

ok("dado até o último dia do período → nada",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-21", semDado: false, sincronizacao: emDia }),
   { incompleta: false, naoApurada: false });

ok("dado além do fim (janela antiga) → nada",
   estadoDaJanela({ fim: "2026-09-14", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: emDia }),
   { incompleta: false, naoApurada: false });

/* --- janela que alcança hoje ----------------------------------------- */

/* O dia de hoje ainda está entrando: dado até ONTEM é cobertura
   completa, e travar aqui impediria a conferência do mês corrente. */
ok("período até hoje, dado até ontem → nada",
   estadoDaJanela({ fim: HOJE, hoje: HOJE, ultimoDiaComDado: "2026-09-21", semDado: false, sincronizacao: { comErro: false, ate: HOJE } }),
   { incompleta: false, naoApurada: false });

/* ⚠️ O BURACO DA PRIMEIRA VERSÃO desta regra, pego na tela em
   22/09/2026: ela dispensava a janela INTEIRA quando o período
   terminava hoje. Um mês corrente com a coleta parada havia cinco dias
   passava calado — e é o caso mais comum, porque a estação abre
   justamente na janela da meta, que termina hoje. A desculpa vale para
   hoje, não para os dias fechados atrás dele. */
ok("período até hoje, dado parou há 5 dias → acusa e barra",
   estadoDaJanela({ fim: HOJE, hoje: HOJE, ultimoDiaComDado: "2026-09-17", semDado: false, sincronizacao: atrasada }),
   { incompleta: true, naoApurada: true });

ok("período até hoje, dado parou há 5 dias, mas coleta em dia → só avisa",
   estadoDaJanela({ fim: HOJE, hoje: HOJE, ultimoDiaComDado: "2026-09-17", semDado: false, sincronizacao: emDia }),
   { incompleta: true, naoApurada: false });

ok("período que vai além de hoje segue a mesma régua de ontem",
   estadoDaJanela({ fim: "2026-09-30", hoje: HOJE, ultimoDiaComDado: "2026-09-21", semDado: false, sincronizacao: { comErro: false, ate: HOJE } }),
   { incompleta: false, naoApurada: false });

ok("fim vazio (tela ainda montando) → nunca acusa",
   estadoDaJanela({ fim: "", hoje: HOJE, ultimoDiaComDado: null, semDado: false, sincronizacao: comErro }),
   { incompleta: false, naoApurada: false });

/* --- zero linha continua com a trava antiga -------------------------- */

/* `semDado` já barra e já tem a sua própria mensagem, que explica a
   diferença entre "não gastou" e "não sincronizou". Acusar as duas
   coisas ao mesmo tempo empilharia dois avisos dizendo o mesmo. */
ok("zero linha no período → esta regra se cala",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: null, semDado: true, sincronizacao: comErro }),
   { incompleta: false, naoApurada: false });

/* --- as três formas de a coleta confessar ---------------------------- */

ok("erro gravado na integração → barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: comErro }),
   { incompleta: true, naoApurada: true });

/* A última rodada bem-sucedida terminou ANTES do fim do período: ela não
   teve como cobrir os últimos dias, mesmo sem erro registrado agora. */
ok("última sincronização anterior ao fim do período → barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: atrasada }),
   { incompleta: true, naoApurada: true });

/* Empate conta como atraso: uma rodada que rodou NO dia 21 pegou o dia
   21 pela metade — é o mesmo defeito, em escala menor. */
ok("sincronização no mesmo dia do fim → barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: { comErro: false, ate: "2026-09-21" } }),
   { incompleta: true, naoApurada: true });

ok("nenhuma sincronização completou → barra",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: "2026-09-18", semDado: false, sincronizacao: { comErro: false, ate: null } }),
   { incompleta: true, naoApurada: true });

/* --- conta nova, sem integração nenhuma ------------------------------ */

ok("sem dado e sem coleta → a trava antiga responde, esta não",
   estadoDaJanela({ fim: "2026-09-21", hoje: HOJE, ultimoDiaComDado: null, semDado: true, sincronizacao: { comErro: false, ate: null } }),
   { incompleta: false, naoApurada: false });

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
