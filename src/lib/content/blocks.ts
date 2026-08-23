import { z } from "zod";

/* =====================================================================
   O formato de um brief de conteúdo
   ---------------------------------------------------------------------
   Um documento é uma LISTA PLANA de blocos. Não há aninhamento: o bloco
   `secao` abre uma seção e tudo que vem depois dele pertence a ela até o
   próximo `secao`. O renderizador é quem agrupa.

   Escolha deliberada. Aninhar (`secao` com `filhos: Bloco[]`) parece mais
   organizado e é pior de escrever à mão: mover um roteiro de uma seção
   para outra vira recortar de um array e colar em outro, com chave
   fechando no lugar errado. Plano, mover é trocar duas linhas de lugar.

   MARCAÇÃO EM LINHA
   ---------------------------------------------------------------------
   Todo texto corrido aceita três marcas, e só três:

     **negrito**   ênfase de argumento
     _itálico_     indicação de cena — _(levanta e vai até a cozinha)_
     [colchete]    pendência: dado que precisa ser confirmado com o
                   cliente ANTES de gravar. Sai destacado em amarelo, e
                   a tela conta quantos ainda faltam.

   O colchete é o motivo de existir marcação nenhuma além dessas: ele é
   uma regra de trabalho da agência, não um enfeite. Um número inventado
   num vídeo de bastidor destrói exatamente a autoridade que o vídeo
   constrói — então a pendência precisa ser visível no documento, não
   uma nota mental de quem escreveu.
   ===================================================================== */

/** Texto corrido com a marcação em linha acima. */
const texto = z.string().max(4000);

/** Texto curto de rótulo — nunca deve quebrar o layout. */
const rotulo = z.string().trim().min(1).max(120);

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

/**
 * Abre uma seção. O `eyebrow` carrega a numeração ("01 — Diagnóstico")
 * como texto, e não como campo separado, porque renumerar um documento
 * é reescrever a string — enquanto um campo `numero` automático
 * obrigaria a decidir o que fazer quando uma seção não é numerada.
 */
const secao = z.object({
  tipo: z.literal("secao"),
  eyebrow: rotulo,
  titulo: z.string().trim().min(1).max(300),
  /** Parágrafo de abertura, maior que o corpo. */
  lede: texto.optional(),
  /** Corpo argumentativo da seção. */
  prosa: z.array(texto).max(20).default([]),
});

