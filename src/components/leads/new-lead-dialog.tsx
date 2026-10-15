"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarLead } from "@/app/(app)/leads/actions";
import { ORIGENS_LEAD, ORIGEM_LEAD_LABEL } from "@/lib/leads/vocabulario";
import { parseCurrencyToCents } from "@/lib/format";
import type { LeadSource, LeadStage, Profile } from "@/types/database";

/* =====================================================================
   Novo lead
   ---------------------------------------------------------------------
   CURTO DE PROPÓSITO. Este formulário é preenchido com o telefone no
   ouvido — alguém ligou, e a pessoa está do outro lado esperando. Cada
   campo obrigatório a mais é uma chance de o lead ir para um papel e
   nunca chegar ao funil.

   Só o nome é exigido. Telefone, e-mail e valor entram quando existirem.

   O NOME PREENCHE OS DOIS LADOS: vira o título do lead e o nome do
   contato. Em CRM de empresa, título ("Reforma da fachada") e contato
   ("Marcos") são coisas diferentes; num funil de lead de anúncio, quem
   chegou É o assunto. Pedir os dois faria todo mundo digitar o mesmo
   nome duas vezes.
   ===================================================================== */

export function NewLeadDialog({
  clientId,
  pipelineId,
  stages,
  team,
  podeAtribuir,
  open,
  onOpenChange,
  onCriado,
}: {
  clientId: string;
  pipelineId: string;
  stages: LeadStage[];
  team: Profile[];
  podeAtribuir: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCriado: (dealId: string) => void;
}) {
  const [salvando, iniciar] = useTransition();

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [origem, setOrigem] = useState<LeadSource>("manual");
  const [valor, setValor] = useState("");
  const [dono, setDono] = useState("__ninguem__");

  /* LIMPA AO REABRIR, ajustando o estado DURANTE O RENDER.
     Reaproveitar o preenchimento anterior faria o segundo lead nascer
     com o telefone do primeiro.

     ⚠️ Não é um `useEffect`, e a diferença não é de estilo: zerar seis
     campos dentro de um effect dispara `react-hooks/set-state-in-effect`
     — o render acontece com os dados velhos e um segundo render os
     apaga. Comparar com o valor anterior aqui em cima é o padrão que o
     próprio React documenta para "ajustar estado quando uma prop muda",
     e o descarte acontece antes de qualquer coisa ir para a tela.

     A comparação é com `estavaAberto`, e não com `open` direto: só a
     transição fechado→aberto limpa. Zerar na transição inversa esvaziaria
     o formulário à vista de quem está fechando o diálogo. */
  const [estavaAberto, setEstavaAberto] = useState(open);
  if (open !== estavaAberto) {
    setEstavaAberto(open);
    if (open) {
      setNome("");
      setTelefone("");
      setEmail("");
      setOrigem("manual");
      setValor("");
      setDono("__ninguem__");
    }
  }

  /* A primeira etapa ABERTA, não a primeira da lista. Se alguém
     reordenar o funil e deixar "Perdido" na frente, um lead novo nasceria
     descartado — e sem motivo, que o banco nem exige. */
  const entrada = stages.find((e) => e.kind === "aberto") ?? stages[0] ?? null;

  function salvar() {
    const limpo = nome.trim();
    if (!limpo || !entrada) return;

    iniciar(async () => {
      const r = await criarLead({
        clientId,
        pipelineId,
        stageId: entrada.id,
        title: limpo,
        contactName: limpo,
        contactPhone: telefone.trim() || null,
        contactEmail: email.trim() || null,
        source: origem,
        valueCents: parseCurrencyToCents(valor) ?? 0,
        ownerId: dono === "__ninguem__" ? null : dono,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onCriado(r.dealId);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[94vw] overflow-y-auto sm:max-w-[min(94vw,520px)]">
        <DialogTitle>Novo lead</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Entra na etapa{" "}
          <span className="font-medium text-foreground">
            {entrada?.name ?? "inicial"}
          </span>
          . Só o nome é obrigatório.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Campo label="Nome">
            <Input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  salvar();
                }
              }}
              placeholder="Quem entrou em contato"
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Telefone">
              <Input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(47) 99999-9999"
                inputMode="tel"
              />
            </Campo>

            <Campo label="Origem">
              <Select
                value={origem}
                onValueChange={(v) => setOrigem(v as LeadSource)}
              >
                <SelectTrigger className="w-full">
                  {/* ⚠️ `SelectValue` do Base UI recebe uma FUNÇÃO. */}
                  <SelectValue>
                    {(v: string) => ORIGEM_LEAD_LABEL[v as LeadSource] ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS_LEAD.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>

            <Campo label="E-mail">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="opcional"
                inputMode="email"
              />
            </Campo>

            <Campo label="Valor estimado">
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="opcional"
                inputMode="decimal"
              />
            </Campo>
          </div>

          {podeAtribuir && (
            <Campo label="Responsável">
              <Select value={dono} onValueChange={(v) => setDono(v ?? "__ninguem__")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === "__ninguem__"
                        ? "Ninguém"
                        : (team.find((p) => p.id === v)?.full_name ?? "Ninguém")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ninguem__">Ninguém</SelectItem>
                  {team.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !nome.trim() || !entrada}>
            {salvando ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Criar lead
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}
