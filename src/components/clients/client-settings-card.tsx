"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  Check,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteClient,
  setClientChurned,
  setClientGoal,
  setClientLogo,
} from "@/app/(app)/clientes/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { goalInputValue, goalMetricFor } from "@/lib/metrics/goal-metric";
import type { Client } from "@/types/database";

/* =====================================================================
   Marca, meta e fim do contrato
   ---------------------------------------------------------------------
   O que sobrou depois que nicho, WhatsApp e os dias foram para o
   `ClientForm`: três coisas que NÃO cabem naquele formulário, cada uma
   por um motivo diferente.

   LOGO grava sozinha — o upload vai direto ao Storage e a URL é
   persistida na hora, sem passar por "salvar". Enfiá-la num formulário
   com botão exigiria segurar o arquivo em memória até o submit.

   META vive em outra tabela (`client_goals`), é por período e muda de
   unidade conforme o segmento. Salvá-la junto do cadastro faria uma
   correção de nome reescrever a meta do mês.

   FIM DO CONTRATO é decisão comercial, não edição de campo. Ver a nota
   em `ZonaDeRisco`.
   ===================================================================== */

export function ClientSettingsCard({
  client,
  goal,
}: {
  client: Client;
  goal: {
    plannedBudgetCents: number;
    plannedResults: number;
    resultsMetric: "count" | "revenue" | null;
  } | null;
}) {
  const [pendente, startTransition] = useTransition();

  /* A unidade da meta segue o segmento SALVO. Trocar o nicho agora é
     outro formulário, com outro botão de salvar — e enquanto ele não
     for salvo, a meta continua sendo escrita na unidade que o banco
     ainda considera correta. Depois do salvamento a página revalida e o
     campo reaparece na unidade nova.

     Metas antigas trazem `resultsMetric` própria e ela vence — ver a
     migration 20260806000025. */
  const metrica = goalMetricFor(client.segment, goal?.resultsMetric);

  const [orcamento, setOrcamento] = useState(
    goal ? (goal.plannedBudgetCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [metaResultados, setMetaResultados] = useState(
    goal ? goalInputValue(metrica, goal.plannedResults) : "",
  );
  const [salvandoMeta, startMeta] = useTransition();

  const [logo, setLogo] = useState(client.logo_url);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function enviarLogo(arquivo: File) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      toast.error("Modo demo: upload indisponível.");
      return;
    }

    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("A imagem precisa ter no máximo 5MB.");
      return;
    }

    setEnviandoLogo(true);
    try {
      const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "png";
      /* Caminho começa pelo id do CLIENTE: é o que a policy do bucket
         usa para autorizar. E leva timestamp porque não há policy de
         UPDATE — sobrescrever seria recusado, e o nome novo também
         escapa do cache do navegador. */
      const caminho = `${client.id}/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("brand")
        .upload(caminho, arquivo);

      if (error) {
        toast.error(`Erro ao enviar: ${error.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("brand").getPublicUrl(caminho);

      const r = await setClientLogo({ clientId: client.id, logoUrl: publicUrl });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setLogo(publicUrl);
      toast.success("Logo atualizada.");
    } finally {
      setEnviandoLogo(false);
    }
  }

  function removerLogo() {
    startTransition(async () => {
      const r = await setClientLogo({ clientId: client.id, logoUrl: null });
      if (r.ok) {
        setLogo(null);
        toast.success("Logo removida.");
      } else {
        toast.error(r.error);
      }
    });
  }

  function salvarMeta() {
    startMeta(async () => {
      const r = await setClientGoal({
        clientId: client.id,
        segment: client.segment,
        plannedBudget: orcamento,
        plannedResults: metaResultados,
      });
      if (r.ok) toast.success("Meta do mês salva.");
      else toast.error(r.error);
    });
  }

  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold">Marca e meta</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A identidade visual da conta e o alvo do mês.
      </p>

      {/* Logo ------------------------------------------------------
          Aparece no card da listagem, no cabeçalho da conta e na capa
          do PDF — que já lia `logo_url` e nunca teve como recebê-la. */}
      <div className="mt-5 flex items-center gap-4 border-b border-hairline pb-5">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-black/10">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável.
            <img src={logo} alt="" className="size-full object-contain p-1.5" />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground/50" />
          )}
        </span>

        <div>
          <input
            ref={arquivoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarLogo(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={enviandoLogo}
              onClick={() => arquivoRef.current?.click()}
            >
              {enviandoLogo ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {logo ? "Trocar logo" : "Enviar logo"}
            </Button>

            {logo && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={removerLogo}
                disabled={pendente}
              >
                <Trash2 className="size-3.5" />
                Remover
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            PNG, JPG, WebP ou SVG, até 5MB. Fundo transparente fica melhor.
          </p>
        </div>
      </div>

      {/* Meta do período ------------------------------------------
          Âncora `#metas`: o card do cliente na listagem aponta para
          cá quando a conta ainda não tem meta. */}
      <div id="metas" className="mt-5 scroll-mt-20 border-t border-hairline pt-5">
        <p className="text-sm font-medium">Meta deste mês</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          É contra ela que a saúde da conta é medida nos painéis.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="orcamento">Orçamento previsto (R$)</Label>
            <Input
              id="orcamento"
              inputMode="decimal"
              value={orcamento}
              onChange={(e) => setOrcamento(e.target.value)}
              placeholder="5.000,00"
              className="mt-1.5 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="meta-resultados">
              {metrica.inputLabel}
              {metrica.isCurrency && " (R$)"}
            </Label>
            <Input
              id="meta-resultados"
              inputMode="decimal"
              value={metaResultados}
              onChange={(e) => setMetaResultados(e.target.value)}
              placeholder={metrica.placeholder}
              className="mt-1.5 tabular-nums"
            />
          </div>
        </div>

        <p className="mt-2 text-2xs text-muted-foreground">{metrica.hint}</p>

        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={salvarMeta}
            disabled={salvandoMeta}
          >
            {salvandoMeta ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Salvar meta
          </Button>
        </div>
      </div>

      <ZonaDeRisco client={client} />
    </section>
  );
}

/* =====================================================================
   Fim do contrato
   ---------------------------------------------------------------------
   Duas ações que parecem vizinhas e não são. Encerrar é reversível e
   preserva tudo; apagar leva junto métricas, metas, relatórios e
   histórico, por cascade, sem lixeira.

   Por isso não ficam lado a lado com o mesmo peso: encerrar é um botão
   comum, apagar é texto discreto que abre um diálogo exigindo o nome
   digitado. A assimetria visual é a proteção — botões gêmeos num canto
   perigoso é como se apaga a conta errada às 19h de uma sexta.
   ===================================================================== */

function ZonaDeRisco({ client }: { client: Client }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [pendente, startTransition] = useTransition();

  const encerrado = client.status === "churned";
  const nomeConfere = nomeDigitado.trim() === client.name.trim();

  function alternarChurn() {
    startTransition(async () => {
      const r = await setClientChurned({
        clientId: client.id,
        churned: !encerrado,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success(
        encerrado
          ? "Contrato reaberto. A conta voltou para a carteira."
          : "Contrato encerrado. A conta saiu da carteira ativa.",
      );
      router.refresh();
    });
  }

  function apagar() {
    startTransition(async () => {
      const r = await deleteClient({
        clientId: client.id,
        confirmName: nomeDigitado,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success(`${client.name} foi apagado.`);
      /* `replace` e não `push`: a página deste cliente deixou de
         existir, e voltar para ela daria 404. */
      router.replace("/clientes");
    });
  }

  return (
    <div className="mt-5 border-t border-hairline pt-5">
      <p className="text-sm font-medium">Fim do contrato</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={alternarChurn}
          disabled={pendente}
        >
          {pendente ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : encerrado ? (
            <RotateCcw className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
          {encerrado ? "Reabrir contrato" : "Encerrar contrato"}
        </Button>

        <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
          {encerrado
            ? "A conta está em Encerrados. Reabrir devolve ela à carteira com todo o histórico."
            : "Tira a conta da carteira e leva para Encerrados. Nada é apagado e dá para reabrir."}
        </p>
      </div>

      {/* Apagar mora abaixo, em texto, e não como botão irmão do de
          encerrar — ver a nota no topo. */}
      <button
        type="button"
        onClick={() => {
          setNomeDigitado("");
          setConfirmando(true);
        }}
        className="mt-4 text-2xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-negative"
      >
        Apagar este cliente definitivamente
      </button>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apagar {client.name}?</DialogTitle>
            <DialogDescription>
              Isto não tem desfazer.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            {/* O que some junto, dito por extenso. "Tem certeza?" não
                informa nada — a pessoa já acha que tem. */}
            <div className="rounded-lg border border-negative/35 bg-negative-muted/30 px-3 py-2.5">
              <p className="text-xs font-medium text-negative">
                Vai junto, sem cópia:
              </p>
              <ul className="mt-1 list-inside list-disc text-2xs text-muted-foreground">
                <li>todo o histórico de métricas diárias</li>
                <li>metas e o histórico mês a mês</li>
                <li>relatórios já gerados e enviados</li>
                <li>anotações da esteira e integrações</li>
              </ul>
            </div>

            <p className="text-2xs text-muted-foreground">
              Se o contrato apenas acabou, use{" "}
              <strong className="text-foreground">Encerrar contrato</strong> —
              guarda tudo e desfaz num clique.
            </p>

            <div>
              <Label htmlFor="confirmar-nome">
                Digite <strong>{client.name}</strong> para confirmar
              </Label>
              <Input
                id="confirmar-nome"
                value={nomeDigitado}
                onChange={(e) => setNomeDigitado(e.target.value)}
                autoComplete="off"
                className="mt-1.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmando(false)}
              disabled={pendente}
            >
              Cancelar
            </Button>
            <Button
              onClick={apagar}
              disabled={pendente || !nomeConfere}
              className="bg-negative text-white hover:bg-negative/90"
            >
              {pendente && <Loader2 className="size-4 animate-spin" />}
              <Trash2 className="size-4" />
              Apagar para sempre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
