/* =====================================================================
   Ficha do cliente (`clients.ficha`, migration 105)
   ---------------------------------------------------------------------
   O que a equipe precisa saber para atender a conta: mapa do negócio,
   metas de 30/60/90 dias, preferências, regras, contatos, acessos...

   Dois formatos de seção, e SÓ dois:
     - campos: { chave: texto }            (ex.: mapa do negócio)
     - lista:  [{ id, ...chave: texto }]   (ex.: regras, contatos)
   Tudo é texto. A definição abaixo é a fonte única: a tela desenha os
   formulários a partir dela e o servidor descarta qualquer chave que
   não esteja aqui.

   ⚠️ Senha NUNCA entra na ficha. Em "acessos" vai só ONDE ela está
   guardada (gerenciador de senhas, cofre da agência...).
   ===================================================================== */

export type TipoDeCampo = "curto" | "longo" | "data";

export interface DefinicaoDeCampo {
  chave: string;
  rotulo: string;
  tipo?: TipoDeCampo;
  /** Valores aceitos, com o rótulo de cada um. Vira um seletor. */
  opcoes?: readonly { valor: string; rotulo: string }[];
  placeholder?: string;
}

export const SECOES_DE_CAMPOS = {
  perfil: [
    { chave: "squad", rotulo: "Squad", placeholder: "Squad Performance" },
    { chave: "briefing", rotulo: "O que faz", placeholder: "Móveis planejados e sofás sob medida" },
    { chave: "cidade", rotulo: "Cidade", placeholder: "Brusque/SC" },
  ],
  mapa: [
    { chave: "oferta", rotulo: "Oferta principal", tipo: "longo" },
    { chave: "ticket", rotulo: "Ticket médio e margem", tipo: "longo" },
    { chave: "publico", rotulo: "Público", tipo: "longo" },
    { chave: "diferenciais", rotulo: "Diferenciais", tipo: "longo" },
    { chave: "objecao", rotulo: "Objeção comum", tipo: "longo" },
    { chave: "concorrentes", rotulo: "Concorrentes", tipo: "longo" },
    { chave: "fonte", rotulo: "De onde vêm as vendas", tipo: "longo" },
    { chave: "metas_dono", rotulo: "Metas do dono", tipo: "longo" },
    { chave: "cliente_oculto", rotulo: "Cliente oculto", tipo: "longo", placeholder: "Quando foi feito e o que se viu" },
  ],
  metas: [
    { chave: "kpi", rotulo: "KPI principal", placeholder: "Custo por venda" },
    { chave: "meta_30", rotulo: "Meta em 30 dias", placeholder: "R$ 70" },
    { chave: "meta_60", rotulo: "Meta em 60 dias", placeholder: "R$ 65" },
    { chave: "meta_90", rotulo: "Meta em 90 dias", placeholder: "R$ 60" },
    { chave: "definida_em", rotulo: "Definida em", tipo: "data" },
    { chave: "verba", rotulo: "Verba em anúncio combinada", placeholder: "R$ 4.000/mês" },
  ],
  atendimento: [
    { chave: "canal", rotulo: "Canal preferido", placeholder: "Grupo de WhatsApp" },
    { chave: "dinheiro", rotulo: "Assuntos de dinheiro", placeholder: "No privado, com o João" },
    { chave: "horarios", rotulo: "Melhores horários", tipo: "longo" },
    { chave: "estilo", rotulo: "Estilo", tipo: "longo", placeholder: "Prefere áudio curto, direto ao ponto" },
    { chave: "reunioes", rotulo: "Reuniões", tipo: "longo", placeholder: "Mensal online; planejamento trimestral presencial" },
  ],
  cs: [
    { chave: "proxima_reuniao", rotulo: "Próxima reunião", tipo: "data" },
    { chave: "motivo", rotulo: "Por que pede atenção", tipo: "longo", placeholder: "Custo por lead 58% acima da meta há 3 semanas" },
    { chave: "proximo_passo", rotulo: "Próximo passo", tipo: "longo", placeholder: "Reunião de recuperação na terça, 17/11" },
  ],
  ativos: [
    { chave: "pixel", rotulo: "Pixel da Meta" },
    { chave: "evento", rotulo: "Evento de conversão" },
    { chave: "pasta", rotulo: "Pasta de materiais", placeholder: "Link do Drive" },
    { chave: "biblioteca", rotulo: "Biblioteca de criativos", placeholder: "42 peças · 6 vencedores" },
  ],
} as const satisfies Record<string, readonly DefinicaoDeCampo[]>;

export const CATEGORIAS_DE_REGRA = [
  { valor: "nao_pode", rotulo: "Não pode" },
  { valor: "obrigatorio", rotulo: "Obrigatório" },
  { valor: "preferencia", rotulo: "Preferência" },
];

