"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Copy, Link2, MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClienteDoNps } from "@/lib/nps/dados";
import {
  CONTINUIDADE,
  DIMENSOES,
  calcularNps,
  categoria,
  mediaDaDimensao,
  rotuloDoTrimestre,
  trimestreDe,
  type RespostaNps,
} from "@/lib/nps/regras";
import { cn } from "@/lib/utils";

const VERDE = "#059669";
const AMARELO = "#f59e0b";
const VERMELHO = "#dc2626";

function trimestreAnterior(t: string): string {
  const [ano, tri] = t.split("-T").map(Number);
  return tri === 1 ? `${ano - 1}-T4` : `${ano}-T${tri - 1}`;
}

/** Zonas usuais de NPS. */
function zona(nps: number) {
  if (nps >= 75) return { rotulo: "Zona de excelência", cor: VERDE, classe: "text-emerald-600" };
  if (nps >= 50) return { rotulo: "Zona de qualidade", cor: VERDE, classe: "text-emerald-600" };
  if (nps >= 0) return { rotulo: "Zona de aperfeiçoamento", cor: AMARELO, classe: "text-amber-600" };
  return { rotulo: "Zona crítica", cor: VERMELHO, classe: "text-red-600" };
}

function corDaNota(score: number) {
  const c = categoria(score);
  return c === "promotor" ? VERDE : c === "neutro" ? AMARELO : VERMELHO;
}

const rotuloContinuidade = (v: RespostaNps["continuidade"]) =>
  CONTINUIDADE.find((c) => c.valor === v)?.rotulo ?? "—";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

function Cartao({ rotulo, children, nota }: { rotulo: string; children: React.ReactNode; nota?: React.ReactNode }) {
  return (
    <div className="surface-card flex flex-col gap-1 p-4">
      <p className="eyebrow">{rotulo}</p>
      <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{children}</div>
      {nota && <div className="text-xs text-muted-foreground">{nota}</div>}
    </div>
  );
}

