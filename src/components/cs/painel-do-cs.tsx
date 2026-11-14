"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, Check, ListPlus, Loader2 } from "lucide-react";

import { marcarNaSemana, marcarRotina } from "@/app/(app)/cs/actions";
import { cobrarPendencia } from "@/app/(app)/clientes/ficha-actions";
import { FormularioDeItem } from "@/components/clients/ficha/lista-editavel";
import { FormularioDaLinhaDoTempo } from "@/components/clients/ficha/linha-do-tempo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { SECOES_DE_LISTA } from "@/lib/clientes/ficha";
import { checklistDoCliente } from "@/lib/onboarding/checklist";
import { ROTINA, type ColunaDaSemana } from "@/lib/cs/rotina";
import { diasEntre, prazo, proximaOcorrencia, rotuloDaSemana, somarDias } from "@/lib/cs/semana";
import type { LinhaDaCarteira, PainelDoCs as Dados } from "@/lib/cs/dados";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Painel do CS (pedido de 13/11/2026)
   ---------------------------------------------------------------------
   A semana do CS numa tela: saúde da carteira, rotina, contas que pedem
   atenção, envios da semana por cliente, reuniões, onboardings,
   pendências e oportunidades. Lê a ficha de cada cliente — o que se
   edita aqui grava na mesma ficha da página do cliente.
   ===================================================================== */

const COR = {
  green: { rotulo: "Verde", classe: "bg-positive-muted text-positive" },
  yellow: { rotulo: "Amarelo", classe: "bg-warning-muted text-warning" },
  red: { rotulo: "Vermelho", classe: "bg-negative-muted text-negative" },
} as const;

const DIA_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/* shortcut: o squad que dispensa a mensagem de quarta é reconhecido pelo
   nome ("Escala"), como no protótipo; virar campo se surgir outro. */
const quartaNaoSeAplica = (squad: string | undefined) => /escala/i.test(squad ?? "");

