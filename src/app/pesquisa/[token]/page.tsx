import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FormularioNps } from "@/components/nps/formulario-nps";
import { clienteDaPesquisa } from "@/lib/nps/dados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Título sem a marca do Elo Hub: o cliente pode estar sendo atendido por
   uma agência parceira. `noindex` porque o token é a única fechadura. */
export const metadata: Metadata = {
  title: { absolute: "Pesquisa de satisfação" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function PesquisaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cliente = await clienteDaPesquisa(token);
  if (!cliente) notFound();

  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {cliente.agencia}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Como está sendo trabalhar com a gente?
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Leva uns 2 minutos. Sua resposta vai direto para a equipe e nos
            ajuda a melhorar o trabalho para <strong className="text-foreground">{cliente.nome}</strong>.
          </p>
        </header>

        <FormularioNps token={token} agencia={cliente.agencia} />
      </div>
    </main>
  );
}