function Secao({ titulo, descricao, children, className }: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card flex flex-col gap-4 p-5", className)}>
      <div>
        <h2 className="text-base font-semibold">{titulo}</h2>
        {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

const configDistribuicao = { quantidade: { label: "Respostas" } } satisfies ChartConfig;
const configEvolucao = { nps: { label: "NPS" } } satisfies ChartConfig;

export function PainelNps({
  respostas,
  clientes,
  baseDoLink,
}: {
  respostas: RespostaNps[];
  clientes: ClienteDoNps[];
  baseDoLink: string;
}) {
  const atual = trimestreDe();
  const trimestres = useMemo(
    () => [...new Set([atual, ...respostas.map((r) => r.trimestre)])].sort().reverse(),
    [respostas, atual],
  );
  const [trimestre, setTrimestre] = useState(atual);
  const [aberta, setAberta] = useState<RespostaNps | null>(null);

  const nomeDe = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const doTrimestre = respostas.filter((r) => r.trimestre === trimestre);
  const doAnterior = respostas.filter((r) => r.trimestre === trimestreAnterior(trimestre));

  const resumo = calcularNps(doTrimestre.map((r) => r.score));
  const resumoAnterior = calcularNps(doAnterior.map((r) => r.score));
  const variacao =
    resumo.nps !== null && resumoAnterior.nps !== null ? resumo.nps - resumoAnterior.nps : null;

  const ativos = clientes
    .filter((c) => c.status === "active")
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const responderam = new Set(doTrimestre.map((r) => r.client_id));
  const ativosQueResponderam = ativos.filter((c) => responderam.has(c.id)).length;

  const emRisco = doTrimestre.filter((r) => r.continuidade === "nao" || r.continuidade === "talvez");
  const atencao = doTrimestre
    .filter((r) => r.score <= 6 || r.continuidade === "nao" || r.continuidade === "talvez")
    .sort((a, b) => a.score - b.score);

  const distribuicao = Array.from({ length: 11 }, (_, n) => ({
    nota: String(n),
    quantidade: doTrimestre.filter((r) => r.score === n).length,
    cor: corDaNota(n),
  }));

  const evolucao = [...trimestres]
    .reverse()
    .map((t) => ({ t, ...calcularNps(respostas.filter((r) => r.trimestre === t).map((r) => r.score)) }))
    .filter((p) => p.nps !== null)
    .slice(-6)
    .map((p) => ({ rotulo: p.t.replace("-", " "), nps: p.nps as number, cor: zona(p.nps as number).cor }));

  function linkDe(c: ClienteDoNps) {
    return c.token ? `${baseDoLink}${c.token}` : null;
  }

  async function copiar(texto: string, aviso: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(aviso);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  const mensagem = (link: string) =>
    `Oi! Tudo bem? A cada trimestre pedimos uma avaliação rápida do nosso trabalho. ` +
    `Leva uns 2 minutos e ajuda muito a melhorarmos: ${link}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={trimestre} onValueChange={(v) => v && setTrimestre(v)}>
          <SelectTrigger className="w-60">
            <SelectValue>{(v: string) => rotuloDoTrimestre(v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {trimestres.map((t) => (
              <SelectItem key={t} value={t}>
                {rotuloDoTrimestre(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          As respostas entram no trimestre em que foram enviadas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          rotulo="NPS"
          nota={
            resumo.nps === null ? (
              "sem respostas neste trimestre"
            ) : (
              <>
                <span className={zona(resumo.nps).classe}>{zona(resumo.nps).rotulo}</span>
                {variacao !== null && (
                  <span> · {variacao >= 0 ? "+" : ""}{variacao} vs. trimestre anterior</span>
                )}
              </>
            )
          }
        >
          <span className={resumo.nps === null ? "" : zona(resumo.nps).classe}>
            {resumo.nps === null ? "—" : resumo.nps}
          </span>
        </Cartao>
        <Cartao
          rotulo="Respostas"
          nota={
            ativos.length > 0
              ? `${ativosQueResponderam} de ${ativos.length} clientes ativos (${Math.round((ativosQueResponderam / ativos.length) * 100)}%)`
              : "nenhum cliente ativo"
          }
        >
          {resumo.total}
        </Cartao>
        <Cartao
          rotulo="Promotores · Neutros · Detratores"
          nota={
            resumo.total > 0 ? (
              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
                <div style={{ width: `${(resumo.promotores / resumo.total) * 100}%`, background: VERDE }} />
                <div style={{ width: `${(resumo.neutros / resumo.total) * 100}%`, background: AMARELO }} />
                <div style={{ width: `${(resumo.detratores / resumo.total) * 100}%`, background: VERMELHO }} />
              </div>
            ) : (
              "—"
            )
          }
        >
          <span className="text-emerald-600">{resumo.promotores}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-amber-600">{resumo.neutros}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-red-600">{resumo.detratores}</span>
        </Cartao>
        <Cartao rotulo="Risco de saída" nota='responderam "Talvez" ou "Não" para continuar'>
          <span className={emRisco.length > 0 ? "text-red-600" : ""}>{emRisco.length}</span>
        </Cartao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Distribuição das notas" descricao="0 a 6 detratores · 7 e 8 neutros · 9 e 10 promotores">
          <ChartContainer config={configDistribuicao} className="aspect-auto h-[220px] w-full">
            <BarChart data={distribuicao} margin={{ top: 16, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="nota" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltipContent />} />
              <Bar dataKey="quantidade" radius={[4, 4, 0, 0]}>
                {distribuicao.map((d) => (
                  <Cell key={d.nota} fill={d.cor} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </Secao>

        <Secao titulo="Evolução do NPS" descricao="Últimos trimestres com resposta">
          {evolucao.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Ainda não há respostas.</p>
          ) : (
            <ChartContainer config={configEvolucao} className="aspect-auto h-[220px] w-full">
              <BarChart data={evolucao} margin={{ top: 20, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="rotulo" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tickLine={false} axisLine={false} width={40} />
                <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltipContent />} />
                <Bar dataKey="nps" radius={[4, 4, 0, 0]}>
                  {evolucao.map((p) => (
                    <Cell key={p.rotulo} fill={p.cor} />
                  ))}
                  <LabelList dataKey="nps" position="top" className="fill-foreground text-xs font-semibold" />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </Secao>
      </div>

      <Secao titulo="Avaliação por parte do serviço" descricao='Média de 1 a 5. "Não se aplica" fica fora da conta.'>
        <div className="flex flex-col gap-3">
          {DIMENSOES.map((d) => {
            const media = mediaDaDimensao(doTrimestre, d.chave);
            const n = doTrimestre.filter((r) => r[d.chave] !== null).length;
            const cor = media === null ? "transparent" : media >= 4 ? VERDE : media >= 3 ? AMARELO : VERMELHO;
            return (
              <div key={d.chave} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,280px)_1fr_auto]">
                <p className="text-sm">{d.rotulo}</p>
                <div className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1">
                  <div className="h-full rounded-full" style={{ width: `${((media ?? 0) / 5) * 100}%`, background: cor }} />
                </div>
                <p className="text-right text-sm tabular-nums">
                  <span className="font-semibold">{media === null ? "—" : media.toFixed(1).replace(".", ",")}</span>
                  <span className="text-muted-foreground"> · {n} {n === 1 ? "avaliação" : "avaliações"}</span>
                </p>
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao
        titulo="Precisa de atenção"
        descricao="Detratores (nota até 6) e quem respondeu “Talvez” ou “Não” para continuar."
      >
        {atencao.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cliente nessa situação neste trimestre.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {atencao.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setAberta(r)}
                className="flex flex-col gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{nomeDe.get(r.client_id) ?? "Cliente removido"}</p>
                  <span
                    className="rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
                    style={{ background: corDaNota(r.score) }}
                  >
                    {r.score}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Continua? <strong className="text-foreground">{rotuloContinuidade(r.continuidade)}</strong>
                  {r.respondente && <> · {r.respondente}</>}
                </p>
                {(r.motivo || r.melhoria) && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{r.motivo ?? r.melhoria}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </Secao>

      <Secao
        titulo={`Envio do ${rotuloDoTrimestre(trimestre)}`}
        descricao="Cada cliente tem um link próprio. Copie a mensagem e mande no grupo do cliente."
      >
        {ativos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cliente ativo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {ativos.map((c) => {
              const link = linkDe(c);
              const resposta = doTrimestre.find((r) => r.client_id === c.id);
              return (
                <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <p className="font-medium">{c.nome}</p>
                    {resposta ? (
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        Respondeu · nota {resposta.score}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Pendente</span>
                    )}
                  </div>
                  {link && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => copiar(link, "Link copiado.")}>
                        <Link2 className="size-3.5" />
                        Link
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => copiar(mensagem(link), "Mensagem copiada.")}>
                        <MessageSquareText className="size-3.5" />
                        Mensagem
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      <Secao titulo="Todas as respostas do trimestre">
        {doTrimestre.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma resposta neste trimestre ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Nota</th>
                  <th className="py-2 pr-3 font-medium">Continua?</th>
                  <th className="py-2 font-medium">Respondente</th>
                </tr>
              </thead>
              <tbody>
                {doTrimestre.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setAberta(r)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="py-2.5 pr-3 font-medium">{nomeDe.get(r.client_id) ?? "Cliente removido"}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{dataCurta(r.submitted_at)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold tabular-nums" style={{ color: corDaNota(r.score) }}>{r.score}</span>
                    </td>
                    <td className="py-2.5 pr-3">{rotuloContinuidade(r.continuidade)}</td>
                    <td className="py-2.5 text-muted-foreground">{r.respondente ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Dialog open={aberta !== null} onOpenChange={(v) => !v && setAberta(null)}>
        <DialogContent className="sm:max-w-lg">
          {aberta && (
            <>
              <DialogHeader>
                <DialogTitle>{nomeDe.get(aberta.client_id) ?? "Cliente removido"}</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {dataCurta(aberta.submitted_at)}
                  {aberta.respondente && <> · {aberta.respondente}</>}
                </p>
              </DialogHeader>
              <div className="flex flex-col gap-4 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-md px-2.5 py-1 text-lg font-semibold tabular-nums text-white"
                    style={{ background: corDaNota(aberta.score) }}
                  >
                    {aberta.score}
                  </span>
                  <span className="text-muted-foreground">
                    Continua? <strong className="text-foreground">{rotuloContinuidade(aberta.continuidade)}</strong>
                  </span>
                </div>
                <div>
                  <p className="eyebrow mb-1">O que pesou na nota</p>
                  <p className="whitespace-pre-wrap">{aberta.motivo ?? "—"}</p>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                  {DIMENSOES.map((d) => (
                    <div key={d.chave} className="contents">
                      <span className="text-muted-foreground">{d.rotulo}</span>
                      <span className="text-right font-semibold tabular-nums">{aberta[d.chave] ?? "n/a"}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="eyebrow mb-1">O que poderíamos fazer melhor</p>
                  <p className="whitespace-pre-wrap">{aberta.melhoria ?? "—"}</p>
                </div>
                {(aberta.motivo || aberta.melhoria) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      copiar(
                        [aberta.motivo, aberta.melhoria].filter(Boolean).join("\n\n"),
                        "Comentários copiados.",
                      )
                    }
                  >
                    <Copy className="size-3.5" />
                    Copiar comentários
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
