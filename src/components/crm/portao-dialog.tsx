"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ETAPA_LABEL,
  MOTIVOS_PERDA,
  MOTIVO_LABEL,
  SERVICOS,
  SERVICO_LABEL,
} from "@/lib/crm/stages";
import {
  acaoSugerida,
  oQueFalta,
  type CampoDoPortao,
  type DealParaPortao,
} from "@/lib/crm/portoes";
import { formatCurrency, parseCurrencyToCents } from "@/lib/format";
import type {
  DealService,
  DealStage,
  DealWithRelations,
  LostReason,
  Profile,
} from "@/types/database";

/* =====================================================================
   O portão: pede só o que falta, na hora em que falta
   ---------------------------------------------------------------------
   Este diálogo é a outra metade da correção que a barra de captura
   começou. Criar um negócio custa um campo; AVANÇAR custa o que aquela
   etapa precisa — e a diferença entre as duas coisas é o que separa um
   CRM que a equipe usa de um que fica vazio.

   NÃO É UM FORMULÁRIO DE EDIÇÃO. Mostra exclusivamente os campos que o
   portão apontou como faltando. Arrastar um cartão que já tem tudo não
   abre diálogo nenhum: o negócio simplesmente move. Repetir a ficha
   inteira aqui reintroduziria o atrito que matou a versão anterior,
   só que num momento pior.

   CADA CAMPO VEM COM O PORQUÊ, em cinza, abaixo do rótulo. Não é
   enfeite: a diferença entre uma exigência que a pessoa entende e uma
   que ela contorna com dado falso é saber para que serve. Os textos
   vivem em `portoes.ts`, junto da regra que os gera.

   A PRÓXIMA AÇÃO CHEGA PREENCHIDA. É o campo exigido em toda
   movimentação, e é também o caminho mais curto para a equipe
   abandonar o sistema de novo. Com o passo óbvio da etapa já escrito e
   a data sugerida, a exigência custa um Enter.
   ===================================================================== */

export interface Preenchimento {
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  ownerId?: string | null;
  service?: DealService | null;
  referredBy?: string | null;
  monthlyFeeCents?: number;
  setupFeeCents?: number;
  expectedCloseDate?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
  lostReason?: LostReason | null;
}

interface Props {
  deal: DealWithRelations | null;
  destino: DealStage | null;
  team: Profile[];
  enviando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: (p: Preenchimento) => void;
}

