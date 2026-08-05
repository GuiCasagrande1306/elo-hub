"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setAdAccountId } from "@/app/(app)/clientes/actions";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@/lib/data";

/* =====================================================================
   Contas de mídia do cliente
   ---------------------------------------------------------------------
   O vínculo tem DOIS passos, e separá-los na tela não é capricho:

   1. Autorizar — a pessoa consente no Facebook/Google e o token é
      gravado. Nesse momento ainda não se sabe QUAL conta de anúncios
      usar: um Business Manager costuma ter várias.
   2. Escolher a conta — o `act_...` ou o Customer ID.

   Um cliente parado no passo 1 tem token válido e sincroniza NADA. Por
   isso esse estado aparece como pendência explícita, não como
   "conectado".
   ===================================================================== */

const RÓTULOS = {
  meta_ads: {
    nome: "Meta Ads",
    rota: "/api/auth/meta",
    exemplo: "act_123456789",
    onde: "Gerenciador de Anúncios → canto superior esquerdo",
  },
  google_ads: {
    nome: "Google Ads",
    rota: "/api/auth/google",
    exemplo: "123-456-7890",
    onde: "Google Ads → canto superior direito",
  },
} as const;

export function IntegrationsCard({
  clientId,
  clientSlug,
  integrations,
}: {
  clientId: string;
  clientSlug: string;
  integrations: IntegrationStatus[];
}) {
  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold">Contas de mídia</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sem isto o relatório sai zerado — é daqui que vêm os números.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {integrations.map((i) => (
          <LinhaIntegracao
            key={i.platform}
            clientId={clientId}
            clientSlug={clientSlug}
            status={i}
          />
        ))}
      </div>
    </section>
  );
}

function LinhaIntegracao({
  clientId,
  clientSlug,
  status,
}: {
  clientId: string;
  clientSlug: string;
  status: IntegrationStatus;
}) {
  const meta = RÓTULOS[status.platform];
  const pendente = (status.externalAccountId ?? "").startsWith("pending:");
  const vinculado = status.connected && !pendente;

  const [conta, setConta] = useState(pendente ? "" : (status.externalAccountId ?? ""));
  const [salvando, startTransition] = useTransition();

  function salvarConta() {
    startTransition(async () => {
      const r = await setAdAccountId({
        clientId,
        platform: status.platform,
        externalAccountId: conta,
      });
      if (r.ok) toast.success(`${meta.nome}: conta vinculada.`);
      else toast.error(r.error);
    });
  }

  const autorizar = `${meta.rota}?clientId=${encodeURIComponent(clientId)}&returnTo=${encodeURIComponent(`/clientes/${clientSlug}`)}`;

  return (
    <div className="rounded-xl border border-hairline p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              vinculado
                ? "bg-positive"
                : status.connected
                  ? "bg-warning"
                  : "bg-muted-foreground/40",
            )}
          />
          <span className="text-sm font-medium">{meta.nome}</span>
          <span
            className={cn(
              "text-2xs",
              vinculado
                ? "text-positive"
                : status.connected
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {vinculado
              ? "vinculado"
              : status.connected
                ? "autorizado — falta escolher a conta"
                : "não conectado"}
          </span>
        </div>

        <Button
          size="sm"
          variant={status.connected ? "outline" : "default"}
          nativeButton={false}
          render={<a href={autorizar} />}
        >
          <ExternalLink className="size-3.5" />
          {status.connected ? "Reautorizar" : "Autorizar"}
        </Button>
      </div>

      {status.connected && (
        <div className="mt-3 border-t border-hairline pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="text-2xs text-muted-foreground">
                ID da conta ({meta.exemplo})
              </label>
              <Input
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder={meta.exemplo}
                className="mt-1 font-mono text-xs"
              />
            </div>
            <Button size="sm" onClick={salvarConta} disabled={salvando}>
              {salvando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Vincular
            </Button>
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Encontre em: {meta.onde}
          </p>
        </div>
      )}

      {status.syncError && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-negative-muted/40 px-2.5 py-2 text-2xs text-negative">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          Última sincronização falhou: {status.syncError}
        </p>
      )}
    </div>
  );
}
