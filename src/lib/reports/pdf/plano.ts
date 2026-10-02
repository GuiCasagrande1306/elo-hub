import type { ReportPayload } from "../payload";

/* =====================================================================
   O plano da folha — quem calcula a altura é quem desenha
   ---------------------------------------------------------------------
   POR QUE ESTE ARQUIVO EXISTE. O relatório sai numa PÁGINA SÓ de 1080
   de largura e altura variável, como o do Reportei (medido: 1080 ×
   3081 pt, uma página). O `react-pdf` não mede conteúdo — ele precisa
   da altura ANTES de desenhar. Então a altura tem de ser calculada.

   ⚠️ E AQUI MORA O RISCO QUE JUSTIFICA O DESENHO DESTE MÓDULO. Se um
   arquivo calcula a altura e outro desenha os blocos, os dois divergem
   no primeiro ajuste que só um receber — e o sintoma é a folha
   terminando com um palmo de branco ou cortando a última tabela ao
   meio. É a mesma classe de erro que custou quatro divergências entre
   o PDF e a folha de revisão, e que o projeto resolveu com a regra de
   um renderizador só.

   A saída é não ter duas fontes: `planoDoRelatorio` devolve a LISTA DE
   BLOCOS com a altura de cada um, o documento desenha exatamente essa
   lista, e cada bloco recebe `height` explícito igual ao que entrou na
   soma. A altura da página é a soma. Desenhar diferente do planejado
   deixa de ser possível por descuido: seria preciso ignorar o plano.

   ⚠️ TODA ALTURA É DECLARADA, NUNCA DEIXADA AO CONTEÚDO. Nada de texto
   que decide quanto ocupa: rótulo longo é truncado na largura
   conhecida, linha de tabela tem altura fixa. Um nome de campanha que
   quebre em duas linhas desalinharia a conta inteira da folha — por
   isso `truncar` existe e é usada em todo texto de célula.
   ===================================================================== */

export const LARGURA_DA_FOLHA = 1080;
export const MARGEM_LATERAL = 56;
export const LARGURA_UTIL = LARGURA_DA_FOLHA - MARGEM_LATERAL * 2;

/**
 * As alturas de cada peça, em pontos.
 *
 * Números redondos de propósito: a folha inteira é uma soma destes, e
 * valores quebrados tornariam qualquer conferência manual impossível.
 */
export const ALTURA = {
  capa: 392,
  /** Respiro entre cartões de plataforma. */
  respiro: 32,
  /** Padding vertical somado (topo + base) dentro do cartão. */
  recheioDoCartao: 64,
  /** Filete colorido no topo do cartão. */
  filete: 4,
  cabecalhoDaPlataforma: 76,
  /** Uma fileira de até quatro KPIs. */
  fileiraDeKpi: 116,
  /** Gráfico de linha do investimento diário. */
  grafico: 268,
  /** Título centralizado de um bloco interno ("Funil", "Campanhas…"). */
  tituloDeBloco: 52,
  degrauDoFunil: 66,
  cabecalhoDeTabela: 56,
  linhaDeTabela: 48,
  /** Linha da tabela de anúncios, que carrega miniatura. */
  linhaDeTabelaComFoto: 92,
} as const;

/** Quantos KPIs cabem numa fileira. */
export const KPIS_POR_FILEIRA = 4;

/** Quantas linhas cada tabela mostra, no máximo. */
export const MAX_CAMPANHAS = 6;
export const MAX_ANUNCIOS = 6;

/* ------------------------------------------------------------------ */

export interface BlocoCapa {
  tipo: "capa";
  altura: number;
}

export interface BlocoPlataforma {
  tipo: "plataforma";
  altura: number;
  indice: number;
  /** Fileiras de KPI já fatiadas — o documento desenha estas. */
  fileiras: ReportPayload["platformDetail"][number]["kpis"][];
  temGrafico: boolean;
  /** Degraus do funil; vazio quando a plataforma não tem o dado. */
  funil: { rotulo: string; valor: string }[];
  campanhas: ReportPayload["platformDetail"][number]["campaigns"];
}

export interface BlocoAnuncios {
  tipo: "anuncios";
  altura: number;
  anuncios: ReportPayload["creatives"];
}

/* ⚠️ NÃO EXISTE BLOCO DE RODAPÉ, e a ausência é decisão de 02/10/2026.
   A folha fechava com o logo da agência num círculo escuro, como a do
   Reportei. Saiu a pedido do Guilherme: o relatório é entregue por
   quem já se identificou, e a assinatura no fim só adiciona altura.

   Removido do PLANO, não só do desenho — e é essa a parte que importa.
   Apagar só o componente deixaria os 176pt do rodapé dentro da soma, e
   a folha voltaria a terminar com um palmo de branco, que é
   exatamente o defeito que este módulo existe para impedir. */
export type Bloco = BlocoCapa | BlocoPlataforma | BlocoAnuncios;

export interface PlanoDaFolha {
  blocos: Bloco[];
  /** A altura da página, que é a soma dos blocos. */
  altura: number;
}

