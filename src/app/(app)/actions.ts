"use server";

import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { escaparIlike } from "@/lib/search/match";

/* =====================================================================
   Busca global — a parte que precisa do banco
   ---------------------------------------------------------------------
   SÓ TAREFAS FICAM AQUI, e isso é o ponto do arquivo.

   Os clientes já estão no navegador: o `AppLayout` carrega a carteira
   inteira para a sidebar, JÁ FILTRADA PELO RLS, e passa para o shell.
   Consultar o Postgres com `ilike '%parma%'` devolveria exatamente a
   mesma lista, 300 ms depois, com uma dependência de rede no caminho —
   e o caso de uso é justamente "aperta ⌘K, digita três letras, Enter".

   Tarefa é diferente: são milhares, não cabem no shell, e o que se busca
   costuma ser uma frase inteira do título.

   LIMITAÇÃO CONHECIDA: `ilike` não ignora acento, então "relatorio" não
   acha "Relatório" — só a busca de cliente, que roda no navegador, é
   tolerante a acento. Resolver isso no banco pede a extensão `unaccent`
   e uma função RPC (o PostgREST não chama função dentro de filtro), o
   que é uma migration a mais. Fica registrado como escolha, não
   esquecimento.

   AUTORIZAÇÃO É O RLS. Esta ação usa o cliente da SESSÃO, não o
   `service_role`, então um colaborador recebe apenas as tarefas em que
   foi atribuído — o mesmo recorte de `getTasks`. Uma checagem de papel
   aqui seria uma segunda fonte de verdade sobre permissão, e a que fica
   desatualizada é sempre a da aplicação.
   ===================================================================== */

export interface TarefaEncontrada {
  id: string;
  title: string;
  status: string;
  clientName: string | null;
}

/** Dois caracteres não selecionam nada: `%a%` traz a tabela inteira. */
const MINIMO = 2;

/** Teto de linhas. A paleta mostra uma lista curta, não um relatório. */
const LIMITE = 6;

export async function buscarTarefas(
  termo: string,
): Promise<TarefaEncontrada[]> {
  const busca = termo.trim();
  if (busca.length < MINIMO) return [];

  if (isDemoMode) {
    const { demoTasks, demoCurrentUser } = await import("@/lib/mock/data");

    /* Espelha o RLS em memória, como `getTasks` já faz: sem isto o modo
       demonstração mostraria na busca tarefas que o quadro esconde. */
    const visiveis =
      demoCurrentUser.role === "admin"
        ? demoTasks
        : demoTasks.filter((t) =>
            t.assignees.some((a) => a.id === demoCurrentUser.id),
          );

    /* Substring simples, sem tirar acento, PORQUE É O QUE O `ilike` FAZ
       abaixo. Usar aqui o casamento tolerante de `pontuar` faria a
       demonstração achar "relatorio" em "Relatório" e a produção não —
       e a diferença só apareceria com o cliente na frente. */
    const alvo = busca.toLowerCase();

    return visiveis
      .filter((t) => t.title.toLowerCase().includes(alvo))
      .slice(0, LIMITE)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        clientName: t.client?.name ?? null,
      }));
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, client:clients(name)")
    .ilike("title", `%${escaparIlike(busca)}%`)
    /* Concluída por último: quem busca uma tarefa quase sempre quer
       mexer nela, e o que já foi entregue só atrapalha o topo da lista. */
    .order("completed_at", { ascending: true, nullsFirst: true })
    .order("updated_at", { ascending: false })
    .limit(LIMITE);

  /* Devolve vazio em vez de propagar: a paleta é um atalho, e uma falha
     de rede aqui não pode derrubar a navegação — os clientes e os links
     continuam funcionando porque nem passam por esta função. */
  if (error) return [];

  return (data ?? []).map((t) => {
    /* O embed devolve objeto quando a FK é única, mas os tipos gerados
       do PostgREST descrevem relação como array. Normaliza os dois. */
    const cliente = t.client as unknown as
      | { name: string }
      | { name: string }[]
      | null;

    return {
      id: t.id as string,
      title: t.title as string,
      status: t.status as string,
      clientName: Array.isArray(cliente)
        ? (cliente[0]?.name ?? null)
        : (cliente?.name ?? null),
    };
  });
}
