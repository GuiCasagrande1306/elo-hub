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

export const primaryNav: NavItem[] = [
  { href: "/", label: "Visão geral", icon: LayoutGrid },
  { href: "/clientes", label: "Clientes", icon: Users, matchPrefix: true },
  { href: "/tarefas", label: "Tarefas", icon: CheckSquare, matchPrefix: true },
  { href: "/relatorios", label: "Relatórios", icon: FileText, matchPrefix: true },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  // Não é adminOnly: quem gerencia a conta precisa ver antes de o
  // anúncio cair, e saldo de mídia não é dado financeiro da agência.
  { href: "/esteira", label: "Esteira", icon: Repeat, matchPrefix: true },
  { href: "/alertas-saldo", label: "Alertas de saldo", icon: TriangleAlert },
];

export const secondaryNav: NavItem[] = [
  // `adminOnly` some com o item para colaborador — mas é cosmético. Quem
  // barra de fato é o `redirect` no Server Component e, abaixo dele, a
  // policy `financial_admin_only` no Postgres.
  { href: "/gestao", label: "Gestão", icon: Landmark, adminOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
