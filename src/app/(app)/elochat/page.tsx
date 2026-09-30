import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { FlowBuilder, type FluxoSalvo } from "@/components/elochat/flow-builder";
import { getClients } from "@/lib/data";
import { fluxoDoCliente } from "@/lib/elochat/leitura";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "EloChat" };

/* =====================================================================
   EloChat
   ---------------------------------------------------------------------
   SEM `PageContainer`, e é a única tela do sistema assim. O container
   dá margem, largura máxima e rolagem da página — as três coisas que um
   canvas precisa NÃO ter. O construtor mede a própria altura descontando
   o cabeçalho do shell (e a barra inferior no mobile) para caber na
   janela sem criar uma segunda rolagem.

   O CLIENTE VEM DA URL, e não de estado no navegador. `?cliente=slug`
   torna o fluxo compartilhável, sobrevive ao recarregar, e deixa o
   fluxo chegar pronto do servidor em vez de piscar vazio. É o mesmo
   caminho que o resto do sistema usa para recorte por conta.

   ⚠️ AINDA NÃO DISPARA NADA. A partir da migration 83 o fluxo é
   gravado e pode ser publicado — publicar marca qual é o fluxo válido
   daquela conta e congela a versão. Quem executa é o motor, que não
   existe. A tela diz isso ao publicar, de propósito.
   ===================================================================== */

export default async function EloChatPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { cliente: slug } = await searchParams;

  /* A carteira inteira, ordenada por nome — a regra de toda lista de
     seleção do sistema. Quem não tem Instagram conectado aparece
     igual: a conexão é conferida na hora de publicar, e esconder a
     conta aqui faria parecer que ela não existe. */
  const todos = await getClients();
  const clientes = todos
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const cliente = slug ? (clientes.find((c) => c.slug === slug) ?? null) : null;

  /* `null` sem cliente escolhido, e também quando a migration 83 não
     rodou — ver `fluxoDoCliente`. Nos dois casos o construtor abre
     utilizável; o que muda é só não haver o que carregar. */
  const fluxo: FluxoSalvo | null = cliente
    ? await fluxoDoCliente(cliente.id)
    : null;

  return (
    /* `key` remonta o construtor ao trocar de conta. Sem ela o React
       preservaria os nós do cliente anterior no canvas do próximo — e
       o primeiro "Salvar" gravaria o fluxo de um na conta do outro. */
    <FlowBuilder
      key={cliente?.id ?? "sem-cliente"}
      clientes={clientes}
      cliente={cliente}
      fluxo={fluxo}
    />
  );
}
