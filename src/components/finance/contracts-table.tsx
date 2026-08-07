"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { salvarContrato } from "@/app/(app)/gestao/recorrencia/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { formatCurrency, parseCurrencyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Client, ClientFinancials } from "@/types/database";

/* =====================================================================
   Contratos — honorário e dia de vencimento, por cliente
   ---------------------------------------------------------------------
   Edição na PRÓPRIA LINHA, não em modal. São 46 clientes a preencher de
   uma vez, vindos de uma planilha: abrir e fechar um diálogo 46 vezes é
   a diferença entre a tela ser usada e a planilha continuar aberta ao
   lado. Cada linha salva sozinha, então parar no meio não perde nada.
   ===================================================================== */

interface Props {
  clients: Client[];
  financials: Record<string, Pick<ClientFinancials, "monthly_fee_cents" | "billing_day">>;
}

interface Rascunho {
  fee: string;
  dia: string;
}

export function ContractsTable({ clients, financials }: Props) {
  const [busca, setBusca] = useState("");
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(termo));
  }, [clients, busca]);

  /* Quantos contratos o job consegue materializar hoje. É o número que
     diz se a tela terminou de ser preenchida — e o único jeito de
     descobrir isso antes de rodar o job e ver o resultado curto. */
  const prontos = clients.filter((c) => {
    const f = financials[c.id];
    return f && f.monthly_fee_cents > 0 && f.billing_day;
  }).length;

  function valorAtual(client: Client): Rascunho {
    const rascunho = rascunhos[client.id];
    if (rascunho) return rascunho;

    const f = financials[client.id];
    return {
      fee: f && f.monthly_fee_cents > 0 ? formatCurrency(f.monthly_fee_cents) : "",
      dia: f?.billing_day ? String(f.billing_day) : "",
    };
  }

  function editar(clientId: string, campo: keyof Rascunho, valor: string) {
    setRascunhos((atual) => {
      const base = atual[clientId] ?? valorAtual(
        clients.find((c) => c.id === clientId)!,
      );
      return { ...atual, [clientId]: { ...base, [campo]: valor } };
    });
  }

  function salvar(client: Client) {
    const { fee, dia } = valorAtual(client);

    const cents = parseCurrencyToCents(fee);
    if (cents === null) {
      toast.error(`Valor inválido em ${client.name}.`);
      return;
    }

    /* Dia em branco é ESTADO VÁLIDO, não erro: significa "contrato sem
       cobrança recorrente", e o job pula. Um cliente em permuta ou em
       período de teste precisa desse estado. */
    const diaLimpo = dia.trim();
    const diaNum = diaLimpo === "" ? null : Number(diaLimpo);

    if (diaNum !== null && (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 28)) {
      toast.error("O dia precisa estar entre 1 e 28.");
      return;
    }

    setSalvando(client.id);

    startTransition(async () => {
      const r = await salvarContrato({
        clientId: client.id,
        monthlyFeeCents: cents,
        billingDay: diaNum,
      });

      setSalvando(null);

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      // Limpa o rascunho para a linha voltar a ler do servidor — assim
      // o que a tela mostra é o que foi gravado, não o que foi digitado.
      setRascunhos((atual) => {
        const proximo = { ...atual };
        delete proximo[client.id];
        return proximo;
      });

      toast.success(`${client.name} atualizado.`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente…"
            className="h-9 pl-8"
            aria-label="Buscar cliente"
          />
        </div>

        <span
          className={cn(
            "ml-auto text-2xs tabular-nums",
            prontos === clients.length
              ? "text-muted-foreground"
              : "font-medium text-warning",
          )}
        >
          {prontos} de {clients.length} prontos para faturar
        </span>
      </div>

      <div className="surface-card overflow-hidden">
        <div className="hidden grid-cols-[1fr_150px_92px_92px] gap-4 border-b border-hairline px-4 py-2.5 lg:grid">
          {["Cliente", "Honorário", "Dia", ""].map((label, i) => (
            <span key={label || i} className="eyebrow">
              {label}
            </span>
          ))}
        </div>

        {filtrados.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            Nenhum cliente com esse nome.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtrados.map((client) => {
              const { fee, dia } = valorAtual(client);
              const gravado = financials[client.id];
              const alterado = Boolean(rascunhos[client.id]);
              const incompleto =
                !gravado || gravado.monthly_fee_cents <= 0 || !gravado.billing_day;

              return (
                <li
                  key={client.id}
                  className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[1fr_150px_92px_92px] lg:items-center"
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
                    <ClientAvatar
                      name={client.name}
                      logoUrl={client.logo_url}
                      brandPrimary={client.brand_primary}
                    />
                    <span className="truncate text-sm font-medium">
                      {client.name}
                    </span>
                    {incompleto && !alterado && (
                      <TriangleAlert
                        className="size-3.5 shrink-0 text-warning"
                        aria-label="Não entra no faturamento do mês"
                      />
                    )}
                  </div>

                  <Input
                    value={fee}
                    onChange={(e) => editar(client.id, "fee", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvar(client);
                    }}
                    placeholder="R$ 0,00"
                    inputMode="decimal"
                    className="h-8 text-sm tabular-nums"
                    aria-label={`Honorário de ${client.name}`}
                  />

                  <Input
                    value={dia}
                    onChange={(e) => editar(client.id, "dia", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvar(client);
                    }}
                    placeholder="—"
                    inputMode="numeric"
                    maxLength={2}
                    className="h-8 text-sm tabular-nums"
                    aria-label={`Dia de vencimento de ${client.name}`}
                  />

                  <div className="flex lg:justify-end">
                    <Button
                      size="sm"
                      variant={alterado ? "default" : "ghost"}
                      className="h-8 px-2.5 text-xs"
                      disabled={!alterado || salvando === client.id}
                      onClick={() => salvar(client)}
                    >
                      <Check className="size-3.5" />
                      Salvar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
