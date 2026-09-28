import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FolhaDeRolagem } from "@/components/reports/folha-de-rolagem";
import { SeletorDePeriodo } from "@/components/reports/seletor-de-periodo";
import { getPrintReportData } from "@/lib/reports/print-data";
import { resolverAgencia } from "@/lib/reports/payload";
import { clienteDoLink, periodoDoLink } from "@/lib/reports/link-publico";
import { dataNoBrasil, somarDiasBR } from "@/lib/date-br";

/* =====================================================================
   O relatório por link — aberto, sem login
   ---------------------------------------------------------------------
   A alternativa ao PDF: em vez de um arquivo fechado num período fixo,
   um endereço onde o cliente escolhe as datas.

   ⚠️ ROTA SEPARADA DA DE RENDER, de propósito. As duas desenham o
   MESMO documento — `FolhaDeRolagem` —, mas autorizam de formas
   completamente diferentes:

     /reports/render/[clientId]   sessão da equipe, ou HMAC de minutos
                                  para o Puppeteer
     /relatorio/[token]           registro revogável em
                                  `report_share_links`, sem sessão

   Juntar as três numa função só foi a primeira ideia e seria o jeito
   mais rápido de uma delas herdar a permissão da outra: bastaria um
   `||` mal colocado para o token público abrir qualquer cliente.

   ⚠️ O TOKEN É A ÚNICA FECHADURA. Quem tem o endereço vê o desempenho
   de mídia da conta. Daí o `noindex` abaixo — um link que caia num
   buscador deixa de ser secreto para sempre — e a revogação, que é o
   que se usa quando o contrato acaba.
   ===================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `noindex` E `nofollow`, e o título sem marca.
 *
 * O título vira o nome da aba que o cliente vê e o que aparece se ele
 * salvar como PDF pelo navegador. Herdar "Elo Hub" daqui entregaria a
 * marca da agência num relatório que pode estar sendo entregue por uma
 * agência parceira — o mesmo cuidado da rota de impressão.
 */
export const metadata: Metadata = {
  title: { absolute: "Relatório de performance" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function RelatorioPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ inicio?: string; fim?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  /* Uma ida ao banco resolve autorização E contagem de visita — ver
     `registrar_visita_do_link`. `null` = token inexistente ou revogado.

     404 e nunca 403: um 403 confirmaria que aquele token já existiu, o
     que é informação de graça para quem estiver tentando. */
  const clientId = await clienteDoLink(token);
  if (!clientId) notFound();

  const { periodStart, periodEnd } = periodoDoLink(query.inicio, query.fim);

  const data = await getPrintReportData(clientId, periodStart, periodEnd);
  if (!data) notFound();

  const agency = await resolverAgencia(data.client.agency_partner);
  const ontem = somarDiasBR(dataNoBrasil(), -1);

  return (
    <div className="min-h-screen bg-[#f2f4f7]">
      <SeletorDePeriodo
        inicio={periodStart}
        fim={periodEnd}
        maximo={ontem}
      />

      {/* Sombra e respiro: aqui a folha é uma página dentro de um
          navegador, não um arquivo. Sem isso ela encosta nas bordas e
          não se lê onde o documento começa. No PDF nada disso existe,
          porque o Puppeteer fotografa só a folha. */}
      <div className="mx-auto w-fit pb-16 shadow-[0_2px_24px_rgba(17,24,39,0.08)]">
        <FolhaDeRolagem data={data} agency={agency} />
      </div>
    </div>
  );
}
