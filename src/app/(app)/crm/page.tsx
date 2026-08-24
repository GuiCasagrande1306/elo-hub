import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Database } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { LeadsWorkspace } from "@/components/leads/leads-workspace";
import { carregarQuadro, clienteDoQuadro } from "@/lib/crm/queries";
import { carregarThread, listarConversas } from "@/lib/crm/conversas";
import { getClients, getTeam } from "@/lib/data";
import { isDemoMode } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "CRM" };

/* =====================================================================
   /crm — o funil de vendas DO CLIENTE
   ---------------------------------------------------------------------
   NÃO CONFUNDIR COM `/comercial`, que é o funil da agência: lá o negócio
   é o contrato que a Elo quer fechar, com mensalidade e taxa de setup.
   Aqui o negócio é o cliente do nosso cliente — o orçamento de cozinha
   do marceneiro, a matrícula da academia. Duas coisas diferentes, com
   donos diferentes, e por isso duas telas.

   A MESMA ROTA SERVE OS DOIS PÚBLICOS. A pessoa da agência chega com
   `?cliente=<uuid>` e troca de funil pelo seletor; a pessoa do cliente
   chega sem nada e cai na própria empresa, porque `clienteDoQuadro`
   IGNORA o parâmetro para quem tem papel `client`. Trocar o uuid na
   barra de endereço não leva a lugar nenhum — e, mesmo que levasse, a
   RLS recusaria a leitura.
   ===================================================================== */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; aba?: string; conversa?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { cliente, aba: abaPedida, conversa: conversaPedida } = await searchParams;

  /* O `?cliente=` PRECISA SER UM UUID antes de chegar ao banco.
     Sem esta peneira, um link truncado no WhatsApp — ou o `c-verdi` dos
     dados de demonstração — vira `invalid input syntax for type uuid`,
     que o Postgres devolve como ERRO e a página transforma em "Alguma
     coisa quebrou nesta tela". Endereço inválido não é falha do
     sistema: é para voltar ao seletor. */
  const pedido = cliente && UUID.test(cliente) ? cliente : null;
  const { clientId, ehCliente } = await clienteDoQuadro(pedido);

  /* Usuário de cliente SEM empresa vinculada é erro de cadastro, não
     estado normal: alguém criou o acesso e esqueceu do `client_id`.
     Dizer isso é melhor que mostrar um quadro vazio que parece um funil
     sem leads. */
  if (ehCliente && !clientId) {
    return (
      <PageContainer>
        <PageHeader title="CRM" description="Seu funil de vendas." />
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <Database className="size-5 text-warning" />
          <div>
            <h2 className="text-sm font-semibold">Acesso sem empresa vinculada</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Seu usuário existe, mas não está ligado a nenhuma empresa. Fale
              com a Elo Marketing para concluir o cadastro.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  /* MODO DEMO NÃO TEM FUNIL. Os dados de demonstração vivem em memória
     (`lib/mock/data`) e o CRM é o único módulo que lê direto do
     Postgres sob RLS — de propósito, porque é onde a base de um cliente
     não pode encostar na de outro. Inventar um funil falso aqui
     duplicaria essa leitura só para a vitrine. */
  if (isDemoMode) {
    return (
      <PageContainer>
        <PageHeader title="CRM" description="O funil de vendas de cada cliente." />
        <div className="surface-card mt-7 flex flex-col items-start gap-3 p-6">
          <Database className="size-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Sem demonstração por aqui</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              O CRM lê direto do banco, com a separação por empresa garantida
              pelo Postgres. No modo demo não há banco — entre com a conta real
              para usar o funil.
            </p>
          </div>
        </div>
      </PageContainer>
    );
  }

  const [clients, equipe] = await Promise.all([
    /* A lista já vem filtrada pela policy: colaborador recebe só a
       carteira dele, e usuário de cliente recebe uma linha só. Não há
       filtro cosmético em cima disso. */
    getClients(),
    getTeam(),
  ]);

  /* Sem funil ainda? `carregarQuadro` devolve `pipeline: null` e a área
     de trabalho oferece o botão de criar. Não criamos aqui de forma
     automática: uma leitura de página que escreve no banco transforma
     cada abertura de tela — inclusive a de quem só estava conferindo —
     numa gravação. */
  const quadro = clientId
    ? await carregarQuadro(clientId)
    : { pipeline: null, stages: [], deals: [], contacts: [] };

  /* A CAIXA DE ENTRADA É CARREGADA SEMPRE, mesmo na aba do funil: o
     contador de não lidas fica na aba, e uma aba que só sabe quantas
     mensagens chegaram depois de ser clicada não avisa ninguém de
     nada. São duas consultas pequenas, com índice. */
  const conversas = clientId ? await listarConversas(clientId) : [];

  /* A conversa aberta precisa estar NA LISTA. Sem esta checagem, um
     `?conversa=` com o uuid de outra empresa faria a página tentar
     carregar a thread — a RLS devolveria vazio, mas a tela mostraria um
     cabeçalho de conversa que não existe. */
  const conversaAberta =
    conversas.find((c) => c.id === conversaPedida) ?? null;

  const thread = conversaAberta ? await carregarThread(conversaAberta.id) : [];

  const aba = abaPedida === "conversas" ? "conversas" : "funil";

  return (
    <PageContainer>
      <PageHeader
        title="CRM"
        description={
          ehCliente
            ? "Seus contatos, do primeiro oi até o fechamento."
            : "O funil de vendas de cada cliente — o que a agência entrega junto com a mídia."
        }
      />

      <div className="mt-7">
        <LeadsWorkspace
          clients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            brand_primary: c.brand_primary,
          }))}
          clientId={clientId}
          ehCliente={ehCliente}
          ehAdmin={user.role === "admin"}
          pipeline={quadro.pipeline}
          stages={quadro.stages}
          deals={quadro.deals}
          equipe={equipe.map((p) => ({ id: p.id, full_name: p.full_name }))}
          aba={aba}
          conversas={conversas}
          conversaAberta={conversaAberta}
          thread={thread}
        />
      </div>
    </PageContainer>
  );
}
