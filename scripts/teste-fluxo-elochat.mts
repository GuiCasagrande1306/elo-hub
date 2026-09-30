/* =====================================================================
   Teste de mesa da validação de fluxo do EloChat
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-fluxo-elochat.mts

   ⚠️ A ASSERÇÃO QUE JUSTIFICA O ARQUIVO É A DO CICLO. Um fluxo que
   volta para um nó anterior manda a mesma pessoa em laço — mensagem,
   botão, mensagem, para sempre —, e do lado da Meta isso é
   indistinguível de spam. A conta do Geraldo foi restringida duas
   vezes em setembro por cadência de automação, com algo muito mais
   inocente. Um ciclo publicado não gera um bug, gera uma conta
   bloqueada.

   O caso difícil é o LOSANGO: dois botões que levam à mesma resposta
   revisitam um nó sem formar ciclo. Uma detecção ingênua ("já vi este
   nó") barraria esse desenho, que é legítimo e comum — e um validador
   que recusa fluxo bom é abandonado na segunda vez.
   ===================================================================== */

import {
  problemasDoFluxo,
  podePublicar,
  type ArestaDoFluxo,
  type NoDoFluxo,
} from "../src/lib/elochat/validacao";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    falhas++;
    console.log(`✗ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   real:     ${JSON.stringify(real)}`);
  } else console.log(`✓ ${nome}`);
};

const gatilho = (id: string): NoDoFluxo =>
  ({ id, data: { blockId: "comment", palavraChave: "quero" } });
const msg = (id: string, texto = "Oi!"): NoDoFluxo => ({ id, data: { blockId: "message", texto } });
const liga = (source: string, target: string): ArestaDoFluxo => ({ id: `${source}-${target}`, source, target });

const impedem = (n: NoDoFluxo[], a: ArestaDoFluxo[]) =>
  problemasDoFluxo(n, a).filter((p) => p.gravidade === "impede").map((p) => p.mensagem);
const avisos = (n: NoDoFluxo[], a: ArestaDoFluxo[]) =>
  problemasDoFluxo(n, a).filter((p) => p.gravidade === "avisa").length;

/* --- o fluxo mínimo que funciona ------------------------------------ */

const minimo = { n: [gatilho("g"), msg("m")], a: [liga("g", "m")] };
ok("gatilho + mensagem ligados: pode publicar", impedem(minimo.n, minimo.a), []);
ok("e sem avisos", avisos(minimo.n, minimo.a), 0);
ok("podePublicar concorda", podePublicar(problemasDoFluxo(minimo.n, minimo.a)), true);

/* --- vazio e sem gatilho -------------------------------------------- */

ok("fluxo vazio é impedido", impedem([], []), ["O fluxo está vazio."]);
ok(
  "só mensagem, sem gatilho",
  impedem([msg("m")], []),
  ["Falta um gatilho: nada faria o fluxo começar."],
);
ok(
  "gatilho solto não publica",
  impedem([gatilho("g")], []),
  ["Este gatilho não leva a lugar nenhum."],
);

/* --- ⚠️ CICLO -------------------------------------------------------- */

const ciclo = {
  n: [gatilho("g"), msg("a"), msg("b")],
  a: [liga("g", "a"), liga("a", "b"), liga("b", "a")],
};
ok(
  "⚠️ ciclo a→b→a é IMPEDIDO",
  impedem(ciclo.n, ciclo.a).some((m) => m.includes("ciclo")),
  true,
);
ok("⚠️ e o fluxo não pode publicar", podePublicar(problemasDoFluxo(ciclo.n, ciclo.a)), false);

const autoCiclo = {
  n: [gatilho("g"), msg("a")],
  a: [liga("g", "a"), liga("a", "a")],
};
ok(
  "⚠️ nó que aponta para si mesmo é ciclo",
  impedem(autoCiclo.n, autoCiclo.a).some((m) => m.includes("ciclo")),
  true,
);

/* --- ⚠️ LOSANGO NÃO É CICLO ------------------------------------------ */

