/* =====================================================================
   Teste de mesa da grade de pauta
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/teste-pauta.mts

   O projeto não tem suíte de testes, e este arquivo não pretende criar
   uma. Ele existe porque `src/lib/social/pauta.ts` concentra duas contas
   que quebram em silêncio — a matemática de semana e a esteira de
   produção derivada — e as duas foram corrigidas depois de uma revisão
   que achou erro real em ambas. Sem estas asserções, a próxima mudança
   reintroduz o mesmo defeito sem nada acusar: o TypeScript passa, o lint
   passa, e a tela mostra um número errado que ninguém confere.

   Casos aqui são os que JÁ FALHARAM alguma vez, não hipóteses:
     - a semana que cruza o ano (o rótulo carimbava um ano só)
     - peça publicada numa rede e falhada em outra (voltava para a fila)
     - peça arquivada (voltava como "a produzir")
     - peça de cliente que não tem linha na grade (entrava no contador)
   ===================================================================== */

import {
  semanaDe,
  deslocarSemana,
  rotuloDaSemana,
  producaoDoPost,
  resumirSemana,
} from "../src/lib/social/pauta";

let falhas = 0;
const ok = (nome: string, real: unknown, esperado: unknown) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) falhas++;
  console.log(`${bate ? "ok  " : "FALHA"} ${nome}`);
  if (!bate) {
    console.log(`        esperado ${JSON.stringify(esperado)}`);
    console.log(`        veio     ${JSON.stringify(real)}`);
  }
};

/* --- semana: as viradas --- */
ok("virada de ano", semanaDe("2026-12-31"), [
  "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30",
  "2026-12-31", "2027-01-01", "2027-01-02",
]);
ok("bissexto 2024", semanaDe("2024-02-29").includes("2024-02-29"), true);
ok("1o de marco nao-bissexto", semanaDe("2026-03-01")[0], "2026-03-01");
ok("deslocar cruza o ano", deslocarSemana("2026-12-28", 1), "2027-01-04");
ok("deslocar para tras cruza o ano", deslocarSemana("2027-01-04", -1), "2026-12-28");
ok("28 deslocamentos = 28 semanas", deslocarSemana("2026-01-01", 28), "2026-07-16");

/* --- rótulo --- */
ok("mesmo mes", rotuloDaSemana(semanaDe("2026-08-25")), "23 a 29 de agosto");
ok("cruza o mes", rotuloDaSemana(semanaDe("2026-08-31")), "30 de agosto a 5 de setembro");
ok(
  "cruza o ANO mostra os dois",
  rotuloDaSemana(semanaDe("2026-12-31")),
  "27 de dezembro de 2026 a 2 de janeiro de 2027",
);
ok("outro ano, sem virada", rotuloDaSemana(semanaDe("2027-05-12")), "9 a 15 de maio de 2027");

/* --- esteira de produção --- */
/* eslint-disable @typescript-eslint/no-explicit-any */
const peca = (over: any = {}) => ({
  status: "rascunho",
  scheduled_at: "2026-08-26T12:00:00-03:00",
  targets: [],
  media_urls: [],
  ...over,
});
const alvo = (s: string) => ({ status: s }) as any;

ok("rascunho sem arte", producaoDoPost(peca() as any), "a_produzir");
ok("rascunho com arte", producaoDoPost(peca({ media_urls: ["x/y/a.jpg"] }) as any), "arte_pronta");
ok("em aprovacao sem arte ainda conta como feita", producaoDoPost(peca({ status: "em_aprovacao" }) as any), "arte_pronta");
ok("aprovada", producaoDoPost(peca({ status: "aprovado" }) as any), "aprovada");
ok("arquivada nao volta pra bancada", producaoDoPost(peca({ status: "arquivado" }) as any), "arquivada");
ok("publicada em tudo", producaoDoPost(peca({ status: "aprovado", targets: [alvo("publicado")] }) as any), "no_ar");
ok(
  "publicada numa e FALHOU noutra continua no ar",
  producaoDoPost(peca({ status: "aprovado", targets: [alvo("publicado"), alvo("falhou")] }) as any),
  "no_ar",
);
ok(
  "falhou em todas volta pra fila de publicar",
  producaoDoPost(peca({ status: "aprovado", targets: [alvo("falhou")] }) as any),
  "aprovada",
);

/* --- resumo da semana --- */
const dias = semanaDe("2026-08-26");
const p = (id: string, client: string, over: any = {}) =>
  ({ id, client_id: client, ...peca(over) }) as any;

const r = resumirSemana(
  [
    p("1", "A"),
    p("2", "A", { media_urls: ["x/y/a.jpg"] }),
    p("3", "B", { status: "arquivado" }),
    p("4", "FANTASMA"),
  ],
  dias,
  ["A", "B", "C"],
);
ok("total ignora arquivada e cliente sem linha", r.total, 2);
ok("a produzir", r.aProduzir, 1);
/* Só o C. O B tem peça arquivada, e a grade DESENHA o chip riscado —
   dizer "sem pauta" embaixo de uma linha com chip é a tela discordando
   de si mesma. */
ok("cliente com so peca arquivada NAO conta como sem pauta", r.clientesSemPauta, 1);
ok("peca de cliente fora da grade nao entra", r.noAr + r.aprovadas, 0);

console.log(falhas === 0 ? "\nTUDO PASSOU" : `\n${falhas} FALHA(S)`);
process.exit(falhas ? 1 : 0);