const tabela = z.object({
  tipo: z.literal("tabela"),
  colunas: z
    .array(
      z.object({
        rotulo,
        /* Alinha à direita e usa números tabulares. Coluna de views ou
           de custo desalinhada obriga a comparar dígito a dígito. */
        numerica: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(10),
  linhas: z
    .array(
      z.object({
        celulas: z.array(z.string().max(200)).max(10),
        /** Linha que sustenta o argumento da seção — sai em destaque. */
        destaque: z.boolean().default(false),
      }),
    )
    .max(60),
});

/**
 * O par "nunca entra / sempre entra". Aceita mais de duas colunas
 * porque o mesmo componente serve à comparação de arquétipos, que tem
 * três — e ali o `tom` deixa de ser regra e vira veredito: dois
 * formatos que funcionam e um que é armadilha.
 */
const colunas = z.object({
  tipo: z.literal("colunas"),
  colunas: z
    .array(
      z.object({
        tom: z.enum(["sim", "nao"]),
        titulo: rotulo,
        itens: z.array(texto).max(20),
      }),
    )
    .min(1)
    .max(4),
});

const callout = z.object({
  tipo: z.literal("callout"),
  /* `alerta` é para o que trava a gravação — combinado com o cliente,
     risco jurídico, dado a confirmar. `padrao` é síntese. */
  tom: z.enum(["padrao", "alerta"]).default("padrao"),
  titulo: rotulo,
  paragrafos: z.array(texto).min(1).max(10),
});

const formula = z.object({
  tipo: z.literal("formula"),
  partes: z
    .array(z.object({ etapa: rotulo, texto }))
    .min(2)
    .max(6),
});

/** As faixas de funil, na ordem em que aparecem no cronograma. */
export const FAIXAS = ["piloto", "topo", "meio", "fundo"] as const;
export type Faixa = (typeof FAIXAS)[number];

export const FAIXA_LABEL: Record<Faixa, string> = {
  piloto: "Piloto",
  topo: "Topo",
  meio: "Meio",
  fundo: "Fundo",
};

/**
 * O roteiro. É o bloco que justifica o módulo inteiro.
 *
 * Os cinco campos do corpo não são estilo, são a fórmula: gancho segura
 * os 3 primeiros segundos, desenvolvimento entrega a prova, CTA converte,
 * legenda faz o trabalho fora do vídeo e a direção é o que o editor
 * precisa saber e o cliente não. Nenhum é opcional a não ser a direção —
 * roteiro sem CTA é conteúdo que não pede nada.
 */
const roteiro = z.object({
  tipo: z.literal("roteiro"),
  /* String, não número: o piloto é "00" e a ordenação é a do array.
     Número forçaria decidir se 0 imprime "0" ou "00". */
  numero: z.string().trim().min(1).max(4),
  faixa: z.enum(FAIXAS),
  /** Ex.: "Reels · 40–50s" e "Pedro + close de borda", uma por linha. */
  formato: z.array(rotulo).max(3).default([]),
  titulo: z.string().trim().min(1).max(200),
  gancho: texto,
  desenvolvimento: z.array(texto).min(1).max(12),
  cta: texto,
  legenda: z.array(texto).max(6).default([]),
  direcao: texto.optional(),
});

/**
 * Banco de ganchos: as semanas seguintes, sem roteiro escrito ainda.
 *
 * Existe separado do `roteiro` de propósito. Um gancho sem
 * desenvolvimento não é um roteiro pela metade — é matéria-prima
 * aprovada, e misturar os dois faria a tela de gravação mostrar doze
 * itens quando só dez estão prontos.
 */
const banco = z.object({
  tipo: z.literal("banco"),
  itens: z
    .array(
      z.object({
        numero: z.string().trim().min(1).max(4),
        gancho: texto,
        /** O ângulo, em duas ou três palavras. */
        nota: rotulo.optional(),
      }),
    )
    .max(60),
});

/**
 * O que precisa vir do cliente antes de gravar. Cada item costuma
 * corresponder a um `[colchete]` dos roteiros.
 */
const checklist = z.object({
  tipo: z.literal("checklist"),
  itens: z.array(texto).max(40),
});

const rodape = z.object({
  tipo: z.literal("rodape"),
  itens: z.array(rotulo).max(8),
});

export const blocoSchema = z.discriminatedUnion("tipo", [
  secao,
  tabela,
  colunas,
  callout,
  formula,
  roteiro,
  banco,
  checklist,
  rodape,
]);

export type Bloco = z.infer<typeof blocoSchema>;
export type BlocoTipo = Bloco["tipo"];
export type BlocoRoteiro = Extract<Bloco, { tipo: "roteiro" }>;
export type BlocoSecao = Extract<Bloco, { tipo: "secao" }>;

/* Teto de 400: um documento editorial de um trimestre inteiro não passa
   de algumas dezenas de blocos. O limite existe para que um payload
   malformado (ou um laço de geração fugindo do controle) seja recusado
   na Server Action em vez de virar uma linha de 40MB no Postgres. */
export const blocosSchema = z.array(blocoSchema).max(400);

export const carimboSchema = z.object({
  rotulo,
  valor: z.string().trim().min(1).max(160),
});
export type Carimbo = z.infer<typeof carimboSchema>;
export const carimbosSchema = z.array(carimboSchema).max(8);

/* ------------------------------------------------------------------ */
/* Leitura tolerante                                                   */
/* ------------------------------------------------------------------ */

/**
 * Converte o `jsonb` do banco em blocos válidos, DESCARTANDO o que não
 * valida em vez de estourar.
 *
 * A tela de leitura não pode virar erro 500 porque um bloco antigo
 * perdeu um campo depois de uma mudança de formato. Descartar mostra o
 * documento com um buraco — visível, corrigível no editor. Estourar
 * apaga o documento inteiro da tela e não diz qual bloco tem o
 * problema.
 *
 * O caminho de ESCRITA é o oposto: lá o `blocosSchema` roda inteiro e
 * recusa o salvamento, porque na escrita ainda dá para consertar.
 */
export function lerBlocos(bruto: unknown): Bloco[] {
  if (!Array.isArray(bruto)) return [];

  const validos: Bloco[] = [];
  for (const item of bruto) {
    const resultado = blocoSchema.safeParse(item);
    if (resultado.success) validos.push(resultado.data);
  }
  return validos;
}

export function lerCarimbos(bruto: unknown): Carimbo[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item) => {
    const r = carimboSchema.safeParse(item);
    return r.success ? [r.data] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Métricas do documento                                               */
/* ------------------------------------------------------------------ */

/** `[qualquer coisa]` — a mesma expressão que o renderizador usa. */
const COLCHETE = /\[[^\]\n]+\]/g;

function textosDoBloco(bloco: Bloco): string[] {
  switch (bloco.tipo) {
    case "secao":
      return [bloco.lede ?? "", ...bloco.prosa];
    case "tabela":
      return bloco.linhas.flatMap((l) => l.celulas);
    case "colunas":
      return bloco.colunas.flatMap((c) => c.itens);
    case "callout":
      return bloco.paragrafos;
    case "formula":
      return bloco.partes.map((p) => p.texto);
    case "roteiro":
      return [
        bloco.gancho,
        ...bloco.desenvolvimento,
        bloco.cta,
        ...bloco.legenda,
        bloco.direcao ?? "",
      ];
    case "banco":
      return bloco.itens.map((i) => i.gancho);
    case "checklist":
      return bloco.itens;
    case "rodape":
      return bloco.itens;
  }
}

export interface ResumoDoBrief {
  roteiros: number;
  ganchosNoBanco: number;
  /** Quantos `[colchetes]` ainda esperam confirmação do cliente. */
  pendencias: number;
}

/**
 * O que a listagem mostra sem abrir o documento.
 *
 * `pendencias` é o número que decide o dia: enquanto ele não for zero, a
 * equipe não pode gravar sem inventar dado.
 */
export function resumirBrief(blocos: Bloco[]): ResumoDoBrief {
  let roteiros = 0;
  let ganchosNoBanco = 0;
  let pendencias = 0;

  for (const bloco of blocos) {
    if (bloco.tipo === "roteiro") roteiros += 1;
    if (bloco.tipo === "banco") ganchosNoBanco += bloco.itens.length;

    for (const texto of textosDoBloco(bloco)) {
      pendencias += texto.match(COLCHETE)?.length ?? 0;
    }
  }

  return { roteiros, ganchosNoBanco, pendencias };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export const STATUS_BRIEF = [
  "rascunho",
  "revisao",
  "aprovado",
  "arquivado",
] as const;
export type StatusBrief = (typeof STATUS_BRIEF)[number];

export const STATUS_BRIEF_LABEL: Record<StatusBrief, string> = {
  rascunho: "Rascunho",
  revisao: "Em revisão",
  aprovado: "Aprovado",
  arquivado: "Arquivado",
};
