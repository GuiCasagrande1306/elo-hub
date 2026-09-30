/* =====================================================================
   O que impede um fluxo de ir ao ar
   ---------------------------------------------------------------------
   Módulo puro: recebe o grafo, devolve os problemas. Não fala com
   banco, não importa React, e por isso `teste-fluxo-elochat.mts`
   consegue pinar cada regra sem subir nada.

   ⚠️ A REGRA QUE MAIS IMPORTA É A DO CICLO, e ela não é estética. Um
   fluxo que volta para um nó anterior manda a mesma pessoa em laço:
   mensagem, botão, mensagem, botão, para sempre. Do lado da Meta isso
   é indistinguível de spam — e a conta do Geraldo foi restringida DUAS
   VEZES em setembro por cadência de automação, com algo muito mais
   inocente que isso. Um ciclo publicado não gera um bug, gera uma
   conta bloqueada.

   As outras regras existem para o fluxo não falhar DEPOIS de publicado,
   quando o erro chega como uma mensagem que nunca saiu e ninguém vê.
   ===================================================================== */

/** O recorte do nó do React Flow que a validação precisa. */
export interface NoDoFluxo {
  id: string;
  data: {
    blockId: string;
    titulo?: string;
    texto?: string;
    botoes?: { id: string; label: string }[];
    cartoes?: { id: string; titulo: string; botao: string }[];
  };
}

export interface ArestaDoFluxo {
  id: string;
  source: string;
  target: string;
}

export type GravidadeDoProblema = "impede" | "avisa";

export interface Problema {
  gravidade: GravidadeDoProblema;
  /** Nó a destacar no canvas. `null` quando é do fluxo inteiro. */
  noId: string | null;
  mensagem: string;
}

/** Blocos que iniciam um fluxo. Espelha `kind: "trigger"` em blocks.ts. */
const GATILHOS = new Set(["comment", "story-reply", "keyword", "ad-click"]);

/** Blocos cujo corpo de texto é a mensagem em si. */
const PRECISA_DE_TEXTO = new Set(["message", "buttons", "carousel"]);

/**
 * Tudo que está errado no fluxo, em ordem de gravidade.
 *
 * Array vazio = pode publicar. Nunca `null`, para quem chama poder
 * escrever `if (problemas.length)` sem checar nulo antes.
 */
export function problemasDoFluxo(
  nos: NoDoFluxo[],
  arestas: ArestaDoFluxo[],
): Problema[] {
  const p: Problema[] = [];
  const impede = (noId: string | null, mensagem: string) =>
    p.push({ gravidade: "impede", noId, mensagem });
  const avisa = (noId: string | null, mensagem: string) =>
    p.push({ gravidade: "avisa", noId, mensagem });

  if (nos.length === 0) {
    impede(null, "O fluxo está vazio.");
    return p;
  }

  const gatilhos = nos.filter((n) => GATILHOS.has(n.data.blockId));

  if (gatilhos.length === 0) {
    impede(null, "Falta um gatilho: nada faria o fluxo começar.");
  }

  /* ⚠️ MAIS DE UM GATILHO NÃO É ERRO, mas merece aviso: dois gatilhos
     que casam com o mesmo comentário disparam dois fluxos para a mesma
     pessoa, e ela recebe duas mensagens. Fica como aviso porque
     "comentou no Reel" e "palavra no direct" no mesmo fluxo é um
     desenho legítimo e comum. */
  if (gatilhos.length > 1) {
    avisa(null, `Há ${gatilhos.length} gatilhos. Se dois casarem com a mesma pessoa, ela recebe o fluxo duas vezes.`);
  }

  const saidas = new Map<string, string[]>();
  for (const a of arestas) {
    saidas.set(a.source, [...(saidas.get(a.source) ?? []), a.target]);
  }

  for (const g of gatilhos) {
    if (!saidas.get(g.id)?.length) {
      impede(g.id, "Este gatilho não leva a lugar nenhum.");
    }
  }

  for (const n of nos) {
    const { blockId, texto, botoes, cartoes } = n.data;

    if (PRECISA_DE_TEXTO.has(blockId) && !texto?.trim()) {
      impede(n.id, "Mensagem sem texto: nada seria enviado.");
    }

    if (blockId === "buttons") {
      if (!botoes?.length) {
        impede(n.id, "Mensagem com botões, mas sem nenhum botão.");
      } else if (botoes.some((b) => !b.label.trim())) {
        impede(n.id, "Há botão sem rótulo.");
      }
    }

    if (blockId === "carousel") {
      if (!cartoes?.length) {
        impede(n.id, "Carrossel sem nenhum cartão.");
      } else if (cartoes.some((c) => !c.titulo.trim() || !c.botao.trim())) {
        impede(n.id, "Há cartão sem título ou sem rótulo de botão.");
      }
    }
  }

  /* Nó solto: existe no canvas e nenhum caminho chega nele. Não impede
     — o fluxo funciona sem ele —, mas quase sempre é uma aresta que
     alguém esqueceu de ligar, e descobrir isso depois de publicar
     custa uma campanha. */
  const alcancaveis = alcancaveisDosGatilhos(gatilhos.map((g) => g.id), saidas);
  for (const n of nos) {
    if (!alcancaveis.has(n.id) && !GATILHOS.has(n.data.blockId)) {
      avisa(n.id, "Nada chega a este bloco: ele nunca seria executado.");
    }
  }

  const ciclo = acharCiclo(nos.map((n) => n.id), saidas);
  if (ciclo) {
    impede(
      ciclo,
      "Este bloco fecha um ciclo. O fluxo mandaria a mesma pessoa em laço — é assim que a conta é bloqueada.",
    );
  }

  return p.sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === "impede" ? -1 : 1));
}

/** Pode publicar? Aviso não impede; só `impede` impede. */
export function podePublicar(problemas: Problema[]): boolean {
  return !problemas.some((x) => x.gravidade === "impede");
}

function alcancaveisDosGatilhos(
  gatilhos: string[],
  saidas: Map<string, string[]>,
): Set<string> {
  const vistos = new Set<string>(gatilhos);
  const fila = [...gatilhos];

  while (fila.length) {
    const atual = fila.shift()!;
    for (const proximo of saidas.get(atual) ?? []) {
      if (vistos.has(proximo)) continue;
      vistos.add(proximo);
      fila.push(proximo);
    }
  }

  return vistos;
}

/**
 * O primeiro nó que fecha um ciclo, ou `null`.
 *
 * Busca em profundidade com três cores: branco (não visitado), cinza
 * (na pilha atual), preto (terminado). Achar um cinza de novo é um
 * ciclo. Contar só "já vi este nó" acusaria ciclo em losango — dois
 * caminhos que se reencontram —, que é um desenho legítimo e comum
 * quando dois botões levam à mesma resposta.
 */
function acharCiclo(
  ids: string[],
  saidas: Map<string, string[]>,
): string | null {
  const COR = new Map<string, "cinza" | "preto">();

  const visita = (no: string): string | null => {
    const cor = COR.get(no);
    if (cor === "cinza") return no;
    if (cor === "preto") return null;

    COR.set(no, "cinza");
    for (const proximo of saidas.get(no) ?? []) {
      const achado = visita(proximo);
      if (achado) return achado;
    }
    COR.set(no, "preto");
    return null;
  };

  for (const id of ids) {
    const achado = visita(id);
    if (achado) return achado;
  }

  return null;
}
