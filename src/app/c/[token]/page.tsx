import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BriefDocument } from "@/components/content/brief-document";
import { getBriefPorToken } from "@/lib/content/queries";
import { lerBlocos, lerCarimbos } from "@/lib/content/blocks";

/* =====================================================================
   O documento visto pelo cliente
   ---------------------------------------------------------------------
   Rota pública, sem login. Quem chega aqui tem o link e nada mais.

   Três decisões que a tornam segura o bastante para circular no
   WhatsApp:

     1. A consulta é por token exato, feita no servidor com a service
        role (ver `getBriefPorToken`) — a chave anônima, que vai no
        bundle, não alcança esta tabela.
     2. NADA do painel entra aqui: sem barra lateral, sem nome de outro
        cliente, sem link para o sistema. A página é o documento.
     3. `noindex, nofollow`. O link é para uma pessoa, não para o
        Google — e o conteúdo é o planejamento de campanha de um
        cliente, que não deve aparecer em busca por nome da marca.
   ===================================================================== */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const brief = await getBriefPorToken(token).catch(() => null);

  return {
    /* `absolute` é obrigatório: sem ele o template "%s · Elo Hub" do
       layout raiz cola a marca da agência na aba do cliente — e este
       documento também é entregue por agências parceiras. */
    title: { absolute: brief?.titulo ?? "Documento" },
    robots: { index: false, follow: false },
  };
}

export default async function BriefPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const brief = await getBriefPorToken(token);

  /* 404 para token inválido, revogado ou de documento arquivado — a
     mesma resposta para os três. Distinguir "não existe" de "foi
     revogado" contaria a quem tenta adivinhar quando um palpite chegou
     perto. */
  if (!brief) notFound();

  return (
    <main className="min-h-dvh">
      <BriefDocument
        titulo={brief.titulo}
        destaque={brief.destaque}
        resumo={brief.resumo}
        carimbos={lerCarimbos(brief.carimbos)}
        blocos={lerBlocos(brief.blocos)}
      />
    </main>
  );
}
