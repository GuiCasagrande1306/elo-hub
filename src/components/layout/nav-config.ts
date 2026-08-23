import {
  BarChart3,
  Building2,
  Handshake,
  CheckSquare,
  FileText,
  Landmark,
  LayoutGrid,
  Repeat,
  NotebookPen,
  MessagesSquare,
  Settings,
  Share2,
  TriangleAlert,
  Users,
  Workflow,
} from "lucide-react";

/**
 * Navegação declarada em um só lugar: a sidebar e a barra inferior do
 * mobile consomem esta lista, então não existe divergência entre as duas.
 *
 * `adminOnly` esconde o item da interface para colaboradores. É apenas
 * cosmético — quem barra o acesso de fato é o RLS no banco.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  adminOnly?: boolean;
  /** Também fica ativo em subrotas (/clientes/verdi). */
  matchPrefix?: boolean;
  /**
   * Fica de fora da barra inferior do mobile, mesmo pertencendo a um
   * grupo que entra nela. Existe porque a barra é o recurso mais
   * escasso da interface — ver `FORA_DA_BARRA_MOBILE`.
   */
  foraDaBarraMobile?: boolean;
}

export interface NavGroup {
  /** Título da seção. `null` = grupo sem rótulo. */
  label: string | null;
  items: NavItem[];
}

/**
 * Navegação agrupada por FINALIDADE, não por frequência de uso.
 *
 * "Operação" é o que se faz com a conta do cliente; "Análise" é o que se
 * olha depois; "Sistema" é o que quase nunca se toca. Dez links soltos
 * obrigam a ler todos para achar um — com três palavras de seção, a
 * busca vira escolher o bloco e depois a linha.
 *
 * A ordem dentro de Operação segue o dia: abre o cliente, roda a
 * esteira, anota a tarefa.
 */
export const navGroups: NavGroup[] = [
  {
    /* O "Principal" do pedido ficou sem rótulo: um título sobre um item
       só gasta duas linhas de altura para repetir o que o próprio item
       já diz. O espaço até o bloco seguinte já separa. */
    label: null,
    items: [{ href: "/", label: "Visão geral", icon: LayoutGrid }],
  },
  {
    label: "Operação",
    items: [
      /* Comercial vem ANTES de Clientes, e a ordem é o argumento: o dia
         começa em quem ainda não fechou. Depois de Clientes, o funil
         viraria o link que ninguém abre. */
      { href: "/comercial", label: "Comercial", icon: Handshake, matchPrefix: true },
      { href: "/clientes", label: "Clientes", icon: Users, matchPrefix: true },
      { href: "/esteira", label: "Esteira", icon: Repeat, matchPrefix: true },
      { href: "/tarefas", label: "Tarefas", icon: CheckSquare, matchPrefix: true },
      /* Conteúdo fecha Operação, e não Análise: o brief é o que se
         combina com o cliente antes de gravar, não o que se olha
         depois. Fica ao lado de Mídias sociais no fluxo real —
         primeiro o documento define a linha, depois o calendário
         agenda a peça. */
      {
        href: "/conteudo",
        label: "Conteúdo",
        icon: NotebookPen,
        matchPrefix: true,
        /* Fora da barra do mobile pelo motivo descrito em
           `FORA_DA_BARRA_MOBILE`: ela já carrega sete itens e o oitavo
           trunca o rótulo de todos. Custa uma tela boa de celular — o
           roteiro é lido no aparelho, na hora de gravar — mas o custo
           de truncar recai sobre os sete destinos do dia a dia. Chega-se
           por ⌘K, pelo menu lateral, ou pelo link que já está no grupo
           de WhatsApp da gravação. */
        foraDaBarraMobile: true,
      },
    ],
  },
  {
    label: "Análise",
    items: [
      { href: "/performance", label: "Performance", icon: BarChart3 },
      { href: "/relatorios", label: "Relatórios", icon: FileText, matchPrefix: true },
      // Não é adminOnly: quem gerencia a conta precisa ver antes de o
      // anúncio cair, e saldo de mídia não é dado financeiro da agência.
      { href: "/alertas-saldo", label: "Alertas de saldo", icon: TriangleAlert },
    ],
  },
  {
    /* Ferramentas que a agência opera mas que não são o painel: vivem
       num grupo próprio para não competir com Operação e Análise, que
       são o dia a dia. */
    label: "Apps parceiros",
    items: [
      {
        href: "/midias-sociais",
        label: "Mídias sociais",
        icon: Share2,
        matchPrefix: true,
      },
      {
        href: "/elozap",
        label: "EloZap",
        icon: MessagesSquare,
        matchPrefix: true,
      },
      { href: "/elochat", label: "EloChat", icon: Workflow },
    ],
  },
  {
    label: "Sistema",
    items: [
      // `adminOnly` some com o item para colaborador — mas é cosmético.
      // Quem barra de fato é o `redirect` no Server Component e, abaixo
      // dele, a policy `financial_admin_only` no Postgres.
      {
        href: "/gestao",
        label: "Gestão",
        icon: Landmark,
        adminOnly: true,
        // `/gestao/recorrencia` é subpágina: sem o prefixo, o item da
        // sidebar apagaria ao entrar nela.
        matchPrefix: true,
      },
      {
        href: "/gestao/agencias",
        label: "Agências",
        icon: Building2,
        adminOnly: true,
      },
      { href: "/configuracoes/equipe", label: "Equipe", icon: Users, adminOnly: true },
      { href: "/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
    ],
  },
];

/**
 * Lista plana, para a barra inferior do mobile.
 *
 * DERIVADA dos grupos, não escrita à mão: enquanto eram duas listas
 * independentes, um link novo entrava numa e faltava na outra.
 *
 * Duas seções ficam de fora, por motivos diferentes. "Sistema" porque
 * ninguém abre Gestão do celular. "Apps parceiros" por espaço: a barra
 * já carrega sete itens e um oitavo truncaria o rótulo de todos.
 *
 * Mídias sociais funciona bem no celular — a agenda substitui a grade
 * abaixo de `lg` — e mesmo assim não entra aqui: o custo recai sobre os
 * sete destinos do dia a dia. Chega-se a ela pelo menu lateral ou pelo
 * ⌘K, que lê desta mesma lista.
 */
const FORA_DA_BARRA_MOBILE = new Set(["Sistema", "Apps parceiros"]);

export const primaryNav: NavItem[] = navGroups
  .filter((g) => !FORA_DA_BARRA_MOBILE.has(g.label ?? ""))
  .flatMap((g) => g.items)
  .filter((item) => !item.foraDaBarraMobile);

export const secondaryNav: NavItem[] =
  navGroups.find((g) => g.label === "Sistema")?.items ?? [];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
