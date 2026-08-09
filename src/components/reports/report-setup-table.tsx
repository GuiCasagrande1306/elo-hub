"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { salvarAgendaDeRelatorio } from "@/app/(app)/relatorios/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { WhatsAppDestinationPicker } from "@/components/clients/whatsapp-destination-picker";
import { cn } from "@/lib/utils";
import type { ReportSetupRow } from "@/lib/data";

/* =====================================================================
   Agenda de envio — destino, dia e liga/desliga por cliente
   ---------------------------------------------------------------------
   POR QUE ESTA TELA EXISTE. Medido em 08/08/2026, na carteira real: 47
   contas ativas, ZERO com envio ligado, ZERO com dia definido, 7 com
   WhatsApp. O cron nunca teve o que preparar, a fila nascia vazia todo
   dia e nada na página dizia por quê — ela mostrava o fluxo pronto
   como se estivesse rodando.

   A causa não é preguiça: isso só era editável dentro do formulário
   completo de cada cliente, um diálogo por vez. Quarenta e sete vezes
   abrir, rolar até o campo, salvar, fechar. É a mesma barreira que a
   tabela de Contratos em Recorrência resolveu, e a solução é a mesma —
   edição NA PRÓPRIA LINHA, cada uma salvando sozinha, para parar no
   meio não perder nada.

   O picker de grupo do WhatsApp só busca a lista AO ABRIR, e o servidor
   memoiza por 10 minutos. Por isso dá para ter um por linha sem que 47
   deles disparem 47 requisições ao carregar a página.
   ===================================================================== */

interface Rascunho {
  whatsapp: string;
  dia: string;
  ativo: boolean;
}

function estaPronto(linha: ReportSetupRow): boolean {
  return Boolean(linha.reportEnabled && linha.reportDay && linha.whatsappPhone);
}

export function ReportSetupTable({ linhas }: { linhas: ReportSetupRow[] }) {
  const [busca, setBusca] = useState("");
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /* Fechada por padrão QUANDO JÁ ESTÁ TUDO PRONTO. Uma tabela de 47
     linhas no topo da página seria ruído permanente depois de
     configurada — mas enquanto houver pendência ela precisa estar
     aberta, senão vira mais uma gaveta que ninguém abre. */
  const prontos = linhas.filter(estaPronto).length;
  const pendentes = linhas.length - prontos;
  const [aberta, setAberta] = useState(pendentes > 0);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = termo
      ? linhas.filter((l) => l.name.toLowerCase().includes(termo))
      : linhas;
    /* Pendentes primeiro: é a lista de trabalho, não um cadastro. Quem
       já está pronto não precisa ser revisitado. */
    return [...base].sort(
      (a, b) => Number(estaPronto(a)) - Number(estaPronto(b)),
    );
  }, [linhas, busca]);

  function valorAtual(linha: ReportSetupRow): Rascunho {
    return (
      rascunhos[linha.id] ?? {
        whatsapp: linha.whatsappPhone ?? "",
        dia: linha.reportDay ? String(linha.reportDay) : "",
        ativo: linha.reportEnabled,
      }
    );
  }

  function editar(linha: ReportSetupRow, patch: Partial<Rascunho>) {
    setRascunhos((atual) => ({
      ...atual,
      [linha.id]: { ...(atual[linha.id] ?? valorAtual(linha)), ...patch },
    }));
  }

  function salvar(linha: ReportSetupRow) {
    const { whatsapp, dia, ativo } = valorAtual(linha);

    const diaLimpo = dia.trim();
    const diaNum = diaLimpo === "" ? null : Number(diaLimpo);

    if (diaNum !== null && (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 28)) {
      toast.error("O dia precisa estar entre 1 e 28.");
      return;
    }

    setSalvando(linha.id);

    startTransition(async () => {
      const r = await salvarAgendaDeRelatorio({
        clientId: linha.id,
        reportDay: diaNum,
        enabled: ativo,
        whatsapp,
      });

      setSalvando(null);

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      // Limpa o rascunho para a linha voltar a ler do servidor.
      setRascunhos((atual) => {
        const proximo = { ...atual };
        delete proximo[linha.id];
        return proximo;
      });

      toast.success(`${linha.name}: agenda salva.`);
    });
  }

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.015em]">
            Agenda de envio
            {pendentes > 0 && (
              <span className="rounded-full bg-warning-muted px-2 py-0.5 text-2xs font-medium text-warning">
                {pendentes} {pendentes === 1 ? "pendente" : "pendentes"}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pendentes === 0
              ? `Todas as ${linhas.length} contas ativas têm destino e dia definidos.`
              : "Sem destino e dia, o robô não prepara nada e a fila abaixo nasce vazia."}
          </p>
        </div>

        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {prontos} de {linhas.length}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            aberta && "rotate-180",
          )}
        />
      </button>

      {aberta && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="relative max-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente…"
              className="h-9 pl-8"
              aria-label="Buscar cliente"
            />
          </div>

          <div className="surface-card overflow-hidden">
            <div className="hidden grid-cols-[1fr_260px_80px_92px_92px] gap-3 border-b border-hairline px-4 py-2.5 lg:grid">
              {["Cliente", "Destino no WhatsApp", "Dia", "Automático", ""].map(
                (label, i) => (
                  <span key={label || i} className="eyebrow">
                    {label}
                  </span>
                ),
              )}
            </div>

            {filtradas.length === 0 ? (
              <p className="py-14 text-center text-sm text-muted-foreground">
                Nenhum cliente com esse nome.
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {filtradas.map((linha) => {
                  const rascunho = valorAtual(linha);
                  const alterado = Boolean(rascunhos[linha.id]);
                  const incompleto = !estaPronto(linha) && !alterado;

                  return (
                    <li
                      key={linha.id}
                      className="grid grid-cols-1 gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[1fr_260px_80px_92px_92px] lg:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ClientAvatar
                          name={linha.name}
                          logoUrl={linha.logoUrl}
                          brandPrimary={linha.brandPrimary}
                        />
                        <span className="truncate text-sm font-medium">
                          {linha.name}
                        </span>
                        {incompleto && (
                          <TriangleAlert
                            className="size-3.5 shrink-0 text-warning"
                            aria-label="Não entra no preparo automático"
                          />
                        )}
                      </div>

                      <WhatsAppDestinationPicker
                        value={rascunho.whatsapp}
                        onChange={(v) => editar(linha, { whatsapp: v })}
                        disabled={salvando === linha.id}
                      />

                      <Input
                        value={rascunho.dia}
                        onChange={(e) => editar(linha, { dia: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") salvar(linha);
                        }}
                        placeholder="—"
                        inputMode="numeric"
                        maxLength={2}
                        className="h-8 text-sm tabular-nums"
                        aria-label={`Dia do envio de ${linha.name}`}
                      />

                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={rascunho.ativo}
                          onChange={(e) =>
                            editar(linha, { ativo: e.target.checked })
                          }
                          className="size-3.5 accent-[var(--primary)]"
                          aria-label={`Envio automático de ${linha.name}`}
                        />
                        <span className="lg:hidden">Automático</span>
                      </label>

                      <div className="flex lg:justify-end">
                        <Button
                          size="sm"
                          variant={alterado ? "default" : "ghost"}
                          className="h-8 px-2.5 text-xs"
                          disabled={!alterado || salvando === linha.id}
                          onClick={() => salvar(linha)}
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
      )}
    </section>
  );
}
