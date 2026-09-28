/* =====================================================================
   Teste de mesa da regra de pedido pago
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-status-pago.mts

   Esta regra decide o FATURAMENTO que a agência apresenta ao cliente.
   Errar para mais é pior que errar para menos: um cancelado contado
   como venda infla o resultado que a Elo mostra como seu, e ninguém
   confere um número que agrada.

   A regra foi validada contra a realidade, não só combinada: setembro
   de 2026 do Atacado de Pratas deu 150 pedidos e R$ 88.367,99 tanto no
   nosso cálculo quanto no gráfico "Faturamento confirmados por mês" do
   painel da Magazord.
   ===================================================================== */

import {
  STATUS_DA_LOJA,
  pedidoEstaPago,
  ticketMedio,
} from "../src/lib/loja/status-pago";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

/* --- os nove status reais da loja ----------------------------------- */

const FORA = [1, 4];
for (const [idTexto, descricao] of Object.entries(STATUS_DA_LOJA)) {
  const id = Number(idTexto);
  const esperado = !FORA.includes(id);
  ok(
    `${id} ${descricao} → ${esperado ? "PAGO" : "fora"}`,
    pedidoEstaPago({ id, descricao }),
    esperado,
  );
}

/* --- a contagem que bateu com o painel ------------------------------ */
/* Setembro/2026: 187 pedidos, 31 cancelados e 6 em análise fora,
   150 pagos. */

const setembro = [
  ...Array(103).fill({ id: 9, descricao: "Entregue" }),
  ...Array(31).fill({ id: 4, descricao: "Cancelado" }),
  ...Array(30).fill({ id: 3, descricao: "Concluído/Enviado" }),
  ...Array(8).fill({ id: 6, descricao: "Faturado" }),
  ...Array(6).fill({ id: 1, descricao: "Em Análise" }),
  ...Array(4).fill({ id: 8, descricao: "Em Entrega" }),
  ...Array(2).fill({ id: 7, descricao: "Aguardando Retirada" }),
  ...Array(2).fill({ id: 5, descricao: "Em Preparação" }),
  ...Array(1).fill({ id: 2, descricao: "Confirmado" }),
];
ok("setembro tem 187 pedidos", setembro.length, 187);
ok(
  "e 150 deles são pagos — o número do painel",
  setembro.filter(pedidoEstaPago).length,
  150,
);

/* --- loja com numeração diferente ------------------------------------ */
/* ⚠️ Os ids são configuráveis por loja. A descrição é a rede de
   segurança: um "Cancelado" que chegue com id 12 não pode virar
   faturamento. */

ok("cancelado com id estranho continua fora", pedidoEstaPago({ id: 12, descricao: "Cancelado" }), false);
ok("em análise com id estranho continua fora", pedidoEstaPago({ id: 99, descricao: "Em Análise" }), false);
ok("sem acento também casa", pedidoEstaPago({ id: 99, descricao: "Em analise" }), false);
ok("caixa alta também casa", pedidoEstaPago({ id: 99, descricao: "CANCELADO" }), false);
ok("cancelado renomeado ainda casa", pedidoEstaPago({ id: 99, descricao: "Cancelado pelo cliente" }), false);

/* Mas um status legítimo com id fora da tabela CONTA — a loja pode ter
   criado "Retirado na loja", e recusá-lo subestimaria o faturamento. */
ok("status novo e legítimo conta", pedidoEstaPago({ id: 15, descricao: "Retirado na loja" }), true);

/* --- na dúvida, não conta -------------------------------------------- */

ok("status ausente não conta", pedidoEstaPago(null), false);
ok("status vazio não conta", pedidoEstaPago({}), false);
ok("undefined não conta", pedidoEstaPago(undefined), false);

/* --- ticket médio ----------------------------------------------------- */

ok("ticket de setembro", ticketMedio(8_836_799, 150), 58_912);
ok(
  "⚠️ sem pedido devolve null, não zero",
  ticketMedio(0, 0),
  null,
);
ok("pedido negativo não quebra", ticketMedio(1000, -3), null);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
