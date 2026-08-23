import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { BriefEditor } from "@/components/content/brief-editor";
import { getClients } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { MODELO_INICIAL } from "@/lib/content/modelo";

export const metadata: Metadata = { title: "Novo documento" };

/**
 * Documento novo.
 *
 * Não abre em branco: começa com o esqueleto do formato (`MODELO_INICIAL`)
 * já preenchido com um exemplo de cada bloco que a agência usa. Folha em
 * branco obrigaria a lembrar de cabeça o nome de cada campo do JSON —
 * e o formato existe justamente para não ser recriado toda vez.
 */
export default async function NovoBriefPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [clients, { cliente }] = await Promise.all([getClients(), searchParams]);

  return (
    <BriefEditor
      clientes={clients.map((c) => ({ id: c.id, name: c.name }))}
      inicial={{
        /* Cliente pré-escolhido quando se chega pela ficha dele; senão,
           o primeiro da carteira — nunca vazio, que é o estado em que
           salvar falha sem dizer o motivo óbvio. */
        clientId: cliente ?? clients[0]?.id ?? "",
        titulo: "",
        destaque: "",
        resumo: "",
        carimbos: [
          { rotulo: "Formato", valor: "Reels vertical" },
          { rotulo: "Ciclo", valor: "Terça e sexta" },
        ],
        blocos: MODELO_INICIAL,
        status: "rascunho",
      }}
    />
  );
}
