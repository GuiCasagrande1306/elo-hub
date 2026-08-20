"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { definirFormaDeRecarga } from "@/app/(app)/alertas-saldo/actions";
import { cn } from "@/lib/utils";
import type { AdPlatform } from "@/types/database";

/* =====================================================================
   Como esta conta é recarregada
   ---------------------------------------------------------------------
   Duas opções e nada mais, porque a resposta muda o que o alerta pede:

     Pix     saldo acabando é tarefa de alguém, hoje
     Cartão  a conta se recarrega sozinha — e o alerta só é urgente
             quando a cobrança falha

   Enquanto ninguém escolhe, os dois botões ficam apagados e a tela não
   afirma nenhum dos dois. "Não sei" é estado legítimo; um padrão
   escolhido no código viraria alerta com a urgência errada.
   ===================================================================== */

const OPCOES = [
  { valor: "pix" as const, rotulo: "Pix" },
  { valor: "cartao" as const, rotulo: "Cartão" },
];

export function FormaDeRecarga({
  clientId,
  platform,
  atual,
}: {
  clientId: string;
  platform: AdPlatform;
  atual: "pix" | "cartao" | null;
}) {
  const router = useRouter();
  const [escolha, setEscolha] = useState(atual);
  const [salvando, iniciar] = useTransition();

  function escolher(valor: "pix" | "cartao") {
    // Clicar no que já está marcado desmarca — é como se volta a "não sei".
    const novo = escolha === valor ? null : valor;
    setEscolha(novo);

    iniciar(async () => {
      const r = await definirFormaDeRecarga({
        clientId,
        platform: platform as "meta_ads" | "google_ads",
        metodo: novo ?? "",
      });

      if (!r.ok) {
        setEscolha(atual);
        toast.error(r.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-2xs text-muted-foreground">Recarga</span>
      <div className="flex overflow-hidden rounded-lg border border-hairline">
        {OPCOES.map((o, i) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => escolher(o.valor)}
            disabled={salvando}
            aria-pressed={escolha === o.valor}
            className={cn(
              "px-2 py-1 text-2xs transition-colors disabled:opacity-60",
              i > 0 && "border-l border-hairline",
              escolha === o.valor
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
