"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  removerAgencia,
  renomearAgencia,
  salvarAgencia,
} from "@/app/(app)/gestao/agencias/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgencyContract } from "@/types/database";

/* =====================================================================
   Cadastro de agências
   ---------------------------------------------------------------------
   Uma linha por agência, expandindo para o formulário. Lista e edição no
   mesmo lugar porque a pergunta que traz alguém aqui — "quanto a Bagano
   paga?" — se responde na lista, e só às vezes vira uma correção.

   A AGÊNCIA PRÓPRIA não pode ser removida e é marcada na lista: é ela
   que define quais clientes são faturados individualmente, e apagá-la
   deixaria a régua de faturamento sem referência.
   ===================================================================== */

export interface AgencyRow extends AgencyContract {
  /** Quantas contas da carteira esta agência atende. */
  clientes: number;
}

export function AgenciesWorkspace({ agencias }: { agencias: AgencyRow[] }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  return (
    <div className="mt-7 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <strong className="font-medium text-foreground tabular-nums">
            {agencias.length}
          </strong>{" "}
          {agencias.length === 1 ? "agência cadastrada" : "agências cadastradas"}
        </p>

        <Button size="sm" className="h-8" onClick={() => setCriando(true)}>
          <Plus className="size-3.5" />
          Nova agência
        </Button>
      </div>

      {criando && (
        <FormularioAgencia
          titulo="Nova agência"
          onFechar={() => setCriando(false)}
        />
      )}

      <ul className="flex flex-col gap-2">
        {agencias.map((a) => (
          <li key={a.agency} className="surface-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Selo agencia={a} />

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {a.agency}
                  {a.is_own && (
                    <span className="rounded-full bg-signal-muted px-2 py-0.5 text-2xs font-medium text-signal">
                      conta própria
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground tabular-nums">
                  {a.clientes} {a.clientes === 1 ? "conta" : "contas"}
                  {a.monthly_fee_cents > 0 && (
                    <> · {formatCurrency(a.monthly_fee_cents)}/mês</>
                  )}
                  {a.billing_day && <> · vence dia {a.billing_day}</>}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setAberta(aberta === a.agency ? null : a.agency)}
              >
                {aberta === a.agency ? "Fechar" : "Editar"}
              </Button>
            </div>

            {aberta === a.agency && (
              <div className="mt-4 border-t border-hairline pt-4">
                <FormularioAgencia
                  titulo={`Editar ${a.agency}`}
                  agencia={a}
                  onFechar={() => setAberta(null)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Logo quando existe, inicial na cor da marca quando não. */
function Selo({ agencia }: { agencia: AgencyRow }) {
  if (agencia.logo_url) {
    return (
      <img
        src={agencia.logo_url}
        alt={agencia.agency}
        className="h-8 w-8 shrink-0 rounded-md object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
      style={{ background: agencia.brand_primary ?? "#4A5568" }}
    >
      {agencia.agency.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function FormularioAgencia({
  titulo,
  agencia,
  onFechar,
}: {
  titulo: string;
  agencia?: AgencyRow;
  onFechar: () => void;
}) {
  const editando = Boolean(agencia);

  const [nome, setNome] = useState(agencia?.agency ?? "");
  const [honorario, setHonorario] = useState(
    agencia && agencia.monthly_fee_cents > 0
      ? (agencia.monthly_fee_cents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  const [diaCobranca, setDiaCobranca] = useState(
    agencia?.billing_day ? String(agencia.billing_day) : "",
  );
  const [cor, setCor] = useState(agencia?.brand_primary ?? "");
  const [logo, setLogo] = useState(agencia?.logo_url ?? "");
  const [notas, setNotas] = useState(agencia?.notes ?? "");
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [salvando, iniciar] = useTransition();
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

    const ext = arquivo.name.split(".").pop()?.toLowerCase() ?? "png";

    /* SVG barrado ANTES do upload. O motor padrão de PDF não rasteriza
       vetor e uma imagem que ele não abre aborta o documento inteiro —
       o relatório do cliente cairia por causa de um logo. */
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
      toast.error("Use PNG, JPG ou WEBP. SVG quebra a geração do PDF.");
      return;
    }

    setEnviandoLogo(true);
    try {
      /* Pasta `agencias/` é a que a policy do bucket libera para admin —
         o resto do bucket exige que o primeiro segmento seja o id de um
         cliente. O timestamp escapa do cache e evita sobrescrever, que a
         policy também não permite. */
      const caminho = `agencias/${Date.now()}.${ext}`;

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

      setLogo(publicUrl);
      toast.success("Logo carregada. Salve para aplicar.");
    } finally {
      setEnviandoLogo(false);
    }
  }

  function salvar() {
    iniciar(async () => {
      /* Renomear vem ANTES do resto: é a operação que arrasta os
         clientes junto, e falhar nela invalidaria o salvamento dos
         outros campos sob o nome novo. */
      if (editando && agencia && nome.trim() !== agencia.agency) {
        const r = await renomearAgencia({ de: agencia.agency, para: nome });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
      }

      const r = await salvarAgencia({
        agency: nome,
        monthlyFee: honorario,
        billingDay: diaCobranca,
        brandPrimary: cor,
        logoUrl: logo,
        notes: notas,
      });

      if (r.ok) {
        toast.success(editando ? "Agência atualizada." : "Agência cadastrada.");
        onFechar();
      } else {
        toast.error(r.error);
      }
    });
  }

  function remover() {
    if (!agencia) return;
    if (
      !window.confirm(
        `Remover ${agencia.agency} do cadastro? Os relatórios já enviados não mudam.`,
      )
    ) {
      return;
    }

    iniciar(async () => {
      const r = await removerAgencia(agencia.agency);
      if (r.ok) {
        toast.success("Agência removida.");
        onFechar();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className={cn(!agencia && "surface-card p-4")}>
      {!agencia && <h3 className="text-sm font-semibold">{titulo}</h3>}

      <div className={cn("grid gap-4 sm:grid-cols-2", !agencia && "mt-4")}>
        <div className="sm:col-span-2">
          <Label htmlFor={`nome-${agencia?.agency ?? "novo"}`}>Nome</Label>
          <Input
            id={`nome-${agencia?.agency ?? "novo"}`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Bagano"
            className="mt-1.5"
          />
          {editando && nome.trim() !== agencia?.agency && (
            /* O nome é a chave, e `clients.agency_partner` guarda TEXTO:
               renomear move os clientes junto, e quem está mexendo
               precisa saber disso antes de salvar. */
            <p className="mt-1.5 text-2xs text-warning">
              Renomear move {agencia?.clientes ?? 0}{" "}
              {agencia?.clientes === 1 ? "conta" : "contas"} para o nome novo.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor={`cor-${agencia?.agency ?? "novo"}`}>
            Cor da marca
          </Label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="color"
              value={cor || "#4A5568"}
              onChange={(e) => setCor(e.target.value.toUpperCase())}
              className="size-9 shrink-0 cursor-pointer rounded-md border border-hairline bg-transparent"
              aria-label="Escolher cor da marca"
            />
            <Input
              id={`cor-${agencia?.agency ?? "novo"}`}
              value={cor}
              onChange={(e) => setCor(e.target.value.toUpperCase())}
              placeholder="#2F6F4E"
              className="font-mono"
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Pinta o acento do relatório. Vazio = cinza neutro.
          </p>
        </div>

        <div>
          <Label>Logo</Label>
          <div className="mt-1.5 flex items-center gap-2">
            {logo && (
              <img
                src={logo}
                alt=""
                className="h-9 w-9 shrink-0 rounded-md object-contain"
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={enviandoLogo}
              onClick={() => arquivoRef.current?.click()}
            >
              {enviandoLogo ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {logo ? "Trocar" : "Enviar"}
            </Button>
            {logo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={() => setLogo("")}
              >
                Remover
              </Button>
            )}
            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarLogo(f);
                e.target.value = "";
              }}
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            PNG, JPG ou WEBP. SVG não serve — quebra a geração do PDF.
          </p>
        </div>

        <div>
          <Label htmlFor={`fee-${agencia?.agency ?? "novo"}`}>
            Honorário mensal
          </Label>
          <Input
            id={`fee-${agencia?.agency ?? "novo"}`}
            value={honorario}
            onChange={(e) => setHonorario(e.target.value)}
            inputMode="decimal"
            placeholder="2.500,00"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor={`dia-${agencia?.agency ?? "novo"}`}>
            Dia da cobrança
          </Label>
          <Input
            id={`dia-${agencia?.agency ?? "novo"}`}
            value={diaCobranca}
            onChange={(e) => setDiaCobranca(e.target.value)}
            inputMode="numeric"
            placeholder="10"
            className="mt-1.5"
          />
          <p className="mt-1.5 text-2xs text-muted-foreground">
            De 1 a 28 — fevereiro existe. Vazio = sem recorrência.
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`notas-${agencia?.agency ?? "novo"}`}>
            Observações
          </Label>
          <Textarea
            id={`notas-${agencia?.agency ?? "novo"}`}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" onClick={salvar} disabled={salvando}>
          {salvando && <Loader2 className="size-3.5 animate-spin" />}
          Salvar
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={onFechar}
          disabled={salvando}
        >
          Cancelar
        </Button>

        {/* A própria não sai: é ela que define quem é faturado direto. */}
        {editando && !agencia?.is_own && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-negative hover:bg-negative-muted hover:text-negative"
            onClick={remover}
            disabled={salvando}
          >
            <Trash2 className="size-3.5" />
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}
