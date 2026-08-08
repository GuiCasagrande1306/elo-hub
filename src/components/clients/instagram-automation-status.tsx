"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { checkInstagramAction } from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
/* De `elochat-scopes` e não de `connection`: aquele é `server-only` e
   importar um VALOR de lá puxaria o cliente admin do Supabase para o
   bundle do navegador. O `tsc` deixa passar; o build do Next não. */
import {
  RÓTULOS_ESCOPO,
  type PermissoesInstagram,
} from "@/lib/instagram/elochat-scopes";

/* =====================================================================
   Conexão Instagram (EloChat)
   ---------------------------------------------------------------------
   CONEXÃO PRÓPRIA, não uma extensão do Meta Ads. O cliente entra pelo
   `instagram.com`, com credenciais e token separados dos de anúncios —
   por isso o botão principal é "Conectar Instagram" e não "reautorizar".
   Uma conta pode ter anúncios sem direct e o contrário.

   SOB DEMANDA, com botão: verificar é uma ida ao `graph.instagram.com`
   por cliente, e a resposta quase nunca muda entre duas aberturas.

   QUATRO ESTADOS, não dois — "não conectado", "pronto", "conectado mas
   faltando permissão" e "não consegui verificar". Tratar erro de rede
   como permissão faltando mandaria alguém refazer o consentimento por
   causa de um timeout.
   ===================================================================== */

export function InstagramAutomationStatus({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
}) {
  const [resultado, setResultado] = useState<PermissoesInstagram | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [verificando, startTransition] = useTransition();

  function verificar() {
    setFalha(null);
    startTransition(async () => {
      const r = await checkInstagramAction({ clientId });
      if (!r.ok) {
        setResultado(null);
        setFalha(r.error);
        return;
      }
      setResultado(r.dados);
    });
  }

  const conectar =
    `/api/auth/instagram?clientId=${encodeURIComponent(clientId)}` +
    `&returnTo=${encodeURIComponent(`/clientes/${clientSlug}`)}`;

  const pronto = resultado?.isReadyForEloChat && !resultado.error;

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Conexão Instagram (EloChat)</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Login separado do de anúncios — o cliente entra pelo Instagram.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={verificar}
            disabled={verificando}
            aria-label="Verificar conexão do Instagram"
          >
            {verificando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>

          <Button
            size="sm"
            variant={pronto ? "outline" : "default"}
            className="h-8"
            nativeButton={false}
            render={<a href={conectar} />}
          >
            <ExternalLink className="size-3.5" />
            {resultado?.conectado ? "Reconectar" : "Conectar Instagram"}
          </Button>
        </div>
      </div>

      {falha && <Aviso tom="negative">{falha}</Aviso>}

      {/* Erro do verificador: token revogado, rede. NÃO é o mesmo que
          faltar permissão, e por isso a frase fala em reconectar só
          quando é disso que se trata. */}
      {resultado?.error && <Aviso tom="warning">{resultado.error}</Aviso>}

      {resultado && !resultado.error && !resultado.conectado && (
        <p className="mt-2.5 text-2xs text-muted-foreground">
          Nenhum Instagram conectado. O cliente precisa autorizar pelo
          botão acima — e a conta dele tem de ser Profissional (comercial
          ou criador de conteúdo).
        </p>
      )}

      {pronto && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-positive-muted px-2.5 py-1 text-2xs font-medium text-positive">
          <CheckCircle2 className="size-3.5" />
          Pronto para automação
          {resultado?.username && (
            <span className="font-normal opacity-80">@{resultado.username}</span>
          )}
        </p>
      )}

      {resultado &&
        !resultado.error &&
        resultado.conectado &&
        !resultado.isReadyForEloChat && (
          <div className="mt-2.5 rounded-lg bg-warning-muted/40 px-2.5 py-2">
            <p className="flex items-start gap-1.5 text-2xs font-medium text-warning">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              Conectado, mas a automação não vai rodar.
            </p>

            <ul className="mt-1.5 flex flex-col gap-0.5 pl-[18px]">
              {resultado.missingPermissions.map((p) => (
                <li key={p} className="text-2xs text-muted-foreground">
                  <span className="text-foreground">
                    {RÓTULOS_ESCOPO[p] ?? p}
                  </span>
                  <span className="ml-1 font-mono opacity-70">{p}</span>
                </li>
              ))}
            </ul>

            <p className="mt-2 pl-[18px] text-2xs text-muted-foreground">
              Reconecte marcando todas as caixas do diálogo. Se voltar
              igual: fora do modo de desenvolvimento, a Meta só concede
              estas permissões depois da revisão do app.
            </p>
          </div>
        )}

      {resultado?.conectado && !resultado.error && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          Concedidas: {resultado.granted.join(", ") || "nenhuma"}.
          {resultado.expiresAt && (
            <> Token válido até {resultado.expiresAt.slice(0, 10)}.</>
          )}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Aviso({
  tom,
  children,
}: {
  tom: "warning" | "negative";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tom === "negative"
          ? "mt-2.5 flex items-start gap-1.5 rounded-lg bg-negative-muted/40 px-2.5 py-2 text-2xs text-negative"
          : "mt-2.5 flex items-start gap-1.5 rounded-lg bg-warning-muted/40 px-2.5 py-2 text-2xs text-warning"
      }
    >
      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
      {children}
    </p>
  );
}
