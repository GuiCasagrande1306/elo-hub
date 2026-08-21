"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { importarInstagramDaMeta } from "@/app/(app)/midias-sociais/actions";
import { Button } from "@/components/ui/button";

/**
 * Traz os @ que as contas de anúncio já conhecem.
 *
 * O botão diz quanto tempo leva porque leva: são até 46 chamadas à Graph
 * API em paralelo, e um botão que fica cinco segundos parado sem avisar
 * é clicado três vezes.
 */
export function ImportarInstagram() {
  const router = useRouter();
  const [importando, iniciar] = useTransition();
  const [feito, setFeito] = useState<string | null>(null);

  function importar() {
    iniciar(async () => {
      const r = await importarInstagramDaMeta();

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      const { importados, jaTinham } = r.dados;

      setFeito(
        importados === 0
          ? `Nada novo — os ${jaTinham} perfis vinculados já estavam cadastrados.`
          : `${importados} ${importados === 1 ? "perfil cadastrado" : "perfis cadastrados"}.`,
      );

      toast.success(
        importados === 0
          ? "Nenhum perfil novo para importar."
          : `${importados} ${importados === 1 ? "perfil importado" : "perfis importados"} da Meta.`,
      );

      router.refresh();
    });
  }

  return (
    <div className="surface-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">Importar os @ da Meta</p>
        <p className="mt-1 max-w-prose text-2xs text-muted-foreground">
          {feito ??
            "Busca o Instagram vinculado a cada conta de anúncios e cadastra de uma vez. Não sobrescreve @ já cadastrado — a correção feita à mão vale mais."}
        </p>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={importar}
        disabled={importando}
        className="shrink-0"
      >
        {importando ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Buscando…
          </>
        ) : (
          <>
            <Download className="size-3.5" />
            Importar da Meta
          </>
        )}
      </Button>
    </div>
  );
}
