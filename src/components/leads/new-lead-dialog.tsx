"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarLead } from "@/app/(app)/crm/actions";
import { ROTULO_ORIGEM, type LeadSource, type LeadStage } from "@/lib/crm/types";

/* =====================================================================
   Cadastrar um lead
   ---------------------------------------------------------------------
   UM CAMPO OBRIGATÓRIO, e é o nome. Tudo o mais é opcional de propósito:
   o lead costuma ser cadastrado com o telefone tocando, e um formulário
   que exige valor estimado e origem antes de deixar salvar é um
   formulário que a pessoa abandona — o lead vira um post-it e some.

   O TELEFONE É O CAMPO QUE MAIS PAGA. É por ele que o cadastro reconhece
   que o Sr. José que ligou hoje é o mesmo que pediu orçamento em março:
   `criarLead` procura o contato pelo número antes de criar outro. Sem
   telefone, cada ligação vira uma pessoa nova e o histórico nunca
   existe. Daí o aviso embaixo do campo em vez de uma obrigatoriedade
   que travaria o cadastro.
   ===================================================================== */

const ORIGENS = Object.entries(ROTULO_ORIGEM) as [LeadSource, string][];

interface Props {
  aberto: boolean;
  onFechar: () => void;
  clientId: string;
  pipelineId: string;
  stages: LeadStage[];
  /** Coluna em que o card nasce — vem do "+" da própria coluna. */
  stageInicial: string | null;
}

export function NewLeadDialog({
  aberto,
  onFechar,
  clientId,
  pipelineId,
  stages,
  stageInicial,
}: Props) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState<LeadSource>("manual");
  /* A ETAPA É DERIVADA, não copiada para o estado.
     O "+" de cada coluna abre este diálogo com uma `stageInicial`
     diferente, e guardar isso num `useState` fazia o segundo lead do
     dia cair sempre na coluna do primeiro — o estado inicial só é lido
     na primeira montagem. A escolha manual entra como exceção e é
     zerada ao fechar. */
  const [escolhaManual, setEscolhaManual] = useState<string | null>(null);
  const stageId = escolhaManual ?? stageInicial ?? stages[0]?.id ?? "";
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  function limpar() {
    setEscolhaManual(null);
    setTitle("");
    setValue("");
    setSource("manual");
    setContactName("");
    setContactPhone("");
    setContactEmail("");
  }

  function salvar() {
    if (!title.trim()) return toast.error("Dê um nome ao lead.");
    if (!stageId) return toast.error("Escolha a etapa.");

    iniciar(async () => {
      const r = await criarLead({
        clientId,
        pipelineId,
        stageId,
        title,
        value,
        source,
        contactName,
        contactPhone,
        contactEmail,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success("Lead cadastrado.");
      limpar();
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (v) return;
        setEscolhaManual(null);
        onFechar();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Só o nome é obrigatório. O resto pode entrar depois.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-title">Nome do lead</Label>
            <Input
              id="lead-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Orçamento de cozinha — Sr. José"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-value">Valor estimado</Label>
              <Input
                id="lead-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="1.250,00"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Etapa</Label>
              <Select value={stageId} onValueChange={(v) => setEscolhaManual(v ?? null)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      stages.find((s) => s.id === v)?.name ?? "Escolher"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Origem</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource((v as LeadSource) ?? "manual")}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => ROTULO_ORIGEM[v as LeadSource] ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ORIGENS.map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-hairline p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-phone">Telefone</Label>
              <Input
                id="lead-phone"
                inputMode="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(47) 99999-8888"
              />
              <p className="text-[10px] text-muted-foreground">
                É o telefone que faz o sistema reconhecer quem já falou com
                você antes.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-contact">Nome do contato</Label>
                <Input
                  id="lead-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="José da Silva"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-email">E-mail</Label>
                <Input
                  id="lead-email"
                  inputMode="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="jose@email.com"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button
            variant="ghost"
            disabled={salvando}
            onClick={() => {
              setEscolhaManual(null);
              onFechar();
            }}
          >
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
