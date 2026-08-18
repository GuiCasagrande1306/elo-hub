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
  /** Dia do mês, 1–28. Vazio = sem relatório mensal. */
  diaDoMes: string;
  /** Dia da semana, 0–6. Vazio = sem relatório semanal. */
  diaDaSemana: string;
  ativo: boolean;
}

/** 0=domingo, como `Date.getDay()` e como o `dow` do Postgres. */
const DIAS_DA_SEMANA = [
  { valor: "", rotulo: "—" },
  { valor: "1", rotulo: "Segunda" },
  { valor: "2", rotulo: "Terça" },
  { valor: "3", rotulo: "Quarta" },
  { valor: "4", rotulo: "Quinta" },
  { valor: "5", rotulo: "Sexta" },
  { valor: "6", rotulo: "Sábado" },
  { valor: "0", rotulo: "Domingo" },
];

/**
 * Pronto = ligado, com destino e com PELO MENOS UMA agenda.
 *
 * As duas são independentes desde a migration 48: mensal (fechamento do
 * mês anterior) e semanal (últimos 7 dias) podem coexistir na mesma
 * conta, e é comum que coexistam.
 */
function estaPronto(linha: ReportSetupRow): boolean {
  const temQuando =
    Boolean(linha.reportDay) ||
    (linha.reportWeekday !== null && linha.reportWeekday !== undefined);

  return Boolean(linha.reportEnabled && temQuando && linha.whatsappPhone);
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

  /* Quantos relatórios cabem numa rodada do cron.
     Um relatório custa ~6s medidos, e a fase de preparo tem ~37s do teto
     da função — daí seis. Não é um palpite de folga: o cliente que não
     couber é ADIADO, e adiado não volta amanhã, porque o `report_day`
     dele não bate mais. Ele perde o relatório do mês.

     Fica aqui, na tela, porque é onde a decisão é tomada. Descobrir o
     teto só no dia em que o cron rodar custa um mês de relatório para
     quem ficou de fora. */
  const CABEM_POR_RODADA = 6;

  /* Só conta quem está LIGADO e pronto: cliente com dia definido mas
     desligado não disputa tempo nenhum. */
  const lotacao = useMemo(() => {
    const contagem = new Map<string, number>();
    /* Uma conta com as DUAS agendas ocupa vaga nos dois dias, e é assim
       que ela chega ao cron — duas entradas, duas janelas. Contar uma vez
       só faria a tela subestimar a lotação justamente das contas mais
       exigentes. */
    for (const l of linhas) {
      if (!l.reportEnabled) continue;
      if (l.reportDay) {
        const k = `mes-${l.reportDay}`;
        contagem.set(k, (contagem.get(k) ?? 0) + 1);
      }
      if (l.reportWeekday !== null && l.reportWeekday !== undefined) {
        const k = `sem-${l.reportWeekday}`;
        contagem.set(k, (contagem.get(k) ?? 0) + 1);
      }
    }

    return [...contagem.entries()]
      .filter(([, n]) => n > CABEM_POR_RODADA)
      .map(([chave, n]) => {
        const [tipo, valor] = chave.split("-");
        const rotulo =
          tipo === "sem"
            ? (DIAS_DA_SEMANA.find((d) => d.valor === valor)?.rotulo ?? valor)
            : `dia ${valor}`;
        return { rotulo, n };
      })
      .sort((a, b) => b.n - a.n);
  }, [linhas]);
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
        diaDoMes: linha.reportDay ? String(linha.reportDay) : "",
        diaDaSemana:
          linha.reportWeekday === null || linha.reportWeekday === undefined
            ? ""
            : String(linha.reportWeekday),
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
    const { whatsapp, diaDoMes, diaDaSemana, ativo } = valorAtual(linha);

    const mes = diaDoMes.trim() === "" ? null : Number(diaDoMes.trim());
    const semana =
      diaDaSemana.trim() === "" ? null : Number(diaDaSemana.trim());

    if (mes !== null && (!Number.isInteger(mes) || mes < 1 || mes > 28)) {
      toast.error("O dia do mês precisa estar entre 1 e 28.");
      return;
    }

    if (semana !== null && (!Number.isInteger(semana) || semana < 0 || semana > 6)) {
      toast.error("Dia da semana inválido.");
      return;
    }

    setSalvando(linha.id);

    startTransition(async () => {
      const r = await salvarAgendaDeRelatorio({
        clientId: linha.id,
        reportDay: mes,
        reportWeekday: semana,
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

        {lotacao.length > 0 && (
          <span className="shrink-0 rounded-full bg-negative-muted px-2 py-0.5 text-2xs font-medium text-negative">
            {lotacao.length} {lotacao.length === 1 ? "dia lotado" : "dias lotados"}
          </span>
        )}

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
          {/* O AVISO PRECISA DIZER O QUE ACONTECE, não só que está cheio.
              "Dia lotado" sozinho parece recomendação de estilo; o que
              está em jogo é o cliente perder o relatório do mês inteiro,
              em silêncio, e só alguém perceber quando ele cobrar. */}
          {lotacao.length > 0 && (
            <div className="rounded-lg border border-negative/25 bg-negative-muted px-3 py-2.5 text-xs text-negative">
              <p className="font-medium">
                {lotacao.map((d) => `${d.rotulo}: ${d.n} contas`).join(" · ")}
              </p>
              <p className="mt-1 text-negative/85">
                Cabem cerca de {CABEM_POR_RODADA} por rodada — o robô roda uma
                vez por dia e cada relatório leva alguns segundos. Quem passar
                disso fica de fora <strong>sem receber</strong>, e não entra
                automaticamente no dia seguinte: o dia agendado dele já
                passou. Espalhe por outros dias.
              </p>
            </div>
          )}

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
            <div className="hidden grid-cols-[1fr_240px_190px_92px_92px] gap-3 border-b border-hairline px-4 py-2.5 lg:grid">
              {[
                "Cliente",
                "Destino no WhatsApp",
                /* Dois campos sob um rótulo só: à esquerda o dia do mês
                   (fechamento do mês anterior), à direita o dia da
                   semana (últimos 7 dias). "Quando" cobria um campo; com
                   dois, o cabeçalho precisa dizer que são duas agendas. */
                "Mensal / Semanal",
                "Automático",
                "",
              ].map(
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
                      className="grid grid-cols-1 gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[1fr_240px_190px_92px_92px] lg:items-center"
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

                      {/* AS DUAS AGENDAS LADO A LADO, cada uma opcional.
                          Antes havia um seletor Mensal/Semanal e UM
                          campo: as cadências eram exclusivas, e escolher
                          semanal apagava o dia do mês. Desde a migration
                          48 elas são independentes — a conta pode receber
                          o fechamento do mês E um acompanhamento toda
                          segunda, que é o caso comum de quem acompanha
                          campanha de perto.

                          Vazio nos dois = sem envio automático, e o
                          interruptor ao lado recusa ligar. */}
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={rascunho.diaDoMes}
                          onChange={(e) =>
                            editar(linha, { diaDoMes: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") salvar(linha);
                          }}
                          placeholder="dia"
                          inputMode="numeric"
                          maxLength={2}
                          className="h-8 w-14 shrink-0 text-sm tabular-nums"
                          title="Dia do mês — relatório do mês anterior"
                          aria-label={`Dia do mês do envio mensal de ${linha.name}`}
                        />

                        <select
                          value={rascunho.diaDaSemana}
                          onChange={(e) =>
                            editar(linha, { diaDaSemana: e.target.value })
                          }
                          className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-1.5 text-xs"
                          title="Dia da semana — relatório dos últimos 7 dias"
                          aria-label={`Dia da semana do envio semanal de ${linha.name}`}
                        >
                          {DIAS_DA_SEMANA.map((d) => (
                            <option key={d.valor} value={d.valor}>
                              {d.rotulo}
                            </option>
                          ))}
                        </select>
                      </div>

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
