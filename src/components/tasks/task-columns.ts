import { TASK_COLUMNS } from "./task-meta";
import type { TaskWithRelations } from "@/types/database";

/* =====================================================================
   Catálogo de colunas da tabela de tarefas
   ---------------------------------------------------------------------
   A grade era uma STRING CSS FIXA:

     grid-cols-[28px_1fr_150px_44px_128px_84px_92px_96px_44px_28px]

   Funcionava e travava tudo o que se pede de uma tabela: esconder uma
   coluna deixaria um buraco de 128px, porque a largura estava escrita à
   mão e não sabia quais células existiam. Ordenar exigiria um `sort`
   diferente por coluna, espalhado pelo componente.

   Aqui cada coluna declara a própria largura, o rótulo e COMO SE ORDENA
   por ela. A grade passa a ser derivada das visíveis, e ordenar vira
   escolher um `id`. Uma coluna nova é uma entrada nesta lista, não uma
   edição em quatro lugares.

   `concluir` e `titulo` NÃO estão aqui: são fixas. Uma tabela de tarefas
   sem o título não é uma tabela — deixar escondê-lo é oferecer um
   estado em que a tela não serve para nada.
   ===================================================================== */

export type ColunaId =
  | "cliente"
  | "responsaveis"
  | "status"
  | "tempo"
  | "criticidade"
  | "prazo"
  | "cor";

export interface Coluna {
  id: ColunaId;
  label: string;
  /** Trilha da grade, no formato de `grid-template-columns`. */
  largura: string;
  /** `false` = a coluna existe mas não faz sentido ordenar por ela. */
  ordenavel: boolean;
  /**
   * Chave de ordenação. Devolve string ou número comparável.
   *
   * Tarefa sem valor tem de ir para o FIM em ordem crescente, não para o
   * começo: uma lista ordenada por prazo que abre com dez tarefas sem
   * data esconde justamente o que vence amanhã. Daí os sentinelas altos.
   */
  chave: (t: TaskWithRelations) => string | number;
}

const ORDEM_STATUS = new Map(
  TASK_COLUMNS.map((c, i) => [c.status, i] as const),
);

export const COLUNAS: Coluna[] = [
  {
    id: "cliente",
    label: "Cliente",
    largura: "150px",
    ordenavel: true,
    // "zzz" joga quem não tem cliente para o fim.
    chave: (t) => t.client?.name?.toLowerCase() ?? "zzz",
  },
  {
    id: "responsaveis",
    label: "Resp.",
    largura: "56px",
    ordenavel: true,
    /* Pelo PRIMEIRO responsável, em ordem alfabética. Ordenar por
       quantidade seria a leitura errada: ninguém procura "tarefas com
       três pessoas", procura "as do Rafael". */
    chave: (t) =>
      t.assignees[0]?.full_name?.toLowerCase() ?? "zzz",
  },
  {
    id: "status",
    label: "Status",
    largura: "128px",
    ordenavel: true,
    /* Pela ordem do QUADRO (backlog → a fazer → …), não alfabética.
       "A fazer" antes de "Backlog" no dicionário inverte o fluxo de
       trabalho que a coluna representa. */
    chave: (t) => ORDEM_STATUS.get(t.status) ?? 99,
  },
  {
    id: "tempo",
    label: "Tempo",
    largura: "84px",
    ordenavel: true,
    chave: (t) => t.tracked_seconds,
  },
  {
    id: "criticidade",
    label: "Criticidade",
    largura: "136px",
    ordenavel: true,
    chave: (t) => t.criticality,
  },
  {
    id: "prazo",
    label: "Prazo",
    largura: "96px",
    ordenavel: true,
    chave: (t) => t.due_date ?? "9999-12-31",
  },
  {
    id: "cor",
    label: "Cor",
    largura: "28px",
    ordenavel: false,
    chave: (t) => t.color_tag ?? "zzz",
  },
];

export const COLUNA_POR_ID = new Map(COLUNAS.map((c) => [c.id, c]));

/** Todas visíveis — o estado em que a tela estava antes de dar escolha. */
export const COLUNAS_PADRAO: ColunaId[] = COLUNAS.map((c) => c.id);

export interface Ordenacao {
  /** `null` = ordem natural do grupo (prazo em aberto, conclusão em feito). */
  coluna: ColunaId | null;
  direcao: "asc" | "desc";
}

export const ORDENACAO_PADRAO: Ordenacao = { coluna: null, direcao: "asc" };

/**
 * Monta o `grid-template-columns` a partir do que está visível.
 *
 * Sempre com as duas fixas na frente: caixa de concluir e título.
 */
export function gradeDeColunas(visiveis: ColunaId[]): string {
  const trilhas = COLUNAS.filter((c) => visiveis.includes(c.id)).map(
    (c) => c.largura,
  );
  return `28px 1fr ${trilhas.join(" ")}`;
}

/**
 * Ordena respeitando a escolha do usuário — ou a natural do grupo.
 *
 * A natural é diferente por grupo e não é capricho: em aberto o que
 * importa é o que vence primeiro; em concluído, o que saiu por último.
 */
export function ordenarTarefas(
  tarefas: TaskWithRelations[],
  ordenacao: Ordenacao,
  concluido: boolean,
): TaskWithRelations[] {
  const copia = [...tarefas];

  if (!ordenacao.coluna) {
    return copia.sort((a, b) =>
      concluido
        ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
        : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    );
  }

  const coluna = COLUNA_POR_ID.get(ordenacao.coluna);
  if (!coluna) return copia;

  const sinal = ordenacao.direcao === "asc" ? 1 : -1;

  return copia.sort((a, b) => {
    const x = coluna.chave(a);
    const y = coluna.chave(b);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sinal;
    return String(x).localeCompare(String(y), "pt-BR") * sinal;
  });
}
