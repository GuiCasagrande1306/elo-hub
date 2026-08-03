"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { triggerSyncNow } from "@/app/(app)/sync-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botão "Sincronizar agora".
 *
 * Chama uma Server Action, não a rota de cron. A diferença importa: a
 * rota exige o `CRON_SECRET`, que é segredo de servidor e não pode ir
 * para o browser. A action valida a sessão de admin — mesma proteção,
 * sem expor segredo nenhum.
 *
 * O retorno é resumido no toast em vez de sumir no console: uma rodada
 * que sincronizou 6 contas e falhou em 1 precisa dizer QUAL falhou, ou
 * o erro só aparece quando o cliente reclama do número.
 */
export function SyncButton({ className }: { className?: string }) {
  const [isPending, startTransition] = useTransition();
  const [lastSync, setLastSync] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      const result = await triggerSyncNow();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setLastSync(new Date().toLocaleTimeString("pt-BR"));

      const seconds = (result.durationMs / 1000).toFixed(1).replace(".", ",");

      if (result.failed === 0) {
        toast.success(
          `${result.succeeded} ${result.succeeded === 1 ? "conta sincronizada" : "contas sincronizadas"} em ${seconds}s`,
          { description: `${result.rows} linhas de métrica atualizadas.` },
        );
        return;
      }

      // Sucesso parcial é o caso comum: um token vence e os outros
      // clientes continuam sincronizando. O toast precisa refletir isso
      // em vez de declarar sucesso ou falha geral.
      toast.warning(
        `${result.succeeded} de ${result.succeeded + result.failed} contas sincronizadas`,
        {
          description: result.failures
            .slice(0, 3)
            .map((f) => `${f.client} (${f.platform}): ${f.message}`)
            .join("\n"),
          duration: 10_000,
        },
      );
    });
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {lastSync && (
        <span className="hidden text-2xs text-muted-foreground sm:inline">
          {lastSync}
        </span>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={handleClick}
        disabled={isPending}
        aria-label="Sincronizar dados das plataformas de mídia agora"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {isPending ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
    </div>
  );
}
