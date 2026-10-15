import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FolhaDeRolagem } from "@/components/reports/folha-de-rolagem";
import { RelatorioInterativo } from "@/components/reports/relatorio-interativo";
import { getPrintReportData } from "@/lib/reports/print-data";
import { resolverAgencia } from "@/lib/reports/payload";
import { isDemoMode } from "@/lib/env";
import { resolvePeriod } from "@/lib/date-br";

/* =====================================================================
   PRÉVIA do relatório interativo — só em modo demo
   ---------------------------------------------------------------------
   Existe para VER a camada `RelatorioInterativo` com a cara de um
   cliente, sem token e sem banco. Veste um cliente demo (dados ricos)
   com a identidade pedida por query (?marca=778262&nome=Atman+Cozinha).

   ⚠️ NÃO é a rota pública de produção — essa é `/relatorio/[token]`,
   com autorização revogável. Fora do modo demo, responde 404: é uma
   bancada de teste, não uma porta de entrada.
   ===================================================================== */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Prévia — relatório interativo" },
  robots: { index: false, follow: false },
};

export default async function PreviaInterativaPage({
  searchParams,
}: {
  searchParams: Promise<{ marca?: string; nome?: string; cliente?: string }>;
}) {
  if (!isDemoMode) notFound();

  const q = await searchParams;
  const clienteId = q.cliente ?? "c-verdi";
  const marca = corValida(q.marca) ?? "#778262"; // verde-oliva do Atman
  const nome = q.nome ?? "Atman Cozinha";

  const { start, end } = resolvePeriod("30d");
  const data = await getPrintReportData(clienteId, start, end);
  if (!data) notFound();

  /* Veste o dataset demo com a identidade do teste. A FolhaDeRolagem lê
     `client.brand_primary` para o cabeçalho, o funil e as barrinhas de
     seção, então trocar a cor já troca a cara do documento inteiro. */
  const vestido = {
    ...data,
    client: { ...data.client, name: nome, brand_primary: marca },
  };

  const agency = await resolverAgencia(data.client.agency_partner);

  return (
    <div className="min-h-screen bg-[#f2f4f7]">
      <RelatorioInterativo brand={marca}>
        <div className="mx-auto w-fit pb-16 shadow-[0_2px_24px_rgba(17,24,39,0.08)]">
          <FolhaDeRolagem data={vestido} agency={agency} />
        </div>
      </RelatorioInterativo>
    </div>
  );
}

function corValida(c: string | undefined): string | null {
  if (!c) return null;
  const hex = c.startsWith("#") ? c : `#${c}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
}
