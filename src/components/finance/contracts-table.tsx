"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Handshake, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  salvarContrato,
  salvarContratoDeAgencia,
} from "@/app/(app)/gestao/recorrencia/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { formatCurrency, parseCurrencyToCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Contratos — quem paga, quanto e em que dia
   ---------------------------------------------------------------------
   DUAS ORIGENS NA MESMA LISTA, e é isso que a tela tem de deixar óbvio:
   cliente da Elo é cobrado direto; cliente terceirizado não é cobrado —
   quem paga é a agência dele, um valor só. Listar os 46 clientes pedia
   honorário e dia para 22 contratos que não existem, e o contador dizia
   "0 de 46" para uma carteira que precisa de 27 cobranças.

   As agências vêm PRIMEIRO porque cada linha delas vale por muitas: uma
   agência sem honorário é receita de onze clientes sumindo em silêncio,
   e o alarme precisa estar no alto da página, não abaixo de vinte e
   quatro linhas.

   Edição na PRÓPRIA LINHA, não em modal: são dezenas de contratos a
   preencher de uma vez, vindos de uma planilha, e abrir e fechar um
   diálogo a cada um é a diferença entre a tela ser usada e a planilha
   continuar aberta ao lado. Cada linha salva sozinha, então parar no
   meio não perde nada.
   ===================================================================== */

export interface LinhaDeContrato {
  /** `cliente:<uuid>` ou `agencia:<nome>`. */
  key: string;
  tipo: "cliente" | "agencia";
  /** uuid do cliente, ou o nome da agência — é a chave dela no banco. */
  id: string;
  nome: string;
  feeCents: number;
  billingDay: number | null;
  /** Só cliente. */
  logoUrl?: string | null;
  brandPrimary?: string | null;
  /** Só agência: quantos clientes ativos este único valor cobre. */
  clientes?: number;
}

interface Rascunho {
  fee: string;
  dia: string;
}

function estaPronto(linha: LinhaDeContrato): boolean {
  return linha.feeCents > 0 && linha.billingDay !== null;
}

