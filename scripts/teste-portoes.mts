/* =====================================================================
   Teste de mesa dos portões do funil
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-portoes.mts

   POR QUE ESTE TESTE EXISTE. As mesmas seis regras vivem em dois
   lugares: aqui, em `src/lib/crm/portoes.ts`, e como `check` na
   migration 82. O banco é a rede; este arquivo é o que garante que a
   rede e a mensagem amigável concordem. Divergirem significa uma tela
   que diz "pode avançar" e um banco que recusa com um erro ilegível —
   que é o jeito mais rápido de a equipe abandonar o CRM pela segunda
   vez.

   A tabela `ESPELHO` no fim transcreve os `check` da migration. Se
   alguém mudar uma regra só de um lado, uma das duas listas quebra.
   ===================================================================== */

import {
  oQueFalta,
  podeIrPara,
  acaoSugerida,
  type DealParaPortao,
} from "../src/lib/crm/portoes";
import type { DealStage } from "../src/types/database";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

/** Um lead recém-capturado: só a empresa foi digitada. */
const cru: DealParaPortao = {
  contact_name: null,
  contact_phone: null,
  contact_email: null,
  owner_id: null,
  service: null,
  monthly_fee_cents: 0,
  setup_fee_cents: 0,
  expected_close_date: null,
  next_action: null,
  next_action_at: null,
  lost_reason: null,
  origem: "prospeccao",
  referred_by: null,
};

const com = (p: Partial<DealParaPortao>): DealParaPortao => ({ ...cru, ...p });
const campos = (d: DealParaPortao, e: DealStage) =>
  oQueFalta(d, e).map((x) => x.campo);

/* --- o que justifica o módulo: entrar é de graça -------------------- */

ok("⚠️ criar não exige NADA além da empresa", campos(cru, "novo"), []);
ok("lead cru pode ficar em novo", podeIrPara(cru, "novo"), true);

/* --- perder também é de graça, menos o motivo ----------------------- */

ok(
  "⚠️ perder de um lead cru só pede o motivo",
  campos(cru, "perdido"),
  ["motivo"],
);
ok(
  "com motivo, perde de qualquer lugar",
  campos(com({ lost_reason: "sem_retorno" }), "perdido"),
  [],
);

/* --- contato --------------------------------------------------------- */

ok(
  "contato pede como falar e o próximo passo",
  campos(cru, "contato"),
  ["contato", "proxima_acao"],
);
ok(
  "só telefone já resolve o contato",
  campos(com({ contact_phone: "+5547999990000", next_action: "Ligar", next_action_at: "2026-10-02" }), "contato"),
  [],
);
ok(
  "só e-mail também resolve",
  campos(com({ contact_email: "dono@pizzaria.com", next_action: "Ligar", next_action_at: "2026-10-02" }), "contato"),
  [],
);

/* --- indicação: quem indicou é dado, não fofoca --------------------- */

ok(
  "⚠️ origem indicação exige o nome de quem indicou",
  campos(com({ origem: "indicacao", contact_phone: "+5547999990000", next_action: "Ligar", next_action_at: "2026-10-02" }), "contato"),
  ["indicacao"],
);
ok(
  "prospecção não pede indicação",
  campos(com({ origem: "prospeccao", contact_phone: "+5547999990000", next_action: "Ligar", next_action_at: "2026-10-02" }), "contato"),
  [],
);
ok(
  "indicação em novo ainda não cobra",
  campos(com({ origem: "indicacao" }), "novo"),
  [],
);

/* --- as regras são CUMULATIVAS -------------------------------------- */

ok(
  "⚠️ proposta cobra tudo que veio antes",
  campos(cru, "proposta"),
  ["contato", "responsavel", "proposta", "proxima_acao"],
);
ok(
  "negociação cobra ainda a previsão",
  campos(cru, "negociacao"),
  ["contato", "responsavel", "proposta", "previsao", "proxima_acao"],
);
ok(
  "ganho cobra tudo menos o próximo passo",
  campos(cru, "ganho"),
  ["contato", "responsavel", "proposta", "previsao"],
);

/* --- reunião --------------------------------------------------------- */

const pertoDaReuniao = com({
  contact_phone: "+5547999990000",
  next_action: "Reunir",
  next_action_at: "2026-10-02",
});
ok(
  "reunião pede dono E nome de quem fala",
  campos(pertoDaReuniao, "reuniao"),
  ["responsavel"],
);
ok(
  "só o dono não basta",
  campos({ ...pertoDaReuniao, owner_id: "uuid-do-henrique" }, "reuniao"),
  ["responsavel"],
);
ok(
  "dono + contato libera",
  campos({ ...pertoDaReuniao, owner_id: "uuid-do-henrique", contact_name: "Dona Léo" }, "reuniao"),
  [],
);

/* --- proposta: serviço E valor -------------------------------------- */

