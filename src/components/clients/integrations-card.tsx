"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleAccountPicker } from "./google-account-picker";
import { InstagramAutomationStatus } from "./instagram-automation-status";
import { MetaAccountPicker } from "./meta-account-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setAdAccountId,
  setAccountFunds,
  setBillingType,
  setConversionAction,
} from "@/app/(app)/clientes/actions";
import {
  CONVERSION_ACTION_OPTIONS,
  conversionActionFor,
} from "@/lib/ads/conversion-action";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@/lib/data";
import type { ClientSegment } from "@/types/database";

/** Valor do seletor que significa "sem escolha explícita". */
const PADRAO = "__padrao__";

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
  segment,
  integrations,
  semMoldura = false,
}: {
  clientId: string;
  clientSlug: string;
  /** Define qual evento do pixel conta como conversão por padrão. */
  segment: ClientSegment | null;
  integrations: IntegrationStatus[];
  /** Dentro do diálogo, sem card e sem título — ver `ClientSettingsDialog`. */
  semMoldura?: boolean;
}) {
  return (
    <section className={semMoldura ? undefined : "surface-card p-5"}>
      {!semMoldura && (
        <>
          <h2 className="text-sm font-semibold">Contas de mídia</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sem isto o relatório sai zerado — é daqui que vêm os números.
          </p>
        </>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {integrations.map((i) => (
          <LinhaIntegracao
            key={i.platform}
            clientId={clientId}
            clientSlug={clientSlug}
            segment={segment}
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
  segment,
  status,
}: {
  clientId: string;
  clientSlug: string;
  segment: ClientSegment | null;
  status: IntegrationStatus;
}) {
  const meta = RÓTULOS[status.platform];
  const pendente = (status.externalAccountId ?? "").startsWith("pending:");
  const vinculado = status.connected && !pendente;

  const [conta, setConta] = useState(pendente ? "" : (status.externalAccountId ?? ""));
  const [prePaga, setPrePaga] = useState(status.billingType === "prepaid");
  const [conversao, setConversao] = useState(status.conversionActionType ?? PADRAO);
  const [fundos, setFundos] = useState(
    status.fundsCents !== null
      ? (status.fundsCents / 100).toFixed(2).replace(".", ",")
      : "",
  );

  function salvarFundos() {
    startTransition(async () => {
      const r = await setAccountFunds({
        clientId,
        platform: status.platform,
        funds: fundos,
      });
      if (r.ok) {
        toast.success(
          fundos.trim() ? "Saldo registrado." : "Registro de saldo limpo.",
        );
      } else {
        toast.error(r.error);
      }
    });
  }
  const [salvando, startTransition] = useTransition();

  /* O que o sync usará HOJE — com a escolha explícita ou sem ela. Mostrar
     isso resolvido evita a pergunta "e se eu deixar no padrão?", que só
     seria respondida no relatório do mês seguinte. */
  const efetivo = conversionActionFor(
    segment,
    conversao === PADRAO ? null : conversao,
  );

  function salvarConversao(valor: string) {
    setConversao(valor);
    startTransition(async () => {
      const r = await setConversionAction({
        clientId,
        actionType: valor === PADRAO ? null : valor,
      });
      if (r.ok) toast.success("Conversão atualizada.");
      else {
        setConversao(status.conversionActionType ?? PADRAO);
        toast.error(r.error);
      }
    });
  }

  function alternarFaturamento(marcado: boolean) {
    setPrePaga(marcado);
    startTransition(async () => {
      const r = await setBillingType({
        clientId,
        platform: status.platform,
        billingType: marcado ? "prepaid" : "postpaid",
      });
      if (r.ok) {
        toast.success(
          marcado
            ? `${meta.nome}: alerta de saldo ligado.`
            : `${meta.nome}: fora do alerta de saldo.`,
        );
      } else {
        setPrePaga(!marcado);
        toast.error(r.error);
      }
    });
  }

  function salvarConta() {
    startTransition(async () => {
      const r = await setAdAccountId({
        clientId,
        platform: status.platform,
        externalAccountId: conta,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      /* O aviso não é erro: o vínculo foi gravado e o cron reprocessa
         de manhã. Mostrar como falha faria alguém desfazer algo que
         está certo. */
      if (r.warning) {
        toast.warning(`${meta.nome}: conta vinculada.`, {
          description: r.warning,
        });
      } else {
        toast.success(`${meta.nome}: conta vinculada.`, {
          description: "Números do mês atualizados.",
        });
      }
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
                {status.platform === "meta_ads"
                  ? "Conta de anúncios"
                  : `ID da conta (${meta.exemplo})`}
              </label>

              {/* As duas plataformas listam agora. Cada uma com o seu
                  picker: os identificadores têm formatos diferentes
                  (`act_<n>` contra `123-456-7890`) e as rotas também. */}
              <div className="mt-1">
                {status.platform === "meta_ads" ? (
                  <MetaAccountPicker
                    clientId={clientId}
                    value={conta}
                    onChange={setConta}
                    disabled={salvando}
                  />
                ) : (
                  <GoogleAccountPicker
                    clientId={clientId}
                    value={conta}
                    onChange={setConta}
                    disabled={salvando}
                  />
                )}
              </div>
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


          {/* O alerta de saldo só se aplica a conta pré-paga: em
              pós-paga não há crédito a esgotar, e o `balance` da Meta
              significa dívida, não folga. */}
          <label className="mt-3 flex items-start gap-2 border-t border-hairline pt-3">
            <input
              type="checkbox"
              checked={prePaga}
              onChange={(e) => alternarFaturamento(e.target.checked)}
              disabled={salvando}
              className="mt-0.5 size-3.5 accent-[var(--primary)]"
            />
            <span>
              <span className="text-xs font-medium">Conta pré-paga</span>
              <span className="mt-0.5 block text-2xs text-muted-foreground">
                Monitora o saldo e avisa quando faltarem 3 dias de verba.
              </span>
            </span>
          </label>

          {/* Só aparece em conta pré-paga: em pós-paga não há carteira
              a esgotar, e o campo só confundiria. */}
          {prePaga && (
            <div className="mt-3 border-t border-hairline pt-3">
              <label className="text-2xs text-muted-foreground">
                Saldo disponível hoje (do painel da plataforma)
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Input
                  value={fundos}
                  onChange={(e) => setFundos(e.target.value)}
                  placeholder="341,77"
                  inputMode="decimal"
                  className="max-w-[140px] tabular-nums"
                />
                <Button size="sm" variant="outline" onClick={salvarFundos} disabled={salvando}>
                  {salvando ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Registrar
                </Button>
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                A Meta não expõe a carteira pela API. Informe o valor ao
                recarregar — o gasto diário é descontado sozinho a partir
                daí, então não precisa reanotar todo dia.
                {status.fundsRecordedAt && (
                  <> Última leitura: {formatarData(status.fundsRecordedAt)}.</>
                )}
              </p>
            </div>
          )}

          {/* Só Meta: no Google a conversão é definida na própria conta,
              e o provider lê o que vier de lá. */}
          {status.platform === "meta_ads" && (
            <div className="mt-3 border-t border-hairline pt-3">
              <label className="text-2xs text-muted-foreground">
                O que conta como conversão
              </label>
              <Select
                value={conversao}
                onValueChange={(v) => salvarConversao(v ?? PADRAO)}
              >
                <SelectTrigger size="sm" className="mt-1 w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === PADRAO
                        ? "Padrão do segmento"
                        : (CONVERSION_ACTION_OPTIONS.find((o) => o.value === v)
                            ?.label ?? v)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PADRAO}>Padrão do segmento</SelectItem>
                  {CONVERSION_ACTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                      <span className="ml-1.5 text-2xs text-muted-foreground">
                        {o.hint}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* UM POR LINHA, e não `{efetivo}` solto.
                  `conversionActionFor` devolve um ARRAY, e array em JSX
                  é renderizado concatenado, sem separador. Na tela isso
                  virava uma palavra só —
                  "…fb_pixel_leadonsite_conversion.lead_grouped…" — que
                  além de ilegível parece um valor errado gravado no
                  banco. E como não tem espaço para quebrar, a linha
                  empurrava o diálogo inteiro na horizontal.

                  `break-all` porque o que estoura é UM token sem espaço:
                  `break-words` só quebra entre palavras e não teria onde
                  agir. */}
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {efetivo.map((tipo) => (
                  <li
                    key={tipo}
                    className="break-all font-mono text-2xs text-muted-foreground"
                  >
                    {tipo}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-2xs text-muted-foreground">
                A Meta devolve todos os eventos do pixel juntos. Escolher o
                errado zera conversão e receita no relatório.
              </p>
            </div>
          )}

          {/* O EloChat usa o MESMO token do Meta Ads, com permissões
              diferentes — por isso mora aqui dentro e não num card
              próprio: quem reautoriza para o direct mexe no token que a
              sincronização de anúncios usa. */}
          {status.platform === "meta_ads" && (
            <InstagramAutomationStatus
              clientId={clientId}
              clientSlug={clientSlug}
            />
          )}
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

/** "05/08/2026" a partir de uma data YYYY-MM-DD. */
function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