/** Em quantas fileiras de até quatro os KPIs se dividem. */
export function fatiarEmFileiras<T>(itens: T[], porFileira = KPIS_POR_FILEIRA): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += porFileira) {
    saida.push(itens.slice(i, i + porFileira));
  }
  return saida;
}

function alturaDaPlataforma(b: Omit<BlocoPlataforma, "altura" | "tipo">): number {
  let h = ALTURA.filete + ALTURA.recheioDoCartao + ALTURA.cabecalhoDaPlataforma;

  h += b.fileiras.length * ALTURA.fileiraDeKpi;

  /* ⚠️ O GRÁFICO NÃO SOMA ALTURA PRÓPRIA quando há duas ou mais
     fileiras de KPI: no Reportei ele ocupa o espaço VAZIO à direita da
     segunda fileira, não um bloco abaixo dela. Somar os dois produziria
     justamente o palmo de branco que este trabalho existe para tirar. */
  if (b.temGrafico && b.fileiras.length < 2) h += ALTURA.grafico;

  if (b.funil.length > 0) {
    h += ALTURA.tituloDeBloco + b.funil.length * ALTURA.degrauDoFunil;
  }

  if (b.campanhas.length > 0) {
    h +=
      ALTURA.tituloDeBloco +
      ALTURA.cabecalhoDeTabela +
      Math.min(b.campanhas.length, MAX_CAMPANHAS) * ALTURA.linhaDeTabela;
  }

  return h;
}

/**
 * O plano completo da folha.
 *
 * Ordem fixa: capa, um cartão por plataforma e anúncios em destaque.
 * A folha acaba no último cartão — sem assinatura no fim, ver a nota
 * em `Bloco`. A ordem não é configurável de
 * propósito — relatório que muda de forma a cada cliente deixa de ser
 * reconhecível, e o cliente perde a referência de onde olhar.
 */
export function planoDoRelatorio(payload: ReportPayload): PlanoDaFolha {
  const blocos: Bloco[] = [{ tipo: "capa", altura: ALTURA.capa }];

  payload.platformDetail.forEach((p, indice) => {
    const parcial = {
      indice,
      fileiras: fatiarEmFileiras(p.kpis),
      /* Só a primeira plataforma ganha o gráfico de investimento
         diário: a série é do período inteiro, não por plataforma, e
         repeti-la em cada cartão mostraria o mesmo desenho duas vezes
         como se fossem dados diferentes. */
      temGrafico: indice === 0 && payload.trend.length > 1,
      funil: degrausDoFunil(p),
      campanhas: p.campaigns,
    };

    blocos.push({
      tipo: "plataforma",
      ...parcial,
      altura: alturaDaPlataforma(parcial),
    });
  });

  const anuncios = payload.creatives.slice(0, MAX_ANUNCIOS);
  if (anuncios.length > 0) {
    blocos.push({
      tipo: "anuncios",
      anuncios,
      altura:
        ALTURA.filete +
        ALTURA.recheioDoCartao +
        ALTURA.tituloDeBloco +
        ALTURA.cabecalhoDeTabela +
        anuncios.length * ALTURA.linhaDeTabelaComFoto,
    });
  }

  /* O respiro entre blocos entra na soma, e não como margem do bloco:
     margem de CSS colapsa e a conta erraria por um respiro inteiro. */
  const respiros = Math.max(0, blocos.length - 1) * ALTURA.respiro;

  return {
    blocos,
    altura: blocos.reduce((a, b) => a + b.altura, 0) + respiros,
  };
}

/**
 * Os degraus do funil de uma plataforma.
 *
 * ⚠️ SÓ COM O NÚMERO APURADO. Degrau com zero por falta de dado faria o
 * funil "fechar" num ponto onde nada aconteceu — e funil é lido pelo
 * formato, então um estrangulamento falso é uma conclusão falsa. Sem o
 * dado, o degrau não existe.
 */
function degrausDoFunil(
  p: ReportPayload["platformDetail"][number],
): { rotulo: string; valor: string }[] {
  const ordem = ["spend", "impressions", "reach", "clicks", "linkClicks", "results"];
  return ordem
    .map((chave) => p.kpis.find((k) => k.key === chave))
    .filter((k): k is NonNullable<typeof k> => Boolean(k) && !k!.indefinido)
    .map((k) => ({ rotulo: k.label, valor: k.formatted }));
}

/**
 * Corta o texto na contagem que a célula comporta.
 *
 * ⚠️ É O QUE PROTEGE A CONTA DA ALTURA. Sem truncar, um nome de
 * campanha longo quebra em duas linhas, a linha da tabela cresce, e a
 * folha inteira passa a terminar antes ou depois do conteúdo — porque
 * a altura foi somada supondo uma linha.
 */
export function truncar(texto: string | null | undefined, limite: number): string {
  const t = (texto ?? "").trim();
  if (t.length <= limite) return t;
  return `${t.slice(0, Math.max(0, limite - 1)).trimEnd()}…`;
}
