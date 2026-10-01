/* =====================================================================
   As categorias de conversão do Google Ads, e o que cada uma significa
   ---------------------------------------------------------------------
   POR QUE ESTE ARQUIVO EXISTE. A coluna "Conversões" do Google
   (`metrics.conversions`) traz ZERO para quase toda conta local da
   carteira, e o painel repetia o zero. Medido em 01/10/2026: a Agenda
   Contabilidade teve 1 ligação, 6 rotas e 3 interações em setembro, e
   o Elo Hub mostrava "0 leads" ao lado de R$ 199,98 investidos.

   O motivo é da plataforma: AÇÃO LOCAL vinda do Perfil da Empresa é
   contabilizada só em `all_conversions`, nunca na coluna principal.
   Não é defeito do nosso sync.

   ⚠️ E A CORREÇÃO ÓBVIA ESTÁ ERRADA. Trocar para `all_conversions` em
   todo mundo inflaria o Atacado de Pratas de 175 para 9.516 — porque
   9.322 daquilo é "Adicionar ao carrinho". Cinquenta e quatro vezes o
   número certo, num relatório que vai para o cliente. É a mesma
   armadilha que `conversion-action.ts` documenta do lado da Meta:
   somar o balaio conta a mesma pessoa cinco vezes.

   A saída é não somar balaio nenhum: guardar POR AÇÃO e classificar.

   A lista abaixo é a que existe de verdade na carteira, levantada nas
   11 contas ativas entre julho e setembro de 2026 — não é o catálogo
   do Google, é o que a Elo realmente usa.
   ===================================================================== */

export type GrupoDaConversao = "resultado" | "micro";

export interface CategoriaDef {
  /** Como a API devolve em `segments.conversion_action_category`. */
  id: string;
  label: string;
  grupo: GrupoDaConversao;
}

/**
 * ⚠️ `grupo` É A DECISÃO QUE MAIS IMPORTA AQUI.
 *
 * `resultado` é o que a agência apresenta como entregue: alguém pediu
 * contato, ligou, pediu rota, comprou. `micro` é passo no meio do
 * caminho — ver página, pôr no carrinho, iniciar checkout. Os dois
 * entram no painel, mas só `resultado` entra em total e em custo por
 * resultado.
 *
 * STORE_VISIT fica em `micro`, e é a classificação menos óbvia da
 * lista: visita à loja é resultado de verdade para varejo, mas o
 * Google a ESTIMA por modelagem, não mede. Misturá-la com contato
 * medido faria o total carregar um número inventado sem dizer que é.
 * Aparece separada, com o rótulo avisando.
 *
 * ENGAGEMENT também: "outras interações" do Perfil da Empresa junta
 * coisas que o Google não detalha. Mostrar sim, somar não.
 */
export const CATEGORIAS: CategoriaDef[] = [
  // --- o que a agência entrega ---
  { id: "CONTACT",          label: "Contato",            grupo: "resultado" },
  { id: "PHONE_CALL_LEAD",  label: "Ligação",            grupo: "resultado" },
  { id: "SUBMIT_LEAD_FORM", label: "Formulário",         grupo: "resultado" },
  { id: "GET_DIRECTIONS",   label: "Rota",               grupo: "resultado" },
  { id: "PURCHASE",         label: "Compra",             grupo: "resultado" },
  { id: "SIGNUP",           label: "Cadastro",           grupo: "resultado" },
  { id: "BOOK_APPOINTMENT", label: "Agendamento",        grupo: "resultado" },
  { id: "REQUEST_QUOTE",    label: "Orçamento",          grupo: "resultado" },

  // --- passos do meio do caminho ---
  { id: "ADD_TO_CART",      label: "Adicionou ao carrinho", grupo: "micro" },
  { id: "BEGIN_CHECKOUT",   label: "Iniciou checkout",      grupo: "micro" },
  { id: "PAGE_VIEW",        label: "Viu página",            grupo: "micro" },
  { id: "ENGAGEMENT",       label: "Outras interações",     grupo: "micro" },
  { id: "STORE_VISIT",      label: "Visita à loja (estimada)", grupo: "micro" },
  { id: "UNKNOWN",          label: "Não classificada",      grupo: "micro" },
];

const POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));

/**
 * A definição de uma categoria, com saída segura para o desconhecido.
 *
 * ⚠️ CATEGORIA NOVA CAI EM `micro`, nunca em `resultado`. O Google
 * acrescenta categoria sem avisar, e o erro de classificar para menos
 * é um número que falta no painel — visível, alguém reclama. O erro
 * para mais é um número inflado que ninguém confere, porque agrada.
 */
export function categoriaDe(id: string | null | undefined): CategoriaDef {
  if (!id) return { id: "UNKNOWN", label: "Não classificada", grupo: "micro" };
  return (
    POR_ID.get(id) ?? {
      id,
      /* O id cru aparece na tela de propósito: um rótulo bonito e
         errado esconde que apareceu categoria que ninguém mapeou. */
      label: id.toLowerCase().replace(/_/g, " "),
      grupo: "micro",
    }
  );
}

export function ehResultado(id: string | null | undefined): boolean {
  return categoriaDe(id).grupo === "resultado";
}

export interface LinhaDeConversao {
  category: string | null;
  /** O que o Google chama de "Todas as conversões". */
  allConversions: number;
}

export interface ResumoDeConversoes {
  /** Por categoria, só o que é resultado, do maior para o menor. */
  resultados: { id: string; label: string; total: number }[];
  /** Por categoria, os passos do meio. */
  micros: { id: string; label: string; total: number }[];
  /** Soma dos resultados — o número que vale como entrega. */
  totalDeResultados: number;
}

/**
 * Agrupa as linhas do banco no que a tela mostra.
 *
 * ⚠️ `totalDeResultados` NÃO inclui micro, e é o único total que este
 * módulo produz. Não existe "total geral" de propósito: ele seria o
 * número do Atacado inflado em 54 vezes, e alguém acabaria usando.
 */
export function resumir(linhas: LinhaDeConversao[]): ResumoDeConversoes {
  const soma = new Map<string, number>();
  for (const l of linhas) {
    const c = categoriaDe(l.category);
    soma.set(c.id, (soma.get(c.id) ?? 0) + l.allConversions);
  }

  const emLista = (grupo: GrupoDaConversao) =>
    [...soma.entries()]
      .filter(([id]) => categoriaDe(id).grupo === grupo)
      .map(([id, total]) => ({ id, label: categoriaDe(id).label, total }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);

  const resultados = emLista("resultado");

  return {
    resultados,
    micros: emLista("micro"),
    totalDeResultados: resultados.reduce((a, x) => a + x.total, 0),
  };
}
