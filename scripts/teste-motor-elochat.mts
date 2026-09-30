/* =====================================================================
   Teste de mesa do motor do EloChat
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-motor-elochat.mts

   O motor decide o que uma conta de Instagram de cliente vai responder
   a um estranho, sozinha. Duas classes de erro aqui não são bug, são
   incidente:

     RESPONDER QUEM NÃO PEDIU — gatilho casando onde não devia. O caso
     que mais assusta é "não quero": com `includes` cru, o gatilho
     "quero" dispara numa recusa explícita e manda o cupom para quem
     acabou de dizer não.

     RESPONDER DEMAIS — mais de uma mensagem por evento. É o padrão que
     a Meta lê como automação, e foi o que restringiu a conta do
     Geraldo duas vezes em setembro.

   As duas têm asserção marcada com ⚠️ abaixo.
   ===================================================================== */

import {
  casaPalavra,
  decidir,
  gatilhoQueCasa,
  type EventoDoInstagram,
} from "../src/lib/elochat/motor";
import type { ArestaDoFluxo, NoDoFluxo } from "../src/lib/elochat/validacao";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

/* --- casamento de palavra -------------------------------------------- */

ok("casa palavra simples", casaPalavra("quero", "quero"), true);
ok("ignora maiúscula", casaPalavra("QUERO", "quero"), true);
ok("ignora acento", casaPalavra("Não", "nao"), true);
ok("ignora acento no outro sentido", casaPalavra("nao", "não"), true);
ok("ignora pontuação", casaPalavra("Quero!!!", "quero"), true);
ok("casa no meio da frase", casaPalavra("eu quero sim", "quero"), true);
ok("casa expressão de duas palavras", casaPalavra("me manda o cupom hoje", "o cupom"), true);

ok(
  "⚠️ NÃO casa pedaço de palavra: querosene",
  casaPalavra("comprei querosene", "quero"),
  false,
);
/* ⚠️ O GRUPO QUE MAIS IMPORTA. Mandar o cupom para quem recusou é
   visível para o cliente final e parece desrespeito, não defeito. */
ok("⚠️ 'não quero' NÃO dispara", casaPalavra("não quero", "quero"), false);
ok("⚠️ 'nao quero' sem acento também não", casaPalavra("nao quero", "quero"), false);
ok("'nem quero' não dispara", casaPalavra("nem quero", "quero"), false);
ok("'nunca quero isso' não dispara", casaPalavra("nunca quero isso", "quero"), false);
ok(
  "⚠️ mas negação LONGE não cancela: 'nao sei se quero, mas quero'",
  casaPalavra("nao sei se quero, mas quero", "quero"),
  true,
);
ok(
  "negação antes de OUTRA palavra não cancela",
  casaPalavra("não gostei mas quero", "quero"),
  true,
);
ok("palavra vazia nunca casa", casaPalavra("quero", ""), false);
ok("palavra indefinida nunca casa", casaPalavra("quero", undefined), false);
ok("texto vazio nunca casa", casaPalavra("", "quero"), false);
ok("texto sem a palavra", casaPalavra("oi tudo bem", "quero"), false);

/* --- achar o gatilho -------------------------------------------------- */

const gComentario: NoDoFluxo = {
  id: "g1",
  data: { blockId: "comment", palavraChave: "quero" },
};
const gDirect: NoDoFluxo = {
  id: "g2",
  data: { blockId: "keyword", palavraChave: "cupom" },
};
const gStory: NoDoFluxo = { id: "g3", data: { blockId: "story-reply" } };

const ev = (p: Partial<EventoDoInstagram>): EventoDoInstagram => ({
  tipo: "comentario",
  contato: "igsid-1",
  texto: "",
  ...p,
});

ok(
  "comentário com a palavra acha o gatilho",
  gatilhoQueCasa([gComentario], ev({ texto: "quero!" }))?.id,
  "g1",
);
ok(
  "⚠️ comentário SEM a palavra não dispara nada",
  gatilhoQueCasa([gComentario], ev({ texto: "que legal" })),
  null,
);
ok(
  "⚠️ gatilho de direct NÃO responde a comentário",
  gatilhoQueCasa([gDirect], ev({ tipo: "comentario", texto: "cupom" })),
  null,
);
ok(
  "gatilho de direct responde a direct",
  gatilhoQueCasa([gDirect], ev({ tipo: "direct", texto: "manda o cupom" }))?.id,
  "g2",
);
ok(
  "resposta a story não precisa de palavra",
  gatilhoQueCasa([gStory], ev({ tipo: "resposta-story", texto: "" }))?.id,
  "g3",
);
ok(
  "⚠️ gatilho sem palavra configurada não responde a ninguém",
  gatilhoQueCasa([{ id: "vazio", data: { blockId: "comment", palavraChave: "" } }], ev({ texto: "oi" })),
  null,
);

/* --- o passo ---------------------------------------------------------- */