/** Hoje + n dias, em YYYY-MM-DD no fuso local. */
function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function PortaoDialog({
  deal,
  destino,
  team,
  enviando,
  erro,
  onCancelar,
  onConfirmar,
}: Props) {
  const sugestao = destino ? acaoSugerida(destino) : null;

  /* Estado local por abertura. A `key` no <Dialog> força a remontagem
     a cada negócio, então não há resíduo de um cartão no outro. */
  const [p, setP] = useState<Preenchimento>({});
  const põe = (campo: keyof Preenchimento, v: unknown) =>
    setP((a) => ({ ...a, [campo]: v }));

  const faltando = useMemo(() => {
    if (!deal || !destino) return [];
    return oQueFalta(deal as unknown as DealParaPortao, destino);
  }, [deal, destino]);

  if (!deal || !destino) return null;

  const campos = new Set<CampoDoPortao>(faltando.map((f) => f.campo));
  const texto = (c: CampoDoPortao) => faltando.find((f) => f.campo === c);

  function confirmar() {
    /* A próxima ação sai com a sugestão quando quem move não escreveu
       nada — ver a nota do cabeçalho. Só entra no envio se a etapa
       realmente pedir: mandar em `perdido` gravaria um lembrete para
       um negócio que morreu. */
    const saida: Preenchimento = { ...p };

    if (campos.has("proxima_acao") && sugestao) {
      saida.nextAction = p.nextAction?.trim() || sugestao.texto;
      saida.nextActionAt = p.nextActionAt || emDias(sugestao.emDias);
    }

    onConfirmar(saida);
  }

  return (
    <Dialog
      key={`${deal.id}-${destino}`}
      open
      onOpenChange={(v) => {
        if (!v) onCancelar();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Mover para {ETAPA_LABEL[destino]}</DialogTitle>
          <DialogDescription>
            {deal.company} — falta{faltando.length > 1 ? "m" : ""}{" "}
            {faltando.length} {faltando.length > 1 ? "coisas" : "coisa"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {campos.has("contato") && (
            <Bloco exigencia={texto("contato")!}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Telefone"
                  aria-label="Telefone"
                  onChange={(e) => põe("contactPhone", e.target.value.trim() || null)}
                />
                <Input
                  placeholder="E-mail"
                  aria-label="E-mail"
                  onChange={(e) => põe("contactEmail", e.target.value.trim() || null)}
                />
              </div>
            </Bloco>
          )}

          {campos.has("indicacao") && (
            <Bloco exigencia={texto("indicacao")!}>
              <Input
                placeholder="Cliente ou parceiro que indicou"
                aria-label="Quem indicou"
                onChange={(e) => põe("referredBy", e.target.value.trim() || null)}
              />
            </Bloco>
          )}

          {campos.has("responsavel") && (
            <Bloco exigencia={texto("responsavel")!}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={p.ownerId ?? ""}
                  onValueChange={(v) => põe("ownerId", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Responsável">
                      {(v: string) =>
                        team.find((t) => t.id === v)?.full_name ?? "Responsável"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {team.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Quem fala do outro lado"
                  aria-label="Nome do contato"
                  defaultValue={deal.contact_name ?? ""}
                  onChange={(e) => põe("contactName", e.target.value.trim() || null)}
                />
              </div>
            </Bloco>
          )}

          {campos.has("proposta") && (
            <Bloco exigencia={texto("proposta")!}>
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={p.service ?? ""}
                  onValueChange={(v) => põe("service", v as DealService)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Serviço">
                      {(v: string) => SERVICO_LABEL[v as DealService] ?? "Serviço"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICOS.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Mensalidade"
                  aria-label="Mensalidade"
                  defaultValue={
                    deal.monthly_fee_cents
                      ? formatCurrency(deal.monthly_fee_cents)
                      : ""
                  }
                  onChange={(e) =>
                    põe("monthlyFeeCents", parseCurrencyToCents(e.target.value))
                  }
                />
                <Input
                  placeholder="Entrada"
                  aria-label="Entrada ou setup"
                  defaultValue={
                    deal.setup_fee_cents ? formatCurrency(deal.setup_fee_cents) : ""
                  }
                  onChange={(e) =>
                    põe("setupFeeCents", parseCurrencyToCents(e.target.value))
                  }
                />
              </div>
            </Bloco>
          )}

          {campos.has("previsao") && (
            <Bloco exigencia={texto("previsao")!}>
              <Input
                type="date"
                aria-label="Previsão de fechamento"
                defaultValue={deal.expected_close_date ?? emDias(14)}
                onChange={(e) => põe("expectedCloseDate", e.target.value || null)}
              />
            </Bloco>
          )}

          {campos.has("motivo") && (
            <Bloco exigencia={texto("motivo")!}>
              <Select
                value={p.lostReason ?? ""}
                onValueChange={(v) => põe("lostReason", v as LostReason)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Escolha o motivo">
                    {(v: string) =>
                      MOTIVO_LABEL[v as LostReason] ?? "Escolha o motivo"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS_PERDA.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Bloco>
          )}

          {campos.has("proxima_acao") && sugestao && (
            <Bloco exigencia={texto("proxima_acao")!}>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  defaultValue={sugestao.texto}
                  aria-label="Próximo passo"
                  onChange={(e) => põe("nextAction", e.target.value)}
                />
                <Input
                  type="date"
                  aria-label="Quando"
                  defaultValue={emDias(sugestao.emDias)}
                  onChange={(e) => põe("nextActionAt", e.target.value || null)}
                />
              </div>
            </Bloco>
          )}
        </div>

        {erro && <p className="text-xs text-negative">{erro}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando}>
            {enviando && <Loader2 className="size-4 animate-spin" />}
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rótulo, motivo e campo — o motivo é o que impede o dado falso. */
function Bloco({
  exigencia,
  children,
}: {
  exigencia: { pergunta: string; porque: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{exigencia.pergunta}</Label>
      <p className="-mt-0.5 text-xs leading-snug text-muted-foreground">
        {exigencia.porque}
      </p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
