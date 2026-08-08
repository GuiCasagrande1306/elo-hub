"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { checkMetaPermissionsAction } from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
/* De `elochat-scopes` e não de `meta-permissions`: aquele é `server-only`
   e importar um VALOR de lá puxaria o cliente admin do Supabase para o
   bundle do navegador. O `tsc` deixa passar; o build do Next não. */
import {
  RÓTULOS_ESCOPO,
  type PermissoesMeta,
} from "@/lib/ads/elochat-scopes";

/* =====================================================================
   Conexão Instagram (EloChat)
   ---------------------------------------------------------------------
   SOB DEMANDA, com botão. Verificar é uma ida à Graph API por cliente, e
   a resposta quase nunca muda entre duas aberturas da tela — automático
   colocaria a latência da Meta no caminho de abrir os ajustes.

   E não uso a coluna `scopes` do banco como atalho: ela guarda o que foi
   PEDIDO no consentimento, fixo no código, não o que a Meta concedeu.
   Quem recusar uma permissão fica com o banco dizendo que ela existe.

   TRÊS ESTADOS, não dois. "Pronto", "falta permissão" e "não consegui
   verificar" pedem ações diferentes — e tratar erro de rede como
   permissão faltando mandaria alguém refazer o consentimento por causa
   de um timeout.
   ===================================================================== */

export function InstagramAutomationStatus({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const [resultado, setResultado] = useState<PermissoesMeta | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [verificando, startTransition] = useTransition();

  function verificar() {
    setFalha(null);
    startTransition(async () => {
      const r = await checkMetaPermissionsAction({ clientId });
      if (!r.ok) {
        setResultado(null);
        setFalha(r.error);
        return;
      }
      setResultado(r.dados);
    });
  }

  const reautorizar =
    `/api/auth/meta?clientId=${encodeURIComponent(clientId)}` +
    `&returnTo=${encodeURIComponent(`/clientes/${clientSlug}`)}&elochat=1`;

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Conexão Instagram (EloChat)</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Permissões de direct — separadas das de anúncios.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={verificar}
          disabled={verificando}
        >
          {verificando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {resultado || falha ? "Verificar de novo" : "Verificar"}
        </Button>
      </div>

      {falha && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-negative-muted/40 px-2.5 py-2 text-2xs text-negative">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {falha}
        </p>
      )}

      {/* Erro do próprio verificador: token expirado, sem integração,
          rede. NÃO é o mesmo que faltar permissão, e por isso não
          oferece o botão de reautorizar como se fosse a solução. */}
      {resultado?.error && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-warning-muted/40 px-2.5 py-2 text-2xs text-warning">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {resultado.error}
        </p>
      )}

      {resultado && !resultado.error && resultado.isReadyForEloChat && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-positive-muted px-2.5 py-1 text-2xs font-medium text-positive">
          <CheckCircle2 className="size-3.5" />
          Pronto para automação
        </p>
      )}

      {resultado && !resultado.error && !resultado.isReadyForEloChat && (
        <div className="mt-2.5 rounded-lg bg-warning-muted/40 px-2.5 py-2">
          <p className="flex items-start gap-1.5 text-2xs font-medium text-warning">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            A automação não vai rodar — faltam permissões da Meta.
          </p>

          <ul className="mt-1.5 flex flex-col gap-0.5 pl-[18px]">
            {resultado.missingPermissions.map((p) => (
              <li key={p} className="text-2xs text-muted-foreground">
                <span className="text-foreground">
                  {RÓTULOS_ESCOPO[p] ?? p}
                </span>
                <span className="ml-1 font-mono opacity-70">{p}</span>
                {resultado.declinedPermissions.includes(p) && (
                  <span className="ml-1 text-negative">· recusada</span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[18px]">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-2xs"
              nativeButton={false}
              render={<a href={reautorizar} />}
            >
              <ExternalLink className="size-3" />
              Reautorizar Instagram
            </Button>
          </div>

          {/* O aviso que evita a viagem perdida. Estas duas permissões
              são de Acesso Avançado: enquanto o app não passar pela
              revisão da Meta, o consentimento completa sem erro e volta
              sem elas — e a pessoa refaz o fluxo achando que errou. */}
          <p className="mt-2 pl-[18px] text-2xs text-muted-foreground">
            Se voltar igual: <code>pages_messaging</code> e{" "}
            <code>instagram_manage_messages</code> só são concedidas
            depois da revisão do app pela Meta. Antes disso o fluxo passa
            e não entrega nada.
          </p>
        </div>
      )}

      {resultado && !resultado.error && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          Concedidas hoje: {resultado.granted.join(", ") || "nenhuma"}.
        </p>
      )}
    </div>
  );
}
