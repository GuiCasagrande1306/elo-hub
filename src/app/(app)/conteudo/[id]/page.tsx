import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { BriefDocument } from "@/components/content/brief-document";
import { BriefToolbar } from "@/components/content/brief-toolbar";
import { getContentBrief } from "@/lib/content/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { lerBlocos, lerCarimbos, resumirBrief } from "@/lib/content/blocks";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const brief = await getContentBrief(id).catch(() => null);
  return { title: brief?.titulo ?? "Conteúdo" };
}

/* =====================================================================
   Documento aberto
   ---------------------------------------------------------------------
   A página é o documento. A barra de ações fica FORA do `.brief-doc` —
   ela não deve herdar a tipografia nem a paleta do brief, e não pode
   aparecer no PDF nem no link do cliente.
   ===================================================================== */

export default async function BriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const brief = await getContentBrief(id);

  if (!brief) notFound();

  const blocos = lerBlocos(brief.blocos);
  const resumo = resumirBrief(blocos);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <BriefToolbar
        briefId={brief.id}
        clientId={brief.client_id}
        titulo={brief.titulo}
        status={brief.status}
        shareToken={brief.share_token}
        pendencias={resumo.pendencias}
        ehAdmin={user.role === "admin"}
      />

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <BriefDocument
          titulo={brief.titulo}
          destaque={brief.destaque}
          resumo={brief.resumo}
          carimbos={lerCarimbos(brief.carimbos)}
          blocos={blocos}
        />
      </div>
    </div>
  );
}