export function ContractsTable({ linhas }: { linhas: LinhaDeContrato[] }) {
  const [busca, setBusca] = useState("");
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter((l) => l.nome.toLowerCase().includes(termo));
  }, [linhas, busca]);

  const agencias = filtradas.filter((l) => l.tipo === "agencia");
  const clientes = filtradas.filter((l) => l.tipo === "cliente");

  /* Quantos contratos o job consegue materializar hoje. É o número que
     diz se a tela terminou de ser preenchida — e o único jeito de
     descobrir isso antes de rodar o job e ver o resultado curto. */
  const prontos = linhas.filter(estaPronto).length;

  function valorAtual(linha: LinhaDeContrato): Rascunho {
    const rascunho = rascunhos[linha.key];
    if (rascunho) return rascunho;

    return {
      fee: linha.feeCents > 0 ? formatCurrency(linha.feeCents) : "",
      dia: linha.billingDay ? String(linha.billingDay) : "",
    };
  }

  function editar(linha: LinhaDeContrato, campo: keyof Rascunho, valor: string) {
    setRascunhos((atual) => ({
      ...atual,
      [linha.key]: { ...(atual[linha.key] ?? valorAtual(linha)), [campo]: valor },
    }));
  }

  function salvar(linha: LinhaDeContrato) {
    const { fee, dia } = valorAtual(linha);

    const cents = parseCurrencyToCents(fee);
    if (cents === null) {
      toast.error(`Valor inválido em ${linha.nome}.`);
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

    setSalvando(linha.key);

    startTransition(async () => {
      const r =
        linha.tipo === "agencia"
          ? await salvarContratoDeAgencia({
              agency: linha.id,
              monthlyFeeCents: cents,
              billingDay: diaNum,
            })
          : await salvarContrato({
              clientId: linha.id,
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
        delete proximo[linha.key];
        return proximo;
      });

      toast.success(`${linha.nome} atualizado.`);
    });
  }

  const totalAgencias = linhas.filter((l) => l.tipo === "agencia").length;
  const totalClientes = linhas.length - totalAgencias;
  const cobertos = linhas.reduce((acc, l) => acc + (l.clientes ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente ou agência…"
            className="h-9 pl-8"
            aria-label="Buscar cliente ou agência"
          />
        </div>

        <span
          className={cn(
            "ml-auto text-2xs tabular-nums",
            prontos === linhas.length
              ? "text-muted-foreground"
              : "font-medium text-warning",
          )}
        >
          {prontos} de {linhas.length} prontos para faturar
        </span>
      </div>

      <div className="surface-card overflow-hidden">
        <div className="hidden grid-cols-[1fr_150px_92px_92px] gap-4 border-b border-hairline px-4 py-2.5 lg:grid">
          {["Contrato", "Honorário", "Dia", ""].map((label, i) => (
            <span key={label || i} className="eyebrow">
              {label}
            </span>
          ))}
        </div>

        {filtradas.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            Nada com esse nome.
          </p>
        ) : (
          <>
            {agencias.length > 0 && (
              <>
                <GrupoHeader
                  titulo="Agências parceiras"
                  detalhe={
                    cobertos > 0
                      ? `um valor só cobre ${cobertos} ${
                          cobertos === 1 ? "cliente" : "clientes"
                        }`
                      : "cobrança única por parceira"
                  }
                />
                <ul className="divide-y divide-hairline">
                  {agencias.map((linha) => (
                    <Linha
                      key={linha.key}
                      linha={linha}
                      rascunho={valorAtual(linha)}
                      alterado={Boolean(rascunhos[linha.key])}
                      salvando={salvando === linha.key}
                      onEditar={editar}
                      onSalvar={salvar}
                    />
                  ))}
                </ul>
              </>
            )}

            {clientes.length > 0 && (
              <>
                <GrupoHeader
                  titulo="Clientes diretos"
                  detalhe={`faturados pela Elo · ${totalClientes} ${
                    totalClientes === 1 ? "conta" : "contas"
                  }`}
                />
                <ul className="divide-y divide-hairline">
                  {clientes.map((linha) => (
                    <Linha
                      key={linha.key}
                      linha={linha}
                      rascunho={valorAtual(linha)}
                      alterado={Boolean(rascunhos[linha.key])}
                      salvando={salvando === linha.key}
                      onEditar={editar}
                      onSalvar={salvar}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function GrupoHeader({
  titulo,
  detalhe,
}: {
  titulo: string;
  detalhe: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-hairline bg-surface-2 px-4 py-2">
      <span className="eyebrow">{titulo}</span>
      <span className="text-2xs text-muted-foreground">{detalhe}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Linha({
  linha,
  rascunho,
  alterado,
  salvando,
  onEditar,
  onSalvar,
}: {
  linha: LinhaDeContrato;
  rascunho: Rascunho;
  alterado: boolean;
  salvando: boolean;
  onEditar: (l: LinhaDeContrato, campo: keyof Rascunho, valor: string) => void;
  onSalvar: (l: LinhaDeContrato) => void;
}) {
  const ehAgencia = linha.tipo === "agencia";

  /* Incompleto olha o que está GRAVADO, não o rascunho: o aviso some
     quando o valor entra no banco, não quando alguém digita. */
  const incompleto = !estaPronto(linha) && !alterado;

  /* Agência sem contrato fechado é o caso caro: os clientes dela já não
     geram cobrança própria, então o mês inteiro deles some do faturamento
     se este campo ficar vazio. Cliente direto sem honorário é uma conta a
     menos; agência sem honorário são onze. */
  const critico = incompleto && ehAgencia && (linha.clientes ?? 0) > 0;

  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[1fr_150px_92px_92px] lg:items-center">
      <div className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
        {ehAgencia ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-signal-muted text-signal">
            <Handshake className="size-3" />
          </span>
        ) : (
          <ClientAvatar
            name={linha.nome}
            logoUrl={linha.logoUrl ?? null}
            brandPrimary={linha.brandPrimary ?? null}
          />
        )}

        <span className="truncate text-sm font-medium">{linha.nome}</span>

        {ehAgencia && (linha.clientes ?? 0) > 0 && (
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            {linha.clientes} {linha.clientes === 1 ? "cliente" : "clientes"}
          </span>
        )}

        {incompleto && (
          <TriangleAlert
            className={cn(
              "size-3.5 shrink-0",
              critico ? "text-negative" : "text-warning",
            )}
            aria-label={
              critico
                ? `${linha.clientes} clientes ficam sem cobrança neste mês`
                : "Não entra no faturamento do mês"
            }
          />
        )}
      </div>

      <Input
        value={rascunho.fee}
        onChange={(e) => onEditar(linha, "fee", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSalvar(linha);
        }}
        placeholder="R$ 0,00"
        inputMode="decimal"
        className="h-8 text-sm tabular-nums"
        aria-label={`Honorário de ${linha.nome}`}
      />

      <Input
        value={rascunho.dia}
        onChange={(e) => onEditar(linha, "dia", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSalvar(linha);
        }}
        placeholder="—"
        inputMode="numeric"
        maxLength={2}
        className="h-8 text-sm tabular-nums"
        aria-label={`Dia de vencimento de ${linha.nome}`}
      />

      <div className="flex lg:justify-end">
        <Button
          size="sm"
          variant={alterado ? "default" : "ghost"}
          className="h-8 px-2.5 text-xs"
          disabled={!alterado || salvando}
          onClick={() => onSalvar(linha)}
        >
          <Check className="size-3.5" />
          Salvar
        </Button>
      </div>
    </li>
  );
}