const losango = {
  n: [gatilho("g"), msg("a"), msg("b"), msg("fim")],
  a: [liga("g", "a"), liga("g", "b"), liga("a", "fim"), liga("b", "fim")],
};
ok(
  "⚠️ dois caminhos que se reencontram NÃO é ciclo",
  impedem(losango.n, losango.a),
  [],
);
ok("losango não gera aviso", avisos(losango.n, losango.a), 0);

/* --- conteúdo dos blocos --------------------------------------------- */

ok(
  "mensagem sem texto é impedida",
  impedem([gatilho("g"), msg("m", "")], [liga("g", "m")]),
  ["Mensagem sem texto: nada seria enviado."],
);
ok(
  "texto só com espaço também",
  impedem([gatilho("g"), msg("m", "   ")], [liga("g", "m")]),
  ["Mensagem sem texto: nada seria enviado."],
);

const comBotoes = (botoes: { id: string; label: string }[]): NoDoFluxo => ({
  id: "b",
  data: { blockId: "buttons", texto: "Escolhe:", botoes },
});
ok(
  "botões vazios impedem",
  impedem([gatilho("g"), comBotoes([])], [liga("g", "b")]),
  ["Mensagem com botões, mas sem nenhum botão."],
);
ok(
  "botão sem rótulo impede",
  impedem([gatilho("g"), comBotoes([{ id: "1", label: " " }])], [liga("g", "b")]),
  ["Há botão sem rótulo."],
);
ok(
  "botão com rótulo passa",
  impedem([gatilho("g"), comBotoes([{ id: "1", label: "Quero" }])], [liga("g", "b")]),
  [],
);

const carrossel = (cartoes: { id: string; titulo: string; botao: string }[]): NoDoFluxo => ({
  id: "c",
  data: { blockId: "carousel", texto: "Veja:", cartoes },
});
ok(
  "carrossel sem cartão impede",
  impedem([gatilho("g"), carrossel([])], [liga("g", "c")]),
  ["Carrossel sem nenhum cartão."],
);
ok(
  "cartão sem botão impede",
  impedem([gatilho("g"), carrossel([{ id: "1", titulo: "X", botao: "" }])], [liga("g", "c")]),
  ["Há cartão sem título ou sem rótulo de botão."],
);

/* --- ⚠️ gatilho sem palavra ------------------------------------------ */

ok(
  "⚠️ gatilho sem palavra é impedido: nunca dispararia",
  impedem(
    [{ id: "g", data: { blockId: "comment", palavraChave: "" } }, msg("m")],
    [liga("g", "m")],
  ),
  ["Este gatilho não tem palavra: ele nunca dispararia."],
);
ok(
  "resposta a story não precisa de palavra",
  impedem(
    [{ id: "g", data: { blockId: "story-reply" } }, msg("m")],
    [liga("g", "m")],
  ),
  [],
);

/* --- avisos que NÃO impedem ------------------------------------------ */

const doisGatilhos = {
  n: [gatilho("g1"), { id: "g2", data: { blockId: "keyword", palavraChave: "cupom" } } as NoDoFluxo, msg("m")],
  a: [liga("g1", "m"), liga("g2", "m")],
};
ok("dois gatilhos não impedem", impedem(doisGatilhos.n, doisGatilhos.a), []);
ok("mas avisam", avisos(doisGatilhos.n, doisGatilhos.a), 1);

const solto = {
  n: [gatilho("g"), msg("m"), msg("orfao")],
  a: [liga("g", "m")],
};
ok("bloco solto não impede", impedem(solto.n, solto.a), []);
ok("⚠️ mas avisa que nunca executaria", avisos(solto.n, solto.a), 1);
ok("e ainda pode publicar", podePublicar(problemasDoFluxo(solto.n, solto.a)), true);

/* --- ordem: o que impede vem antes do que avisa ---------------------- */

const misto = {
  n: [gatilho("g"), msg("m", ""), msg("orfao")],
  a: [liga("g", "m")],
};
ok(
  "impedimentos vêm primeiro",
  problemasDoFluxo(misto.n, misto.a)[0].gravidade,
  "impede",
);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
