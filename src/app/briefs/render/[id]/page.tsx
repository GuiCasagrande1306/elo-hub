import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BriefDocument } from "@/components/content/brief-document";
import { getBriefParaImpressao } from "@/lib/content/print-source";
import { verificarTokenDeImpressao } from "@/lib/content/print-token";
import { lerBlocos, lerCarimbos } from "@/lib/content/blocks";

/* =====================================================================
   Página de impressão do brief
   ---------------------------------------------------------------------
   Fotografada pelo Puppeteer, nunca navegada por um humano.

   Vive em `/briefs/render/`, e não em `/conteudo/render/`, porque
   `/conteudo/[id]/editar` já ocupa dois segmentos sob `/conteudo` — as
   duas rotas colidiriam na resolução. Mesmo arranjo de
   `/reports/render/[clientId]`, pelo mesmo motivo.

   `brief-doc--papel` força o tema claro. Sem isso o PDF herdaria o tema
   de quem clicou: um gestor com o painel no escuro geraria um arquivo
   de fundo carvão para mandar ao cliente.
   ===================================================================== */

export const metadata: Metadata = {
  title: { absolute: "Documento de conteúdo" },
  robots: { index: false, follow: false },
};

export default async function RenderBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);

  /* O token devolve o id que ele autoriza, e ele precisa ser ESTE. Um
     token válido de outro documento não abre este — é o motivo de
     `verificarTokenDeImpressao` devolver o id em vez de um booleano. */
  const autorizado = verificarTokenDeImpressao(token ?? null);
  if (!autorizado || autorizado !== id) notFound();

  const brief = await getBriefParaImpressao(id);
  if (!brief) notFound();

  return (
    <BriefDocument
      papel
      titulo={brief.titulo}
      destaque={brief.destaque}
      resumo={brief.resumo}
      carimbos={lerCarimbos(brief.carimbos)}
      blocos={lerBlocos(brief.blocos)}
    />
  );
}
