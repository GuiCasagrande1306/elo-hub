import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { BriefEditor } from "@/components/content/brief-editor";
import { getClients } from "@/lib/data";
import { getContentBrief } from "@/lib/content/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  lerBlocos,
  lerCarimbos,
  type StatusBrief,
} from "@/lib/content/blocks";

export const metadata: Metadata = { title: "Editar documento" };

export default async function EditarBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const [brief, clients] = await Promise.all([
    getContentBrief(id),
    getClients(),
  ]);

  if (!brief) notFound();

  return (
    <BriefEditor
      briefId={brief.id}
      clientes={clients.map((c) => ({ id: c.id, name: c.name }))}
      inicial={{
        clientId: brief.client_id,
        titulo: brief.titulo,
        destaque: brief.destaque ?? "",
        resumo: brief.resumo,
        carimbos: lerCarimbos(brief.carimbos),
        /* `lerBlocos` descarta bloco inválido. Aqui isso tem uma
           consequência real: um bloco que não valida NÃO chega ao editor
           e some ao salvar. É o comportamento certo — o alternativo
           seria devolver ao editor um JSON que o próprio sistema recusa
           gravar — mas por isso a leitura tolerante existe só para
           formato antigo, nunca como atalho para relaxar a validação. */
        blocos: lerBlocos(brief.blocos),
        status: brief.status as StatusBrief,
      }}
    />
  );
}
