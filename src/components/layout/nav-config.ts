import {
  BarChart3,
  CheckSquare,
  FileText,
  Landmark,
  LayoutGrid,
  Repeat,
  Settings,
  TriangleAlert,
  Users,
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
      { href: "/clientes", label: "Clientes", icon: Users, matchPrefix: true },
      { href: "/esteira", label: "Esteira", icon: Repeat, matchPrefix: true },
      { href: "/tarefas", label: "Tarefas", icon: CheckSquare, matchPrefix: true },
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
    label: "Sistema",
    items: [
      // `adminOnly` some com o item para colaborador — mas é cosmético.
      // Quem barra de fato é o `redirect` no Server Component e, abaixo
      // dele, a policy `financial_admin_only` no Postgres.
      { href: "/gestao", label: "Gestão", icon: Landmark, adminOnly: true },
      { href: "/configuracoes/equipe", label: "Equipe", icon: Users, adminOnly: true },
      { href: "/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
    ],
  },
];

/**
 * Lista plana, para a barra inferior do mobile.
 *
 * DERIVADA dos grupos, não escrita à mão: enquanto eram duas listas
 * independentes, um link novo entrava numa e faltava na outra. "Sistema"
 * fica de fora porque a barra do mobile cabe poucos ícones e ninguém
 * abre Gestão do celular.
 */
export const primaryNav: NavItem[] = navGroups
  .filter((g) => g.label !== "Sistema")
  .flatMap((g) => g.items);

export const secondaryNav: NavItem[] =
  navGroups.find((g) => g.label === "Sistema")?.items ?? [];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
