import type { Bloco } from "./blocks";

/* =====================================================================
   O esqueleto do formato
   ---------------------------------------------------------------------
   É o que aparece no editor de um documento novo. Não é conteúdo de
   exemplo para apagar — é a ORDEM do formato, com um bloco de cada tipo
   no lugar em que ele costuma entrar:

     diagnóstico → arquétipos → fórmula → roteiros → banco → checklist

   Essa sequência é a tese do formato. Diagnóstico antes de arquétipo
   porque a escolha do formato precisa sair dos números do perfil, não
   de preferência; checklist por último porque ele só existe depois de
   os roteiros terem criado as pendências que ele cobra.

   Os textos entre colchetes são o gesto que o formato pede de volta:
   nada vai ao ar antes de a pendência ser confirmada com o cliente.
   ===================================================================== */

export const MODELO_INICIAL: Bloco[] = [
  {
    tipo: "secao",
    eyebrow: "01 — O que os números mostram",
    titulo: "[A leitura do perfil em uma frase]",
    lede: "[O que os dados de visualização mostram que a contagem de curtidas esconde.]",
    prosa: [
      "**[Primeiro argumento.]** [Desenvolvimento com o número que sustenta.]",
    ],
  },
  {
    tipo: "tabela",
    colunas: [
      { rotulo: "Vídeo", numerica: false },
      { rotulo: "Data", numerica: false },
      { rotulo: "Views", numerica: true },
      { rotulo: "Coment.", numerica: true },
    ],
    linhas: [
      { celulas: ["[Título do vídeo]", "[dia mês]", "[views]", "[n]"], destaque: true },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "02 — O filtro editorial",
    titulo: "[O que entra e o que não entra]",
    prosa: [],
  },
  {
    tipo: "colunas",
    colunas: [
      {
        tom: "nao",
        titulo: "Nunca entra",
        itens: ["**[Categoria]:** [por que afasta o público certo]."],
      },
      {
        tom: "sim",
        titulo: "Sempre entra",
        itens: ["**[Categoria]:** [por que aproxima o público certo]."],
      },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "03 — A fórmula",
    titulo: "[O formato, em quatro tempos]",
    prosa: [],
  },
  {
    tipo: "formula",
    partes: [
      { etapa: "0–2s · Gancho", texto: "[O que segura o dedo antes de qualquer fala.]" },
      { etapa: "3–10s · Virada", texto: "[O movimento físico que sustenta a retenção.]" },
      { etapa: "10–35s · Prova", texto: "[O objeto na mão, sem corte no momento decisivo.]" },
      { etapa: "Final · Veredito", texto: "[A posição. Nunca terminar sem uma.]" },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "04 — Os roteiros",
    titulo: "Cronograma da semana.",
    prosa: [],
  },
  {
    tipo: "roteiro",
    numero: "01",
    faixa: "topo",
    formato: ["Reels · 40–50s", "[cena]"],
    titulo: "[Título do roteiro]",
    gancho: "“[A primeira frase, palavra por palavra.]”",
    desenvolvimento: [
      "“[Primeiro parágrafo falado.]",
      "[Segundo parágrafo, com a prova.] _(indicação de cena em itálico)_”",
    ],
    cta: "“[O que o espectador faz agora.]”",
    legenda: ["[Primeira linha da legenda]", "[Pergunta que puxa comentário] 👇"],
    direcao: "[O que o editor precisa saber e o cliente não.]",
  },
  {
    tipo: "secao",
    eyebrow: "05 — Banco de ganchos",
    titulo: "Próximas semanas, mesma fórmula.",
    prosa: [],
  },
  {
    tipo: "banco",
    itens: [{ numero: "02", gancho: "“[Gancho ainda sem roteiro.]”", nota: "[o ângulo]" }],
  },
  {
    tipo: "secao",
    eyebrow: "06 — Antes de gravar",
    titulo: "O que precisa vir do cliente.",
    lede: "Cada item preenche um [colchete] dos roteiros.",
    prosa: [],
  },
  {
    tipo: "checklist",
    itens: ["[Dado a confirmar] (roteiro 01)."],
  },
  {
    tipo: "callout",
    tom: "alerta",
    titulo: "Antes de publicar",
    paragrafos: [
      "Só afirme o que for verificável. Cada [colchete] precisa ser confirmado com o cliente antes de gravar.",
    ],
  },
  {
    tipo: "rodape",
    itens: ["Elo Marketing", "[Cliente]", "[Origem dos dados]"],
  },
];