export function PainelDoCs({ dados }: { dados: Dados }) {
  // Outra pessoa marcando envio ou cobrando pendência: o painel acompanha.
  useRealtimeRefresh("cs_semana");
  useRealtimeRefresh("clients");

  const { hoje, segunda, carteira } = dados;
  const ativos = carteira.filter((r) => r.client.status === "active");
  const onboardings = carteira.filter((r) => r.client.status === "onboarding");
  const nomeDoDia = DIA_DA_SEMANA[new Date(`${hoje}T12:00:00Z`).getUTCDay()];

  const squads = contar(ativos.map((r) => r.client.ficha?.perfil?.squad?.trim() || "Sem squad"));
  const saude = contar(ativos.map((r) => r.saude?.cor ?? "sem"));

  const pendencias = carteira
    .flatMap((r) =>
      (r.client.ficha?.pendencias ?? []).map((p) => ({
        ...p,
        cliente: r.client,
        desde: p.desde || p.criado_em || hoje,
      })),
    )
    .sort((a, b) => a.desde.localeCompare(b.desde));
  const pendenciasVelhas = pendencias.filter((p) => diasEntre(p.desde, hoje) > 7).length;

  /* Rotina: item automático conta como feito quando TODA a carteira
     aplicável está marcada na coluna dele. */
  const rotina = ROTINA.map((item) => {
    if (!item.auto) return { ...item, feito: dados.rotinaFeita.includes(item.id), progresso: null };
    const aplicaveis =
      item.auto === "reuniao_preparada"
        ? carteira.filter((r) => temReuniaoAte(r, somarDias(segunda, 13)))
        : ativos.filter((r) => !(item.auto === "mensagem_qua" && quartaNaoSeAplica(r.client.ficha?.perfil?.squad)));
    const marcados = aplicaveis.filter((r) => marcado(r, item.auto!)).length;
    // Sem reunião marcada não há o que preparar: o item conta como feito.
    const feito = item.auto === "reuniao_preparada" ? marcados === aplicaveis.length : aplicaveis.length > 0 && marcados === aplicaveis.length;
    return { ...item, feito, progresso: `${marcados} de ${aplicaveis.length}` };
  });
  const rotinaFeita = rotina.filter((i) => i.feito).length;
  const pctRotina = Math.round((rotinaFeita / rotina.length) * 100);

  const clientesParaEscolher = carteira.map((r) => ({ id: r.client.id, name: r.client.name }));

  return (
    <div className="flex flex-col gap-6">
      {/* Topo ----------------------------------------------------------- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Painel do CS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dados.usuario && `${dados.usuario} · `}semana de {rotuloDaSemana(segunda)} · hoje é {nomeDoDia},{" "}
            {hoje.slice(8, 10)}/{hoje.slice(5, 7)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ComCliente titulo="Nova pendência" clientes={clientesParaEscolher}>
            {(abrir) => (
              <Button size="sm" variant="outline" onClick={abrir}>
                <ListPlus className="size-3.5" />
                Nova pendência
              </Button>
            )}
            {(clientId, fechar) => (
              <FormularioDeItem clientId={clientId} secao="pendencias" definicao={SECOES_DE_LISTA.pendencias} onPronto={fechar} />
            )}
          </ComCliente>
          <ComCliente titulo="Registrar reunião" clientes={clientesParaEscolher}>
            {(abrir) => (
              <Button size="sm" onClick={abrir}>
                <CalendarClock className="size-3.5" />
                Registrar reunião
              </Button>
            )}
            {(clientId, fechar) => <FormularioDaLinhaDoTempo clientId={clientId} onPronto={fechar} />}
          </ComCliente>
        </div>
      </div>

      {/* Números -------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero rotulo="Clientes ativos" valor={String(ativos.length)}>
          {Object.entries(squads).map(([s, n]) => `${n} ${s}`).join(" · ")}
        </Numero>
        <Numero rotulo="Saúde da carteira">
          <span className="flex flex-wrap gap-1.5">
            {(["green", "yellow", "red"] as const).map((c) => (
              <span key={c} className={cn("rounded-full px-2 py-0.5 text-2xs font-medium", COR[c].classe)}>
                {saude[c] ?? 0} {COR[c].rotulo.toLowerCase()}
                {(saude[c] ?? 0) === 1 ? "" : "s"}
              </span>
            ))}
          </span>
          {saude.sem ? <span className="mt-1 block">{saude.sem} sem cor marcada na esteira</span> : null}
        </Numero>
        <Numero rotulo="Rotina da semana" valor={`${pctRotina}%`}>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pctRotina}%` }} />
          </span>
          <span className="mt-1 block">
            {rotinaFeita} de {rotina.length} tarefas concluídas
          </span>
        </Numero>
        <Numero rotulo="Pendências dos clientes" valor={String(pendencias.length)}>
          {pendenciasVelhas > 0 ? (
            <span className="text-negative">{pendenciasVelhas} abertas há mais de 7 dias</span>
          ) : (
            "nenhuma com mais de 7 dias"
          )}
        </Numero>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Rotina itens={rotina} />
        <Atencao carteira={ativos} />
      </div>

      <Carteira carteira={ativos} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Reunioes carteira={carteira} hoje={hoje} segunda={segunda} />
        <Onboardings carteira={onboardings} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Pendencias itens={pendencias} hoje={hoje} />
        <Oportunidades carteira={carteira} hoje={hoje} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function contar(lista: string[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of lista) r[x] = (r[x] ?? 0) + 1;
  return r;
}

/** Tem "próxima reunião" na ficha até `limite` (inclusive as atrasadas). */
function temReuniaoAte(r: LinhaDaCarteira, limite: string): boolean {
  const dia = r.client.ficha?.cs?.proxima_reuniao ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= limite;
}

/** Marcado na semana — o relatório de segunda também conta se saiu pelo Hub. */
function marcado(r: LinhaDaCarteira, coluna: ColunaDaSemana): boolean {
  return r.semana[coluna] || (coluna === "relatorio_seg" && r.relatorioPeloHub);
}

function Cartao({ titulo, acao, children, className }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("surface-card p-5", className)}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {acao}
      </header>
      {children}
    </section>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

function Numero({ rotulo, valor, children }: { rotulo: string; valor?: string; children?: React.ReactNode }) {
  return (
    <div className="surface-card p-4">
      <p className="eyebrow">{rotulo}</p>
      {valor && <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>}
      <div className="mt-1 text-2xs text-muted-foreground">{children}</div>
    </div>
  );
}

/** Diálogo que pede o cliente antes de mostrar o formulário. */
function ComCliente({
  titulo,
  clientes,
  children: [botao, formulario],
}: {
  titulo: string;
  clientes: { id: string; name: string }[];
  children: [(abrir: () => void) => React.ReactNode, (clientId: string, fechar: () => void) => React.ReactNode];
}) {
  const [aberto, setAberto] = useState(false);
  const [clientId, setClientId] = useState("");
  const nome = (id: string) => clientes.find((c) => c.id === id)?.name ?? "Escolha o cliente";
  return (
    <>
      {botao(() => {
        setClientId("");
        setAberto(true);
      })}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-cliente">Cliente</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
              <SelectTrigger id="cs-cliente" className="w-full">
                <SelectValue>{(v: string) => nome(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[...clientes]
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {/* `key`: trocar de cliente começa o formulário do zero. */}
          {clientId && <div key={clientId}>{formulario(clientId, () => setAberto(false))}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------ Rotina ------------------------------ */

function Rotina({ itens }: { itens: (typeof ROTINA[number] & { feito: boolean; progresso: string | null })[] }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Cartao titulo="Rotina da semana" acao={<span className="text-2xs text-muted-foreground">marque ao concluir</span>}>
      <ul className="flex flex-col gap-1">
        {itens.map((i, n) => {
          const cabecalho = n === 0 || itens[n - 1].dia !== i.dia ? i.dia : null;
          return (
            <li key={i.id}>
              {cabecalho && <p className="eyebrow mb-1 mt-2">{cabecalho}</p>}
              <div className="flex items-start gap-3 rounded-lg px-1 py-1.5">
                <Checkbox
                  id={`rotina-${i.id}`}
                  checked={i.feito}
                  // Item automático é marcado pela tabela da carteira, não aqui.
                  disabled={Boolean(i.auto) || pendente}
                  onCheckedChange={(c) =>
                    iniciar(async () => {
                      const r = await marcarRotina({ item: i.id, feito: c === true });
                      if (!r.ok) toast.error(r.error);
                    })
                  }
                  className="mt-0.5"
                />
                <label htmlFor={`rotina-${i.id}`} className="min-w-0 flex-1">
                  <span className={cn("block text-sm", i.feito && "text-muted-foreground line-through")}>{i.titulo}</span>
                  {(i.detalhe || i.auto) && (
                    <span className="block text-2xs text-muted-foreground">
                      {i.auto ? "marca sozinho pela tabela da carteira" : i.detalhe}
                    </span>
                  )}
                </label>
                {i.progresso && (
                  <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
                    {i.progresso}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}

/* ----------------------------- Atenção ----------------------------- */

function Atencao({ carteira }: { carteira: LinhaDaCarteira[] }) {
  const contas = carteira
    .filter((r) => r.saude?.cor === "red" || r.saude?.cor === "yellow")
    .sort((a, b) => (a.saude!.cor === b.saude!.cor ? 0 : a.saude!.cor === "red" ? -1 : 1));
  return (
    <Cartao titulo="Contas que pedem atenção">
      {contas.length === 0 ? (
        <Vazio>Nenhuma conta amarela ou vermelha.</Vazio>
      ) : (
        <ul className="flex flex-col gap-4">
          {contas.map((r) => {
            const cs = r.client.ficha?.cs ?? {};
            return (
              <li key={r.client.id}>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/clientes/${r.client.slug}`} className="text-sm font-medium underline-offset-2 hover:underline">
                    {r.client.name}
                  </Link>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", COR[r.saude!.cor].classe)}>
                    {COR[r.saude!.cor].rotulo}
                  </span>
                </div>
                {cs.motivo || cs.proximo_passo ? (
                  <>
                    {cs.motivo && <p className="mt-1 text-xs text-muted-foreground">Motivo: {cs.motivo}</p>}
                    {cs.proximo_passo && <p className="mt-0.5 text-xs text-muted-foreground">Próximo passo: {cs.proximo_passo}</p>}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sem motivo registrado —{" "}
                    <Link href={`/clientes/${r.client.slug}`} className="underline underline-offset-2">
                      preencher em Preferências
                    </Link>
                    .
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

/* ----------------------------- Carteira ----------------------------- */

function kpiVsMeta(r: LinhaDaCarteira): { texto: string; meta: string | null; bom: boolean | null } | null {
  const moeda = r.client.ad_currency;
  const g = r.goal;
  if (r.metric.isCurrency) {
    if (!g || g.planned_results <= 0) return null;
    return {
      texto: `${formatCurrency(r.computedGoalValue, moeda)} de faturamento`,
      meta: `meta ${formatCurrency(g.planned_results, moeda)}`,
      bom: null,
    };
  }
  const atual = r.computedGoalValue > 0 ? r.computedSpendCents / r.computedGoalValue : null;
  const meta = g && g.planned_results > 0 && g.planned_budget_cents > 0 ? g.planned_budget_cents / g.planned_results : null;
  if (atual === null && meta === null) return null;
  const custo = (r.metric.costLabel ?? "custo").toLowerCase().replace(/^custo /, "");
  return {
    texto: atual === null ? "sem resultado no mês" : `${formatCurrency(Math.round(atual), moeda)} ${custo}`,
    meta: meta === null ? null : `meta ${formatCurrency(Math.round(meta), moeda)}`,
    bom: atual !== null && meta !== null ? atual <= meta : null,
  };
}

function Carteira({ carteira }: { carteira: LinhaDaCarteira[] }) {
  const [filtro, setFiltro] = useState<string>("todos");
  const squads = useMemo(
    () => [...new Set(carteira.map((r) => r.client.ficha?.perfil?.squad?.trim()).filter((s): s is string => Boolean(s)))].sort(),
    [carteira],
  );
  const visiveis = carteira
    .filter((r) =>
      filtro === "todos"
        ? true
        : filtro === "risco"
          ? r.saude?.cor === "red" || r.saude?.cor === "yellow"
          : r.client.ficha?.perfil?.squad?.trim() === filtro,
    )
    .sort((a, b) => a.client.name.localeCompare(b.client.name, "pt-BR"));

  const filtros = [
    { valor: "todos", rotulo: "Todos" },
    ...squads.map((s) => ({ valor: s, rotulo: s })),
    { valor: "risco", rotulo: "Em risco" },
  ];

  return (
    <Cartao titulo="Carteira e mensagens da semana">
      <p className="-mt-2 mb-3 text-xs text-muted-foreground">
        Marque cada envio ao fazer. O relatório de segunda se marca sozinho quando sai pelo Hub. No squad
        Escala, a mensagem de quarta não é obrigatória.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar carteira">
        {filtros.map((f) => (
          <button
            key={f.valor}
            type="button"
            aria-pressed={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-hairline transition-colors",
              filtro === f.valor ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.rotulo}
          </button>
        ))}
      </div>
      {visiveis.length === 0 ? (
        <Vazio>Nenhum cliente neste filtro.</Vazio>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[54rem] text-xs">
            <thead>
              <tr className="border-b border-hairline text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Saúde</th>
                <th className="pb-2 font-medium">KPI vs. meta</th>
                <th className="pb-2 text-center font-medium">Seg · relatório</th>
                <th className="pb-2 text-center font-medium">Qua · mensagem</th>
                <th className="pb-2 text-center font-medium">Sex · mensagem</th>
                <th className="pb-2 text-center font-medium">Pendências</th>
                <th className="pb-2 text-right font-medium">Próxima reunião</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visiveis.map((r) => {
                const kpi = kpiVsMeta(r);
                const squad = r.client.ficha?.perfil?.squad;
                const reuniao = r.client.ficha?.cs?.proxima_reuniao;
                return (
                  <tr key={r.client.id}>
                    <td className="py-2.5 pr-3">
                      <Link href={`/clientes/${r.client.slug}`} className="font-medium underline-offset-2 hover:underline">
                        {r.client.name}
                      </Link>
                      {squad && <span className="block text-2xs text-muted-foreground">{squad}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.saude ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium", COR[r.saude.cor].classe)}>
                          {COR[r.saude.cor].rotulo}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {kpi ? (
                        <>
                          <span className={cn(kpi.bom === true && "text-positive", kpi.bom === false && "text-negative")}>
                            {kpi.texto}
                          </span>
                          {kpi.meta && <span className="block text-2xs text-muted-foreground">{kpi.meta}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">sem meta</span>
                      )}
                    </td>
                    <td className="py-2.5 text-center">
                      <Envio linha={r} coluna="relatorio_seg" />
                    </td>
                    <td className="py-2.5 text-center">
                      {quartaNaoSeAplica(squad) && !r.semana.mensagem_qua ? (
                        <span className="text-2xs text-muted-foreground">não se aplica</span>
                      ) : (
                        <Envio linha={r} coluna="mensagem_qua" />
                      )}
                    </td>
                    <td className="py-2.5 text-center">
                      <Envio linha={r} coluna="mensagem_sex" />
                    </td>
                    <td className="py-2.5 text-center tabular-nums">{r.client.ficha?.pendencias?.length ?? 0}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {reuniao ? `${reuniao.slice(8, 10)}/${reuniao.slice(5, 7)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  );
}

/** Botão Enviado/Pendente de uma célula da carteira. */
function Envio({ linha, coluna }: { linha: LinhaDaCarteira; coluna: ColunaDaSemana }) {
  const [pendente, iniciar] = useTransition();
  const feito = marcado(linha, coluna);
  const automatico = coluna === "relatorio_seg" && linha.relatorioPeloHub && !linha.semana.relatorio_seg;
  return (
    <button
      type="button"
      disabled={pendente || automatico}
      aria-pressed={feito}
      title={automatico ? "Relatório enviado pelo Hub nesta semana" : undefined}
      onClick={() =>
        iniciar(async () => {
          const r = await marcarNaSemana({ clientId: linha.client.id, coluna, valor: !feito });
          if (!r.ok) toast.error(r.error);
        })
      }
      className={cn(
        "inline-flex min-w-[5.5rem] items-center justify-center gap-1 rounded-md px-2 py-1 text-2xs font-medium ring-1 transition-colors",
        feito
          ? "bg-positive-muted text-positive ring-transparent"
          : "text-muted-foreground ring-hairline hover:text-foreground",
      )}
    >
      {pendente ? <Loader2 className="size-3 animate-spin" /> : feito && <Check className="size-3" />}
      {feito ? "Enviado" : "Pendente"}
    </button>
  );
}

/* ----------------------------- Reuniões ----------------------------- */

function Reunioes({ carteira, hoje, segunda }: { carteira: LinhaDaCarteira[]; hoje: string; segunda: string }) {
  const [pendente, iniciar] = useTransition();
  const fimDaProxima = somarDias(segunda, 13);
  const reunioes = carteira
    .filter((r) => temReuniaoAte(r, fimDaProxima))
    .map((r) => ({ r, dia: r.client.ficha!.cs!.proxima_reuniao! }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  return (
    <Cartao titulo="Reuniões até a próxima semana">
      {reunioes.length === 0 ? (
        <Vazio>Nenhuma reunião marcada. A data vem do campo &ldquo;Próxima reunião&rdquo; da ficha.</Vazio>
      ) : (
        <ul className="flex flex-col gap-3">
          {reunioes.map(({ r, dia }) => {
            const p = prazo(dia, hoje);
            const preparada = r.semana.reuniao_preparada;
            return (
              <li key={r.client.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/clientes/${r.client.slug}`} className="text-sm font-medium underline-offset-2 hover:underline">
                    {r.client.name}
                  </Link>
                  <p className={cn("text-2xs", p.atrasado ? "text-negative" : "text-muted-foreground")}>
                    {DIA_DA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, {p.texto === "hoje" ? "hoje" : `${dia.slice(8, 10)}/${dia.slice(5, 7)}`}
                    {p.atrasado && ` · ${p.texto}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pendente}
                  aria-pressed={preparada}
                  onClick={() =>
                    iniciar(async () => {
                      const res = await marcarNaSemana({ clientId: r.client.id, coluna: "reuniao_preparada", valor: !preparada });
                      if (!res.ok) toast.error(res.error);
                    })
                  }
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1 text-2xs font-medium ring-1 transition-colors",
                    preparada ? "bg-positive-muted text-positive ring-transparent" : "bg-warning-muted text-warning ring-transparent",
                  )}
                >
                  {preparada ? "Preparada" : "Preparar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

/* ---------------------------- Onboardings ---------------------------- */

function Onboardings({ carteira }: { carteira: LinhaDaCarteira[] }) {
  return (
    <Cartao
      titulo="Onboardings em andamento"
      acao={
        <Link href="/onboarding" className="text-xs text-muted-foreground hover:text-foreground">
          Abrir Onboarding
        </Link>
      }
    >
      {carteira.length === 0 ? (
        <Vazio>Nenhum cliente em onboarding.</Vazio>
      ) : (
        <ul className="flex flex-col gap-4">
          {carteira.map((r) => {
            const itens = checklistDoCliente(r.client);
            const passo = r.client.ficha?.cs?.proximo_passo;
            return (
              <li key={r.client.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{r.client.name}</p>
                  <span className="text-2xs text-muted-foreground">
                    {itens.filter((i) => i.done).length} de {itens.length}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {itens.map((i) => (
                    <span
                      key={i.id}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-2xs ring-1",
                        i.done ? "bg-positive-muted text-positive ring-transparent" : "text-muted-foreground ring-hairline",
                      )}
                    >
                      {i.label}
                    </span>
                  ))}
                </div>
                {passo && <p className="mt-1.5 text-xs text-muted-foreground">Próximo passo: {passo}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

/* ----------------------------- Pendências ----------------------------- */

type Pendencia = { id: string; texto?: string; desde: string; ultimo_followup?: string; cliente: LinhaDaCarteira["client"] };

function Pendencias({ itens, hoje }: { itens: Pendencia[]; hoje: string }) {
  const [cobrando, setCobrando] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  return (
    <Cartao titulo="Pendências dos clientes">
      {itens.length === 0 ? (
        <Vazio>Nenhuma pendência aberta.</Vazio>
      ) : (
        <ul className="flex flex-col gap-3">
          {itens.map((p) => {
            const dias = diasEntre(p.desde, hoje);
            const cobradaHoje = p.ultimo_followup === hoje;
            return (
              <li key={`${p.cliente.id}-${p.id}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{p.texto}</p>
                  <p className="text-2xs text-muted-foreground">
                    <Link href={`/clientes/${p.cliente.slug}`} className="hover:underline">
                      {p.cliente.name}
                    </Link>
                    {p.ultimo_followup && ` · último follow-up: ${p.ultimo_followup.slice(8, 10)}/${p.ultimo_followup.slice(5, 7)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn("text-2xs tabular-nums", dias > 7 ? "text-negative" : "text-muted-foreground")}>
                    {dias <= 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`}
                  </span>
                  {cobradaHoje ? (
                    <span className="rounded-md bg-positive-muted px-2 py-1 text-2xs font-medium text-positive">Cobrada hoje</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-2xs"
                      disabled={cobrando === p.id}
                      onClick={() => {
                        setCobrando(p.id);
                        iniciar(async () => {
                          const r = await cobrarPendencia({ clientId: p.cliente.id, itemId: p.id });
                          if (!r.ok) toast.error(r.error);
                          setCobrando(null);
                        });
                      }}
                    >
                      {cobrando === p.id && <Loader2 className="size-3 animate-spin" />}
                      Cobrar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

/* --------------------------- Oportunidades --------------------------- */

const TIPO: Record<string, string> = {
  upsell: "Upsell",
  depoimento: "Depoimento",
  marco: "Marco",
  reajuste: "Reajuste",
  data: "Data",
};

function Oportunidades({ carteira, hoje }: { carteira: LinhaDaCarteira[]; hoje: string }) {
  const daFicha = carteira.flatMap((r) =>
    (r.client.ficha?.oportunidades ?? []).map((o) => ({
      chave: `${r.client.id}-${o.id}`,
      tipo: o.tipo || "marco",
      titulo: `${r.client.name}: ${o.texto}`,
      detalhe: o.detalhe,
      quando: "",
    })),
  );
  // As "Datas para lembrar" dos próximos 14 dias entram sozinhas.
  const datas = carteira.flatMap((r) =>
    (r.client.ficha?.datas ?? []).flatMap((d) => {
      const quando = proximaOcorrencia(d.data ?? "", hoje);
      if (!quando || diasEntre(hoje, quando) > 14) return [];
      return [{ chave: `${r.client.id}-${d.id}`, tipo: "data", titulo: `${r.client.name}: ${d.descricao || "data"}`, detalhe: "", quando }];
    }),
  );
  const itens = [...datas.sort((a, b) => a.quando.localeCompare(b.quando)), ...daFicha];

  return (
    <Cartao titulo="Oportunidades e marcos">
      {itens.length === 0 ? (
        <Vazio>Nenhuma oportunidade registrada. Elas vêm da aba Preferências de cada cliente.</Vazio>
      ) : (
        <ul className="flex flex-col gap-3">
          {itens.map((o) => (
            <li key={o.chave} className="flex items-start gap-3">
              <span className="mt-0.5 w-20 shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-center text-2xs font-medium text-muted-foreground ring-1 ring-hairline">
                {TIPO[o.tipo] ?? o.tipo}
              </span>
              <div className="min-w-0">
                <p className="text-sm">{o.titulo}</p>
                {(o.detalhe || o.quando) && (
                  <p className="text-2xs text-muted-foreground">
                    {o.quando ? `${DIA_DA_SEMANA[new Date(`${o.quando}T12:00:00Z`).getUTCDay()]}, ${o.quando.slice(8, 10)}/${o.quando.slice(5, 7)}` : o.detalhe}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
