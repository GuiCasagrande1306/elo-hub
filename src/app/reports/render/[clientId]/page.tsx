import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FolhaDeRolagem } from "@/components/reports/folha-de-rolagem";
import { PrintToolbar } from "./print-toolbar";
import { getPrintReportData } from "@/lib/reports/print-data";
import { resolverAgencia } from "@/lib/reports/payload";
import { verifyPrintToken } from "@/lib/reports/print-token";
import { resolvePeriod } from "@/lib/date-br";

/* =====================================================================
   Rota interna do relatório
   ---------------------------------------------------------------------
   Fotografada pelo Puppeteer e também aberta pela equipe para revisar.

   O DESENHO NÃO MORA MAIS AQUI: está em
   `components/reports/folha-de-rolagem.tsx`, compartilhado com o link
   público. Esta rota cuida só do que é dela — quem pode entrar e qual
   período mostrar.

   POR QUE ROLAGEM E NÃO A4. Até 27/09/2026 esta página desenhava três
   folhas A4. O relatório é lido no WhatsApp, no celular, com o polegar
   — e A4 num celular é uma folha inteira reduzida a um quinto do
   tamanho, em que ninguém lê um rótulo de eixo. A folha contínua é uma
   página só, larga de 1080pt, com a altura que o conteúdo pedir; o
   Puppeteer mede essa altura e imprime uma página exata.

   ⚠️ UM RENDERIZADOR SÓ. Esta página é a fonte do PDF que vai ao cliente
   E a tela que a equipe revisa antes de enviar. Não é economia de
   código: enquanto existiam duas, a revisão aprovava um desenho e o
   cliente recebia outro, e isso aconteceu quatro vezes — a lista está
   em `lib/reports/serie-do-grafico.ts`.

   NÃO usa os tokens do design system (`bg-background`, `text-foreground`).
   O documento é sempre claro: herdando o tema, um gestor com o sistema
   no escuro geraria um PDF de fundo navy. As cores aqui são fixas — só
   a da MARCA DO CLIENTE é dinâmica.

   `print-color-adjust: exact` é obrigatório: sem ele o Chrome descarta
   fundos e o cabeçalho sai branco.
   ===================================================================== */

/**
 * `title.absolute` NÃO é detalhe de SEO — é vazamento de marca.
 *
 * Sem título próprio, esta rota herda o `default` do layout raiz, que é
 * "Elo Hub". O Chrome grava `document.title` no campo /Title do PDF: o
 * arquivo que chega ao cliente de uma agência parceira sairia chamado
 * "Elo Hub" nas Propriedades, e não há a string "Elo" em nenhum outro
 * lugar do documento para denunciar isso.
 *
 * `absolute` é obrigatório: sem ele o template "%s · Elo Hub" recola a
 * marca no fim.
 */
export const metadata: Metadata = {
  title: { absolute: "Relatório de performance" },
  robots: { index: false, follow: false },
};

export default async function PrintReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ token?: string; inicio?: string; fim?: string }>;
}) {
  const [{ clientId }, query] = await Promise.all([params, searchParams]);

  /* DOIS CAMINHOS DE ACESSO, e eles não são intercambiáveis.
     ---------------------------------------------------------------
     1. TOKEN — o Puppeteer. Chega sem cookie nenhum, então carrega um
        HMAC de vida curta com cliente e período assinados dentro.

     2. SESSÃO — alguém da equipe revisando. Este caminho exige a
        checagem explícita abaixo: `getPrintReportData` usa o cliente
        ADMIN e passa por cima do RLS — correto para o Puppeteer,
        perigoso para um humano. Sem ela, qualquer colaborador logado
        abriria o relatório de qualquer conta sabendo o UUID.

     404 nos dois casos, nunca 403: um 403 confirmaria que o clientId
     existe.

     ⚠️ O LINK PÚBLICO NÃO PASSA POR AQUI. Ele tem rota própria
     (`/relatorio/[token]`), porque a autorização dele é outra coisa:
     um registro revogável em `report_share_links`, não uma sessão nem
     um HMAC de minutos. Misturar os três nesta função foi a primeira
     ideia e seria o jeito mais rápido de um deles herdar a permissão
     do outro. */
  const auth = verifyPrintToken(query.token ?? null);
  const porToken = auth.valid && auth.payload.clientId === clientId;

  if (!porToken && !(await equipePodeVer(clientId))) notFound();

  const { periodStart, periodEnd } = porToken
    ? auth.payload
    : periodoDaQuery(query.inicio, query.fim);

  const data = await getPrintReportData(clientId, periodStart, periodEnd);
  if (!data) notFound();

  const agency = await resolverAgencia(data.client.agency_partner);

  return (
    <>
      {/* Só para quem abriu no navegador. O Puppeteer chega com token e
          nunca vê esta barra. */}
      {!porToken && <PrintToolbar />}
      <FolhaDeRolagem data={data} agency={agency} />
    </>
  );
}

/**
 * A pessoa logada enxerga esta conta?
 *
 * A consulta usa a chave ANON e o JWT da sessão, então quem decide é a
 * policy do Postgres. Um colaborador fora da carteira recebe zero linhas
 * e cai no `notFound`.
 */
async function equipePodeVer(clientId: string): Promise<boolean> {
  const { getCurrentUser, createSupabaseServerClient } = await import(
    "@/lib/supabase/server"
  );

  const user = await getCurrentUser();
  if (!user) return false;

  const { isDemoMode } = await import("@/lib/env");
  if (isDemoMode) return true;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Período quando o acesso é humano.
 *
 * Data malformada cai nos últimos 30 dias em vez de derrubar a página:
 * quem abriu quer revisar um documento, e um erro aqui deixaria a aba em
 * branco sem dizer o motivo. O intervalo aparece impresso no cabeçalho,
 * então um padrão errado é visível, não silencioso.
 */
function periodoDaQuery(
  inicio?: string,
  fim?: string,
): { periodStart: string; periodEnd: string } {
  const DATA = /^\d{4}-\d{2}-\d{2}$/;

  if (inicio && fim && DATA.test(inicio) && DATA.test(fim) && inicio <= fim) {
    return { periodStart: inicio, periodEnd: fim };
  }

  const { start, end } = resolvePeriod("30d");
  return { periodStart: start, periodEnd: end };
}
