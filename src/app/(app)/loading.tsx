import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/* =====================================================================
   Estado de carregamento das telas internas
   ---------------------------------------------------------------------
   UM arquivo para as 24 páginas: `loading.tsx` embrulha a página e TUDO
   que estiver abaixo dela num `<Suspense>`, e a barra lateral e o topo
   ficam vivos porque moram no layout, que não é embrulhado.

   POR QUE ISTO É A MAIOR CORREÇÃO DE VELOCIDADE DO PROJETO, embora não
   torne nada mais rápido de verdade. Todas as 24 rotas são dinâmicas, e
   a documentação do Next instalado é explícita sobre o que acontece sem
   este arquivo:

     "Dynamic Route: prefetching is skipped, or the route is partially
      prefetched if loading.tsx is present. […] waiting for a server
      response before navigation can give the users the impression that
      the app is not responding."

   Ou seja, faltando o arquivo o Next NEM TENTA pré-buscar essas rotas, e
   o clique deixa a pessoa parada na página velha, sem sinal nenhum, até
   o servidor terminar. Medido em produção: de 1,6s a 3,3s do clique até
   a tela trocar — o tempo todo com a página anterior à mostra, o que se
   lê como travamento e não como carregamento.

   O ESQUELETO É GENÉRICO DE PROPÓSITO. Cada tela tem um corpo
   diferente — grade, tabela, cartões —, e um esqueleto que tentasse
   imitar a página certa erraria em 23 delas. O que ele reproduz é o que
   TODAS têm em comum: o ritmo do cabeçalho e um bloco de conteúdo com a
   mesma largura e o mesmo respiro. O título é o único texto de verdade,
   porque ele é a resposta imediata a "meu clique funcionou?".
   ===================================================================== */

export default function Loading() {
  return (
    <PageContainer>
      {/* `aria-busy` e `sr-only`: para quem usa leitor de tela, o
          esqueleto é invisível — sem isto a navegação fica muda. */}
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando a página…</span>

        <PageHeader
          title="Carregando…"
          description="Buscando os dados desta tela."
        />

        <div className="mt-7 flex flex-col gap-4">
          {/* Tira de indicadores: quase toda tela do painel abre com
              uma. Três colunas é o que o `grid` das telas usa. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))}
          </div>

          {/* Barra de ações. */}
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-44 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="ml-auto h-9 w-28 rounded-lg" />
          </div>

          {/* Corpo. Altura fixa para a página não pular quando o
              conteúdo real entrar — o salto é pior que a espera. */}
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      </div>
    </PageContainer>
  );
}