const msg = (id: string, texto: string): NoDoFluxo => ({ id, data: { blockId: "message", texto } });
const botoes = (id: string, texto: string, bs: { id: string; label: string }[]): NoDoFluxo => ({
  id,
  data: { blockId: "buttons", texto, botoes: bs },
});
const liga = (source: string, target: string, sourceHandle?: string): ArestaDoFluxo =>
  ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) }) as ArestaDoFluxo;

const fluxo = {
  nos: [
    gComentario,
    botoes("b1", "Quer o cupom?", [
      { id: "sim", label: "Quero" },
      { id: "nao", label: "Agora não" },
    ]),
    msg("m-sim", "ELO15 no carrinho!"),
    msg("m-nao", "Tudo bem, fica pra próxima."),
  ],
  arestas: [liga("g1", "b1"), liga("b1", "m-sim", "sim"), liga("b1", "m-nao", "nao")],
};

const d1 = decidir(fluxo.nos, fluxo.arestas, ev({ texto: "quero" }), null);
ok("primeiro evento manda o bloco depois do gatilho", d1.acao === "enviar" && d1.mensagem.noId, "b1");
ok("e é do tipo botões", d1.acao === "enviar" && d1.mensagem.tipo, "botoes");
ok("com os dois botões", d1.acao === "enviar" && d1.mensagem.botoes.length, 2);
ok("marcando onde o contato parou", d1.acao === "enviar" && d1.novoNoAtual, "b1");

/* ⚠️ UM PASSO POR EVENTO. Se o motor percorresse a cascata, esta
   decisão já traria também "m-sim". */
ok(
  "⚠️ manda UM bloco por evento, não a cascata",
  d1.acao === "enviar" && "mensagem" in d1 && !Array.isArray(d1.mensagem),
  true,
);

const d2 = decidir(fluxo.nos, fluxo.arestas, ev({ tipo: "direct", texto: "", botao: "sim" }), "b1");
ok("toque no botão 'sim' segue a aresta certa", d2.acao === "enviar" && d2.mensagem.noId, "m-sim");

const d3 = decidir(fluxo.nos, fluxo.arestas, ev({ tipo: "direct", texto: "", botao: "nao" }), "b1");
ok("toque em 'agora não' segue a outra", d3.acao === "enviar" && d3.mensagem.noId, "m-nao");

const d4 = decidir(fluxo.nos, fluxo.arestas, ev({ tipo: "direct", texto: "", botao: "inexistente" }), "b1");
ok(
  "⚠️ botão sem aresta PARA, não cai na saída genérica",
  d4.acao,
  "nada",
);

const d5 = decidir(fluxo.nos, fluxo.arestas, ev({ tipo: "direct", texto: "", botao: "sim" }), "m-sim");
ok("fim do fluxo devolve nada", d5.acao, "nada");

/* --- atraso ------------------------------------------------------------ */

const comAtraso = {
  nos: [gComentario, { id: "esp", data: { blockId: "delay" } } as NoDoFluxo, msg("fim", "Oi!")],
  arestas: [liga("g1", "esp"), liga("esp", "fim")],
};
const d6 = decidir(comAtraso.nos, comAtraso.arestas, ev({ texto: "quero" }), null);
ok("atraso não é mensagem: atravessa até a próxima", d6.acao === "enviar" && d6.mensagem.noId, "fim");
ok("e soma o tempo de espera", d6.acao === "enviar" && d6.mensagem.esperarSegundos, 300);

/* --- o que não dispara -------------------------------------------------- */

ok(
  "evento que não casa gatilho nenhum",
  decidir(fluxo.nos, fluxo.arestas, ev({ texto: "oi" }), null).acao,
  "nada",
);
ok(
  "bloco sem texto não é enviado",
  decidir(
    [gComentario, msg("vazio", "  ")],
    [liga("g1", "vazio")],
    ev({ texto: "quero" }),
    null,
  ).acao,
  "nada",
);
ok(
  "bloco de lógica ainda não executa, e diz por quê",
  decidir(
    [gComentario, { id: "cond", data: { blockId: "condition" } } as NoDoFluxo],
    [liga("g1", "cond")],
    ev({ texto: "quero" }),
    null,
  ).acao,
  "nada",
);

/* ⚠️ Um fluxo em laço que escapou do validador não pode travar o
   webhook nem mandar infinitas mensagens. */
const laco = {
  nos: [gComentario, { id: "a", data: { blockId: "delay" } } as NoDoFluxo],
  arestas: [liga("g1", "a"), liga("a", "a")],
};
ok(
  "⚠️ laço de atrasos para no teto, não trava",
  decidir(laco.nos, laco.arestas, ev({ texto: "quero" }), null).acao,
  "nada",
);

/* --- nunca lança --------------------------------------------------------- */

let lancou = false;
try {
  decidir([], [], ev({ texto: "quero" }), "inexistente");
  decidir(fluxo.nos, [{ id: "x", source: "g1", target: "fantasma" }], ev({ texto: "quero" }), null);
} catch {
  lancou = true;
}
ok("⚠️ nunca lança — exceção no webhook faz a Meta reenviar", lancou, false);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