export const SECOES_DE_LISTA = {
  regras: [
    { chave: "texto", rotulo: "Regra", tipo: "longo" },
    { chave: "categoria", rotulo: "Categoria", opcoes: CATEGORIAS_DE_REGRA },
    { chave: "motivo", rotulo: "Motivo", tipo: "longo" },
    { chave: "pedido", rotulo: "Quem pediu e quando", placeholder: "João, reunião de 02/10" },
  ],
  pendencias: [
    { chave: "texto", rotulo: "Pendência", placeholder: "Enviar fotos do showroom" },
    { chave: "desde", rotulo: "Desde", tipo: "data" },
  ],
  contatos: [
    { chave: "nome", rotulo: "Nome" },
    { chave: "papel", rotulo: "Papel", placeholder: "Dono" },
    { chave: "decide", rotulo: "O que decide", placeholder: "Verba e aprovação de criativo" },
    { chave: "canal", rotulo: "Canal", placeholder: "WhatsApp privado" },
  ],
  datas: [
    { chave: "data", rotulo: "Data", placeholder: "12/03" },
    { chave: "descricao", rotulo: "O que é", placeholder: "Aniversário do João — enviar brinde" },
  ],
  oportunidades: [
    { chave: "texto", rotulo: "Oportunidade", placeholder: "Incluir Google Ads" },
    {
      chave: "tipo",
      rotulo: "Tipo",
      opcoes: [
        { valor: "upsell", rotulo: "Upsell" },
        { valor: "depoimento", rotulo: "Depoimento" },
        { valor: "marco", rotulo: "Marco" },
        { valor: "reajuste", rotulo: "Reajuste" },
      ],
    },
    { chave: "detalhe", rotulo: "Detalhe", tipo: "longo", placeholder: "Verde há 4 meses; clientes procuram no Google" },
  ],
  acessos: [
    { chave: "plataforma", rotulo: "Plataforma", placeholder: "Gerenciador de Negócios (Meta)" },
    { chave: "conta", rotulo: "Conta", placeholder: "Casa Vale - Principal" },
    {
      chave: "status",
      rotulo: "Status",
      opcoes: [
        { valor: "ativo", rotulo: "Ativo" },
        { valor: "pendente", rotulo: "Pendente" },
      ],
    },
    { chave: "onde", rotulo: "Onde está a senha", placeholder: "Gerenciador de senhas › Casa Vale" },
  ],
} as const satisfies Record<string, readonly DefinicaoDeCampo[]>;

export type SecaoDeCampos = keyof typeof SECOES_DE_CAMPOS;
export type SecaoDeLista = keyof typeof SECOES_DE_LISTA;

export type Campos = Record<string, string>;

/**
 * Item de lista. `criado_por`/`criado_em` (e `ultimo_followup` das
 * pendências) são carimbados pelo servidor e sobrevivem à edição.
 */
export type ItemDaFicha = {
  id: string;
  criado_por?: string;
  criado_em?: string;
  ultimo_followup?: string;
} & Record<string, string>;

/** Chaves que só o servidor grava — editar o item não as apaga. */
export const CARIMBOS = ["criado_por", "criado_em", "ultimo_followup"] as const;

export type FichaDoCliente = Partial<Record<SecaoDeCampos, Campos>> &
  Partial<Record<SecaoDeLista, ItemDaFicha[]>>;

export const LIMITE_DO_TEXTO = 3000;
export const LIMITE_DA_LISTA = 200;

export function ehSecaoDeCampos(s: string): s is SecaoDeCampos {
  return Object.hasOwn(SECOES_DE_CAMPOS, s);
}

export function ehSecaoDeLista(s: string): s is SecaoDeLista {
  return Object.hasOwn(SECOES_DE_LISTA, s);
}

/**
 * Mantém só as chaves definidas, com texto aparado e dentro do limite.
 * Opção fora da lista vira texto vazio. É a validação do servidor: a
 * ficha é jsonb livre no banco, e sem isto qualquer chave entraria.
 */
export function limparValores(
  definicao: readonly DefinicaoDeCampo[],
  valores: Record<string, unknown>,
): Campos {
  const limpo: Campos = {};
  for (const d of definicao) {
    const bruto = valores[d.chave];
    if (typeof bruto !== "string") continue;
    const texto = bruto.trim().slice(0, LIMITE_DO_TEXTO);
    if (d.opcoes && texto && !d.opcoes.some((o) => o.valor === texto)) continue;
    limpo[d.chave] = texto;
  }
  return limpo;
}

/** Rótulo de uma opção ("nao_pode" → "Não pode"). */
export function rotuloDaOpcao(def: DefinicaoDeCampo, valor: string | undefined): string {
  return def.opcoes?.find((o) => o.valor === valor)?.rotulo ?? valor ?? "";
}
