import type { Bloco, Carimbo, StatusBrief } from "@/lib/content/blocks";
import type { ContentBriefWithRelations } from "@/types/database";

/* =====================================================================
   Brief de conteúdo de demonstração
   ---------------------------------------------------------------------
   UM documento só, e ele usa TODOS os nove tipos de bloco. É o critério
   deste arquivo: dataset de demo não existe para parecer cheio, existe
   para que abrir a tela prove que cada bloco renderiza. Três documentos
   bonitos usando dois tipos de bloco esconderiam sete.

   Cliente fictício (Verdi Cosméticos, o mesmo do resto do mock), não um
   cliente real da carteira. O modo demo é o que se mostra numa
   apresentação e o que roda sem credenciais — planejamento de conteúdo
   de cliente real não entra em nenhum dos dois.
   ===================================================================== */

const AGORA = new Date().toISOString();

const carimbos: Carimbo[] = [
  { rotulo: "Cliente", valor: "Verdi Cosméticos" },
  { rotulo: "Formato", valor: "Reels vertical" },
  { rotulo: "Ciclo", valor: "Terça e sexta" },
];

const blocos: Bloco[] = [
  {
    tipo: "secao",
    eyebrow: "01 — O que os números mostram",
    titulo: "Dois vídeos carregam o perfil. E os dois são do mesmo tema.",
    lede: "Com visualização na mão o quadro fica mais nítido do que só com curtida: o que alcança e o que conversa não são o mesmo conteúdo.",
    prosa: [
      "**A leitura por curtida engana.** O vídeo de bastidor tem um quinto do alcance do vídeo de humor e produziu a conversa mais densa da conta.",
      "O indicador que separa os dois é **curtidas por comentário**: quanto menor, mais gente parou para falar em vez de rolar.",
    ],
  },
  {
    tipo: "tabela",
    colunas: [
      { rotulo: "Vídeo", numerica: false },
      { rotulo: "Data", numerica: false },
      { rotulo: "Views", numerica: true },
      { rotulo: "Coment.", numerica: true },
      { rotulo: "Curt./com.", numerica: true },
    ],
    linhas: [
      {
        celulas: ["O que tem dentro do nosso sérum", "12 ago", "94 mil", "95", "21"],
        destaque: true,
      },
      {
        celulas: ["Quando a cliente pede desconto", "17 ago", "444 mil", "70", "161"],
        destaque: false,
      },
      {
        celulas: ["Rotina de skincare da equipe", "19 ago", "2.113", "6", "12"],
        destaque: false,
      },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "02 — Os arquétipos",
    titulo: "Um alcança. Um qualifica. Um é armadilha.",
    prosa: [],
  },
  {
    tipo: "colunas",
    colunas: [
      {
        tom: "sim",
        titulo: "Transparência — 94 mil",
        itens: [
          "**Mostrar o insumo real na bancada**, rótulo à mostra, sem edição.",
          "**Por que qualifica:** quem comenta ali é quem usa o produto e quer saber o que passa na pele.",
          "**Vantagem:** matéria-prima infinita — cada ingrediente é um episódio.",
        ],
      },
      {
        tom: "nao",
        titulo: "Humor de trabalho — 444 mil",
        itens: [
          "**Piada de atendimento**; a marca é só cenário.",
          "**O problema:** 161 curtidas por comentário. Alcance enorme, vínculo zero.",
          "**Uso correto:** eventual, para respiro. Nunca como estratégia.",
        ],
      },
    ],
  },
  {
    tipo: "callout",
    tom: "padrao",
    titulo: "O formato certo é o alcance de um com a carga do outro",
    paragrafos: [
      "A tensão é o **motor de alcance**. A prova física é a **carga útil**. Juntas viram um formato que dá para produzir toda semana sem depender de um acontecimento externo.",
    ],
  },
  {
    tipo: "secao",
    eyebrow: "03 — A fórmula",
    titulo: "Quatro tempos, sempre nesta ordem.",
    prosa: [],
  },
  {
    tipo: "formula",
    partes: [
      {
        etapa: "0–2s · A acusação",
        texto: "A frase que a cliente já disse, lida em voz alta. Nome sempre coberto.",
      },
      {
        etapa: "3–10s · A apuração",
        texto: "Levantar e ir até a bancada. O movimento físico é o que segura a retenção.",
      },
      {
        etapa: "10–35s · A prova",
        texto: "O frasco, a balança, o rótulo. Sem corte no momento decisivo.",
      },
      {
        etapa: "Final · O veredito",
        texto: "Assumir quando a cliente tem razão. Nunca terminar sem posição.",
      },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "04 — Os roteiros",
    titulo: "Cronograma da semana.",
    lede: "Dois roteiros completos, no formato que a equipe leva para a gravação.",
    prosa: [],
  },
  {
    tipo: "roteiro",
    numero: "01",
    faixa: "topo",
    formato: ["Reels · 40–50s", "Bancada + close"],
    titulo: "O rótulo que ninguém lê",
    gancho: "“Se o segundo ingrediente do seu sérum é álcool, você comprou água cara.”",
    desenvolvimento: [
      "“A lista de ingredientes é por ordem de quantidade. O que está em segundo lugar é quase tudo do que tem no frasco.",
      "Trouxe dois. _(vira os dois rótulos para a câmera)_ Esse aqui abre com água e álcool. O nosso abre com [ingrediente principal do sérum Verdi] — e é por isso que ele custa o que custa.”",
    ],
    cta: "“Vira o seu aí e lê o segundo ingrediente. Depois me conta o que achou.”",
    legenda: [
      "O segundo ingrediente entrega tudo 🔍",
      "Ordem na lista é ordem de quantidade — e quase ninguém sabe disso.",
      "Qual é o segundo do seu? 👇",
    ],
    direcao:
      "Close no rótulo nos primeiros 2s, antes de qualquer fala. Cobrir a marca do concorrente. Confirmar a composição com o laboratório antes de gravar.",
  },
  {
    tipo: "roteiro",
    numero: "02",
    faixa: "fundo",
    formato: ["Reels · 30–40s", "Balança"],
    titulo: "Por que o nosso rende três meses",
    gancho: "“Esse frasco parece pequeno. Vou pesar quanto sai por aplicação.”",
    desenvolvimento: [
      "“Todo mundo compara preço de frasco. Ninguém compara preço por aplicação — e é essa a conta que importa.",
      "_(pesa uma aplicação na balança de precisão)_ Dá [X] gramas. Com [Y] ml no frasco, são [Z] aplicações. Divide o preço e você chega no valor real do seu dia.”",
    ],
    cta: "“Faz essa conta com o que você usa hoje. Se quiser, o nosso está no link da bio.”",
    legenda: [
      "Preço por frasco engana. Preço por aplicação, não 🧮",
      "Peça no link da bio.",
    ],
    direcao:
      "Balança de precisão em plano único, sem corte. Conferir os números com o laboratório — número inventado aqui destrói exatamente a autoridade que o vídeo constrói.",
  },
  {
    tipo: "secao",
    eyebrow: "05 — Banco de ganchos",
    titulo: "Próximas semanas, mesma fórmula.",
    prosa: [],
  },
  {
    tipo: "banco",
    itens: [
      {
        numero: "03",
        gancho: "“Por que o creme que funcionou no inverno parou de funcionar agora?”",
        nota: "umidade e oclusão",
      },
      {
        numero: "04",
        gancho: "“Se arde, não é porque está fazendo efeito.”",
        nota: "desfaz um mito comum",
      },
      {
        numero: "05",
        gancho: "“Metade dos protetores solares perde eficácia no vidro do carro.”",
        nota: "leitura de rótulo + teste",
      },
    ],
  },
  {
    tipo: "secao",
    eyebrow: "06 — Antes de gravar",
    titulo: "O que precisa vir do cliente.",
    lede: "Cada item preenche um [colchete] dos roteiros. Sem eles o vídeo perde a prova — que é o que faz o formato funcionar.",
    prosa: [],
  },
  {
    tipo: "checklist",
    itens: [
      "Composição completa do sérum, em ordem de quantidade (roteiro 01).",
      "Volume do frasco e peso médio por aplicação (roteiro 02).",
      "**Aval do laboratório** para citar número em vídeo.",
    ],
  },
  {
    tipo: "callout",
    tom: "alerta",
    titulo: "Antes de rodar a série",
    paragrafos: [
      "Ataque a **prática**, nunca um concorrente com nome ou embalagem reconhecível. E só afirme o que for verificável: cada [colchete] precisa ser confirmado antes de gravar.",
    ],
  },
  {
    tipo: "rodape",
    itens: [
      "Elo Marketing",
      "Verdi Cosméticos",
      "Dados coletados no perfil público",
    ],
  },
];

/* =====================================================================
   Estado mutável do modo demo
   ---------------------------------------------------------------------
   Array exportado e mutado no lugar, como em `mock/social.ts`: em demo
   não há banco, e a alternativa seria uma tela em que salvar não muda
   nada — o pior defeito possível numa demonstração.

   O estado vive na memória do processo do servidor: some no restart e
   não é compartilhado entre instâncias. É o correto para demo, e o
   motivo de nada disso rodar quando há Supabase configurado.
   ===================================================================== */

export const demoContentBriefs: ContentBriefWithRelations[] = [
  {
    id: "brief-verdi-1",
    client_id: "c-verdi",
    titulo: "Bastidores da Verdi",
    destaque: "Verdi",
    resumo:
      "O formato que já fez as maiores visualizações do perfil, decodificado — e dois roteiros que usam a formulação real do produto para conversar com quem usa, não com quem vende.",
    carimbos,
    blocos,
    status: "aprovado",
    share_token: null,
    shared_at: null,
    created_by: "u-guilherme",
    created_at: AGORA,
    updated_at: AGORA,
    client: {
      id: "c-verdi",
      name: "Verdi Cosméticos",
      brand_primary: "#2f6b4f",
      logo_url: null,
    },
    author: { id: "u-guilherme", full_name: "Guilherme Casagrande", avatar_url: null },
  },
];

function acharDemo(id: string) {
  return demoContentBriefs.find((b) => b.id === id) ?? null;
}

export function salvarBriefDemo(entrada: {
  briefId?: string;
  clientId: string;
  titulo: string;
  destaque?: string | null;
  resumo: string;
  carimbos: Carimbo[];
  blocos: Bloco[];
  status: StatusBrief;
  autor: string;
}): ContentBriefWithRelations {
  const agora = new Date().toISOString();
  const existente = entrada.briefId ? acharDemo(entrada.briefId) : null;

  if (existente) {
    Object.assign(existente, {
      titulo: entrada.titulo,
      destaque: entrada.destaque ?? null,
      resumo: entrada.resumo,
      carimbos: entrada.carimbos,
      blocos: entrada.blocos,
      status: entrada.status,
      updated_at: agora,
    });
    return existente;
  }

  const novo: ContentBriefWithRelations = {
    /* Só dígitos no sufixo. O horário cru traz `:` do ISO, e um id como
       `brief-2-14:06:17` vira 404: o segmento com dois-pontos não casa
       com a rota. Salvava, redirecionava e a tela dizia que o documento
       não existia. */
    id: `brief-${demoContentBriefs.length + 1}-${agora.replace(/\D/g, "").slice(8, 14)}`,
    client_id: entrada.clientId,
    titulo: entrada.titulo,
    destaque: entrada.destaque ?? null,
    resumo: entrada.resumo,
    carimbos: entrada.carimbos,
    blocos: entrada.blocos,
    status: entrada.status,
    share_token: null,
    shared_at: null,
    created_by: entrada.autor,
    created_at: agora,
    updated_at: agora,
  };

  demoContentBriefs.unshift(novo);
  return novo;
}

export function publicarLinkDemo(id: string): string | null {
  const brief = acharDemo(id);
  if (!brief) return null;
  if (brief.share_token) return brief.share_token;

  brief.share_token = `demo${id}${"x".repeat(20)}`.slice(0, 32);
  brief.shared_at = new Date().toISOString();
  return brief.share_token;
}

export function revogarLinkDemo(id: string): void {
  const brief = acharDemo(id);
  if (!brief) return;
  brief.share_token = null;
  brief.shared_at = null;
}

export function mudarStatusDemo(id: string, status: StatusBrief): void {
  const brief = acharDemo(id);
  if (brief) brief.status = status;
}

export function duplicarBriefDemo(
  id: string,
  clientId: string,
  autor: string,
): ContentBriefWithRelations | null {
  const origem = acharDemo(id);
  if (!origem) return null;

  return salvarBriefDemo({
    clientId,
    titulo: `${origem.titulo} (cópia)`,
    destaque: origem.destaque,
    resumo: origem.resumo,
    carimbos: origem.carimbos as Carimbo[],
    blocos: origem.blocos as Bloco[],
    status: "rascunho",
    autor,
  });
}

export function apagarBriefDemo(id: string): void {
  const i = demoContentBriefs.findIndex((b) => b.id === id);
  if (i >= 0) demoContentBriefs.splice(i, 1);
}