const pertoDaProposta = com({
  contact_phone: "+5547999990000",
  contact_name: "Dona Léo",
  owner_id: "uuid-do-henrique",
  next_action: "Cobrar",
  next_action_at: "2026-10-05",
});
ok(
  "valor sem serviço não passa",
  campos({ ...pertoDaProposta, monthly_fee_cents: 200_000 }, "proposta"),
  ["proposta"],
);
ok(
  "serviço sem valor não passa",
  campos({ ...pertoDaProposta, service: "trafego" }, "proposta"),
  ["proposta"],
);
ok(
  "setup sozinho conta como valor",
  campos({ ...pertoDaProposta, service: "site", setup_fee_cents: 350_000 }, "proposta"),
  [],
);

/* --- próxima ação é PAR --------------------------------------------- */

ok(
  "⚠️ ação sem data não conta",
  campos(com({ contact_phone: "+5547999990000", next_action: "Ligar" }), "contato"),
  ["proxima_acao"],
);
ok(
  "data sem ação também não",
  campos(com({ contact_phone: "+5547999990000", next_action_at: "2026-10-02" }), "contato"),
  ["proxima_acao"],
);
ok(
  "ganho não pede próximo passo",
  campos(
    com({
      contact_phone: "+5547999990000",
      contact_name: "Dona Léo",
      owner_id: "uuid",
      service: "trafego",
      monthly_fee_cents: 200_000,
      expected_close_date: "2026-10-10",
    }),
    "ganho",
  ),
  [],
);

/* --- a exigência vem com texto, não só com o nome do campo ---------- */

const faltando = oQueFalta(cru, "proposta");
ok("cada exigência traz pergunta", faltando.every((f) => f.pergunta.length > 0), true);
ok("cada exigência traz o porquê", faltando.every((f) => f.porque.length > 0), true);

/* --- sugestão de próxima ação --------------------------------------- */

ok("contato sugere retomar", acaoSugerida("contato")?.texto, "Retomar conversa");
ok("ganho não sugere nada", acaoSugerida("ganho"), null);
ok("novo não sugere nada", acaoSugerida("novo"), null);
ok(
  "⚠️ toda etapa que exige próxima ação tem sugestão",
  (["contato", "reuniao", "proposta", "negociacao"] as DealStage[]).every(
    (e) => acaoSugerida(e) !== null,
  ),
  true,
);

/* =====================================================================
   ESPELHO DA MIGRATION 82
   ---------------------------------------------------------------------
   Transcrição dos `check` do banco. Cada entrada diz: nesta etapa, com
   este negócio, o banco aceita? A resposta tem que bater com a daqui.
   ===================================================================== */

const ESPELHO: {
  nome: string;
  deal: DealParaPortao;
  etapa: DealStage;
  bancoAceita: boolean;
}[] = [
  // crm_deals_portao_contato
  { nome: "check contato: sem forma de falar em 'contato'", deal: com({ next_action: "x", next_action_at: "2026-10-01" }), etapa: "contato", bancoAceita: false },
  // crm_deals_portao_reuniao
  { nome: "check reuniao: sem owner em 'reuniao'", deal: com({ contact_phone: "+55", contact_name: "A", next_action: "x", next_action_at: "2026-10-01" }), etapa: "reuniao", bancoAceita: false },
  // crm_deals_portao_proposta
  { nome: "check proposta: sem valor em 'proposta'", deal: com({ contact_phone: "+55", contact_name: "A", owner_id: "u", service: "trafego", next_action: "x", next_action_at: "2026-10-01" }), etapa: "proposta", bancoAceita: false },
  // crm_deals_portao_negociacao
  { nome: "check negociacao: sem previsão em 'negociacao'", deal: com({ contact_phone: "+55", contact_name: "A", owner_id: "u", service: "trafego", monthly_fee_cents: 1, next_action: "x", next_action_at: "2026-10-01" }), etapa: "negociacao", bancoAceita: false },
  // crm_deals_portao_proxima_acao
  { nome: "check proxima_acao: aberto sem data", deal: com({ contact_phone: "+55" }), etapa: "contato", bancoAceita: false },
  // crm_deals_portao_perdido
  { nome: "check perdido: sem motivo", deal: cru, etapa: "perdido", bancoAceita: false },
  // crm_deals_portao_indicacao
  { nome: "check indicacao: indicação sem quem indicou", deal: com({ origem: "indicacao", contact_phone: "+55", next_action: "x", next_action_at: "2026-10-01" }), etapa: "contato", bancoAceita: false },
  // os que o banco aceita
  { nome: "check: novo aceita lead cru", deal: cru, etapa: "novo", bancoAceita: true },
  { nome: "check: perdido com motivo", deal: com({ lost_reason: "preco" }), etapa: "perdido", bancoAceita: true },
];

for (const caso of ESPELHO) {
  ok(caso.nome, podeIrPara(caso.deal, caso.etapa), caso.bancoAceita);
}

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
