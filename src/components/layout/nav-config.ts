import {
  BarChart3,
  Building2,
  CheckSquare,
  FileText,
  Inbox,
  Landmark,
  LayoutGrid,
  Repeat,
  Settings,
  Stamp,
  TriangleAlert,
  Users,
  Wallet,
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
  /**
   * `href` é uma URL absoluta, para fora do Hub.
   *
   * Muda o comportamento em dois lugares: a sidebar desenha `<a
   * target="_blank">` em vez de `Link`, e o ⌘K abre aba nova em vez de
   * `router.push`. O item também nunca fica ativo — `isNavActive`
   * compara com o `pathname`, que jamais será uma URL absoluta.
   */
  externo?: boolean;
  /** Só aparece para usuário de cliente. */
  soCliente?: boolean;
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
    items: [{ href: "/painel", label: "Visão geral", icon: LayoutGrid }],
  },
  {
    label: "Operação",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users, matchPrefix: true },
      /* Leads só aparece para usuário de cliente: é a página inicial dele
         (`/` redireciona para cá). A equipe não usa mais pelo menu. */
      {
        href: "/leads",
        label: "Leads",
        icon: Inbox,
        matchPrefix: true,
        soCliente: true,
      },
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
    /* Ferramentas que a agência opera mas que não são o painel: vivem
       num grupo próprio para não competir com Operação e Análise, que
       são o dia a dia. */
    label: "Apps parceiros",
    items: [
      /* O CARIMBO SUBSTITUIU A TELA DE MÍDIAS SOCIAIS, em 29/09/2026.
         O módulo interno planejava, colhia a aprovação e registrava o
         que foi ao ar — e não publicava, por desenho. O Carimbo faz as
         três coisas E publica no Instagram e no Facebook, então manter
         os dois deixava duas agendas disputando a mesma pauta, com a
         que publica sendo sempre a verdadeira. */
      {
        href: "https://carimbo.marketingelo.com.br",
        label: "Carimbo",
        icon: Stamp,
        externo: true,
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
      /* FINANCEIRO E GESTÃO CONVIVEM, por ora. `/financeiro` é o lugar
         novo do dinheiro da agência — histórico mês a mês e meta de
         gasto por categoria —, e `/gestao` segue no menu porque ainda é
         a única porta para `/gestao/recorrencia`, que não tem item
         próprio. Quando a recorrência mudar de casa, a Gestão sai. */
      {
        href: "/financeiro",
        label: "Financeiro",
        icon: Wallet,
        adminOnly: true,
      },
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
      /* Acesso de CLIENTE é lista à parte da Equipe de propósito: as
         duas mexem em `profiles`, mas uma responde "quem da Elo faz o
         quê" e a outra "quem de fora vê a base de quem". Juntas, um
         clique errado troca uma coisa pela outra. */
      /* SEM `adminOnly`, e é intencional. A página já sabe se virar com
         colaborador: mostra "Meu WhatsApp", que é a única seção que
         qualquer perfil aciona, e avisa que o resto é restrito. Quem
         limita o que aparece ali é o RLS.

         Enquanto isto era adminOnly, o colaborador tinha a tela pronta
         e nenhum caminho até ela — o WhatsApp pessoal dele, que é o que
         dispara relatório e aviso de saldo em nome dele, dependia de
         alguém mandar o link. */
      { href: "/configuracoes", label: "Configurações", icon: Settings },
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
 * O Carimbo reforça o caso de "Apps parceiros" ficar fora: é outro
 * sistema, e um dos sete espaços da barra gasto num atalho que troca de
 * aplicativo é o pior uso possível dele. Chega-se aos dois pelo menu
 * lateral ou pelo ⌘K, que lê desta mesma lista.
 */
const FORA_DA_BARRA_MOBILE = new Set(["Sistema", "Apps parceiros"]);

export const primaryNav: NavItem[] = navGroups
  .filter((g) => !FORA_DA_BARRA_MOBILE.has(g.label ?? ""))
  .flatMap((g) => g.items)
  .filter((item) => !item.foraDaBarraMobile);

export const secondaryNav: NavItem[] =
  navGroups.find((g) => g.label === "Sistema")?.items ?? [];

/**
 * O que um usuário de CLIENTE enxerga — e é só isto.
 *
 * A lista é de permissão, não de bloqueio: um módulo novo da agência
 * nasce invisível para o cliente sem ninguém precisar lembrar de
 * escondê-lo. O inverso — listar o que esconder — erra por omissão, e o
 * erro por omissão aqui é mostrar a carteira inteira para quem é de
 * fora.
 *
 * Continua sendo cosmético: quem barra o acesso é a policy no Postgres.
 * Isto evita oferecer uma porta que o banco vai fechar na cara.
 */
const NAV_DO_CLIENTE = new Set([
  /* O funil dele. É a página inicial de quem entra com papel 'client' —
     `/` redireciona para cá. */
  "/leads",
  /* Perfil, senha e o WhatsApp da própria pessoa. A tela já se recorta
     sozinha por papel; o que é da agência lá dentro é barrado pelo RLS. */
  "/configuracoes",
]);

export function podeVerNav(item: NavItem, role: string): boolean {
  /* ⚠️ ESTE RAMO É O QUE FAZ A LISTA SER DE PERMISSÃO. Enquanto ele não
     existia, o comentário acima descrevia uma regra que o código não
     aplicava: um usuário de cliente via Comercial, Clientes, Esteira e
     Performance no menu. Nenhuma delas devolveria dado — o RLS já
     continha tudo —, mas oferecer sete portas fechadas faz o sistema
     parecer quebrado para quem é de fora da agência.

     Ampliar esta lista é decisão POR TELA, não por módulo: cada página
     que entrar aqui precisa ser lida antes, procurando o que ela mostra
     quando o RLS devolve vazio e o que ela oferece de ação que é da
     agência (enviar relatório, editar cadastro, ver contrato). */
  if (role === "client") return NAV_DO_CLIENTE.has(item.href);
  if (item.soCliente) return false;

  return !item.adminOnly || role === "admin";
}

/**
 * A barra inferior do celular, já recortada pelo papel.
 *
 * Recebe o papel porque a barra é a ÚNICA navegação abaixo de 768px: sem
 * o filtro, o celular de um usuário de cliente mostraria os seis
 * destinos da agência enquanto a sidebar do desktop mostra um.
 */
export function navDoMobile(role: string): NavItem[] {
  /* Para o cliente, a lista sai dos GRUPOS e não de `primaryNav`, e
     `foraDaBarraMobile` é ignorado de propósito. Aquela marca resolve
     uma disputa por largura que só existe com sete destinos; aplicá-la
     a uma barra de dois itens esconderia justamente a tela pela qual a
     pessoa entrou no sistema. */
  if (role === "client") {
    return navGroups
      .flatMap((g) => g.items)
      .filter((item) => podeVerNav(item, role));
  }

  return primaryNav.filter((item) => podeVerNav(item, role));
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
}
