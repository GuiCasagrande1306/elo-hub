"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, BarChart3, Check, Copy, FileDown, Image as ImageIcon,
  MessageCircle, Target, TrendingUp,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatMultiplier, formatPeriod } from "@/lib/format";
import {
  formatGoalValue,
  goalExecutedFrom,
  type GoalMetric,
} from "@/lib/metrics/goal-metric";
import {
  DateRangePicker,
  type Intervalo,
} from "@/components/ui/date-range-picker";
import { mensagemDoCliente } from "@/lib/reports/mensagem-do-cliente";
import { resumoDoPeriodo } from "./actions";

/* =====================================================================
   Estação de comando
   ---------------------------------------------------------------------
   Uma tela para a pergunta "mandar o resultado desta conta agora".
   Filtros e mensagem à esquerda, o que o cliente vai receber à direita.

   OS NÚMEROS SÃO REAIS e o PERÍODO É O DELES. Vêm somados de
   `daily_metrics` no servidor, na janela da meta vigente de cada conta,
   e a tela rotula a mensagem com essa mesma janela.

   O SELETOR DE PERÍODO VOLTOU, e agora ele é honesto. A versão anterior
   foi removida porque MENTIA: trocava a frase ("resumo dos últimos 7
   dias") sem trocar os números, que continuavam sendo os do mês inteiro
   — e o texto daqui é copiado e enviado ao cliente final. Um controle
   que muda o rótulo e não o dado é pior que controle nenhum: produz um
   número errado com aparência de conferido.

   A dívida registrada ali era "voltará quando houver busca de verdade
   por intervalo". Ela existe: `resumoDoPeriodo` soma `daily_metrics` na
   janela escolhida, sob RLS. Trocar o período AGORA TROCA O NÚMERO.

   ESTA É A ÚNICA TELA DE RELATÓRIO. Havia um compositor separado em
   `/relatorios/novo` que fazia quase a mesma coisa com outros controles;
   duas telas para a mesma tarefa é como uma delas fica desatualizada.

   CORES POR TOKEN, não `purple-600`: o app tem tema claro e escuro, e
   cor fixa do Tailwind fica ilegível num dos dois.
   ===================================================================== */

export interface ClientSummary {
  id: string;
  /** Identificador da conta na URL. O compositor resolve por ele. */
  slug: string;
  name: string;
  spendCents: number;
  /** Já na unidade de `metric` — resolvido no servidor. */
  resultValue: number;
  metric: GoalMetric;
  /** A janela que o servidor somou. É ela que rotula a mensagem. */
  period: { start: string; end: string };
  /** Template que o segmento desta conta seleciona. Exibido, não escolhido. */
  templateName: string;
}

const SECOES = [
  { icon: BarChart3, titulo: "Resumo executivo", sub: "Investimento, resultados e custo" },
  { icon: TrendingUp, titulo: "Evolução no período", sub: "Série diária de gasto e retorno" },
  { icon: Target, titulo: "Meta do mês", sub: "Planejado contra realizado" },
  { icon: ImageIcon, titulo: "Criativos em destaque", sub: "O que mais performou" },
];

export function CommandStation({ clients }: { clients: ClientSummary[] }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "envio" | null>(null);

  /* O QUE JÁ FOI ENVIADO NESTA SESSÃO, por conta E período.
     -------------------------------------------------------------------
     "Gerar e enviar" cria uma linha NOVA em `report_history` a cada
     clique e despacha de novo: o índice `report_history_automated_unique`
     só cobre `is_automated = true`, então nada no banco barra o disparo
     manual repetido. Bastava o toast passar despercebido, ou a dúvida de
     "será que foi?", para o cliente receber o mesmo PDF duas vezes no
     grupo — e não há desfazer.

     A fila de envio já tratava disso trocando o botão por "Enviado ✓"
     (ver `send-queue.tsx`); esta tela ficou de fora. Aqui a chave inclui
     o período porque reenviar OUTRA janela para a mesma conta é
     legítimo — o que não é legítimo é repetir a mesma. */
  const [enviados, setEnviados] = useState<Set<string>>(new Set());

  const cliente = clients.find((c) => c.id === clientId) ?? null;

  /* Abre na janela da META da conta — é o período que o servidor já
     somou, então a tela nasce com número conferido e sem ida ao banco. */
  const [periodo, setPeriodo] = useState<Intervalo>(() => ({
    inicio: clients[0]?.period.start ?? "",
    fim: clients[0]?.period.end ?? "",
  }));

  /* Números da janela ESCOLHIDA. `null` = ainda é a janela da meta, e
     valem os que vieram do servidor. Guardar em separado deixa claro,
     na leitura do código, quando o que está na tela é o dado inicial e
     quando é o resultado de uma busca. */
  const [override, setOverride] = useState<{
    spendCents: number;
    resultValue: number;
  } | null>(null);
  const [buscando, setBuscando] = useState(false);

  /* `true` só quando a busca VOLTOU e não achou linha nenhuma. Começa
     `false` porque a janela inicial é a da meta, que o servidor já
     somou. Ver a nota de `linhas` em `ResumoDoPeriodo`: zero real e
     período nunca sincronizado apareciam iguais na tela. */
  const [semDado, setSemDado] = useState(false);

  const periodoLabel = formatPeriod(periodo.inicio, periodo.fim);

  /* Conta + janela. Trocar qualquer um dos dois libera o botão de novo. */
  const chaveDoEnvio = `${clientId}|${periodo.inicio}|${periodo.fim}`;
  const jaEnviado = enviados.has(chaveDoEnvio);

  const spendCents = override?.spendCents ?? cliente?.spendCents ?? 0;
  const resultValue = override?.resultValue ?? cliente?.resultValue ?? 0;

  /** Troca de conta reabre na janela da meta dela e descarta a busca. */
  function trocarCliente(id: string) {
    const alvo = clients.find((c) => c.id === id);
    setClientId(id);
    setOverride(null);
    setSemDado(false);
    if (alvo) setPeriodo({ inicio: alvo.period.start, fim: alvo.period.end });
  }

  /** Trocar o período REBUSCA. É o que impede a tela de mentir. */
  function trocarPeriodo(novo: Intervalo) {
    setPeriodo(novo);
    if (!cliente) return;

    setBuscando(true);
    resumoDoPeriodo({
      clientId: cliente.id,
      start: novo.inicio,
      end: novo.fim,
    })
      .then((r) => {
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        /* A UNIDADE VEM DE `cliente.metric`, não do servidor. É a mesma
           que formatou os números iniciais, então o cartão e a mensagem
           não têm como discordar dela. Deixar o servidor escolher já
           produziu R$ 0,64 onde eram R$ 12.170,81 — ele resolveu
           contagem e a tela formatou como dinheiro. */
        setSemDado(r.resumo.linhas === 0);
        setOverride({
          spendCents: r.resumo.spendCents,
          resultValue: goalExecutedFrom(cliente.metric, {
            conversions: r.resumo.conversions,
            revenueCents: r.resumo.revenueCents,
          }),
        });
      })
      .catch(() => toast.error("Não deu para somar o período."))
      .finally(() => setBuscando(false));
  }

  /* Custo por resultado calculado aqui e não guardado: dividir na hora
     garante que ele nunca discorde do gasto e do resultado ao lado.

     `costLabel` nulo = a meta já é em dinheiro, e "custo por
     faturamento" não é uma grandeza. Ali a razão que interessa é ROAS. */
  const cpl =
    cliente && cliente.metric.costLabel && resultValue > 0
      ? spendCents / resultValue
      : null;

  const roas =
    cliente && cliente.metric.isCurrency && spendCents > 0
      ? resultValue / spendCents
      : null;

  /* O TEXTO NÃO É MONTADO AQUI — ver `lib/reports/mensagem-do-cliente`.
     Esta tela e o envio pelo WhatsApp chamam a mesma função; enquanto
     cada um montava o seu, a equipe conferia um texto e o cliente
     recebia outro. */
  const mensagem = useMemo(() => {
    if (!cliente) return "";
    const { metric } = cliente;

    return mensagemDoCliente({
      periodoLabel,
      investimento: formatCurrency(spendCents),
      resultadoLabel: metric.label,
      resultado: formatGoalValue(metric, resultValue),
      custoLabel: metric.costLabel,
      custo: cpl ? formatCurrency(Math.round(cpl)) : null,
      retorno: roas ? formatMultiplier(roas) : null,
    });
  }, [cliente, periodoLabel, spendCents, resultValue, cpl, roas]);

  async function copiar() {
    await navigator.clipboard.writeText(mensagem);
    setCopiado(true);
    toast.success("Mensagem copiada.");
    // Volta ao ícone original: o check permanente perde o significado.
    setTimeout(() => setCopiado(false), 2000);
  }

  /**
   * Abre o PDF numa aba, sem gravar nada.
   *
   * POST por formulário e não `window.open` com query: o período e a
   * conta cabem numa URL, mas o caminho ficou POST porque a rota já
   * espera assim desde que a análise (agora removida) precisava viajar
   * no corpo. Manter um só formato evita duas rotas de preview.
   */
  function visualizar() {
    if (!cliente) return;
    setBusy("pdf");

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/reports/preview";
    form.target = "_blank";
    form.rel = "noopener";
    form.style.display = "none";

    for (const [nome, valor] of Object.entries({
      cliente: cliente.slug,
      inicio: periodo.inicio,
      fim: periodo.fim,
      // Vazio: o servidor resolve o template pelo segmento da conta.
      template: "",
    })) {
      const campo = document.createElement("input");
      campo.type = "hidden";
      campo.name = nome;
      campo.value = valor;
      form.appendChild(campo);
    }

    document.body.appendChild(form);
    form.submit();
    form.remove();
    setTimeout(() => setBusy(null), 800);
  }

  /** Gera, arquiva e dispara pelo WhatsApp de quem está logado. */
  async function gerarEEnviar() {
    if (!cliente || jaEnviado || semDado) return;
    setBusy("envio");

    try {
      const resposta = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSlug: cliente.slug,
          periodStart: periodo.inicio,
          periodEnd: periodo.fim,
          deliver: "whatsapp",
        }),
      });

      // Em modo demo a rota devolve o PDF direto, sem Storage nem envio.
      if (
        resposta.ok &&
        (resposta.headers.get("content-type") ?? "").includes("application/pdf")
      ) {
        const blob = await resposta.blob();
        window.open(URL.createObjectURL(blob), "_blank", "noopener");
        toast.success("PDF gerado. Em modo demo não há envio.");
        return;
      }

      /* Ler como TEXTO e só então tentar JSON: quando a função estoura o
         limite da plataforma, a resposta é uma página de erro, não JSON,
         e `response.json()` devolvia "Unexpected token 'A'" — mensagem
         que não diz nada sobre o que aconteceu nem o que fazer. */
      const corpo = await resposta.text();
      let dados: { error?: string } = {};
      try {
        dados = corpo ? JSON.parse(corpo) : {};
      } catch {
        toast.error(
          resposta.status === 504 || resposta.status === 502
            ? "A geração demorou demais e foi interrompida. Confira a fila abaixo — o relatório pode ter sido arquivado."
            : `O servidor respondeu de forma inesperada (HTTP ${resposta.status}).`,
        );
        return;
      }

      if (!resposta.ok) {
        toast.error(dados.error ?? "Falha ao gerar o relatório.");
        return;
      }

      toast.success("Relatório gerado e enviado por WhatsApp.");
      setEnviados((antes) => new Set(antes).add(chaveDoEnvio));
    } catch (erro) {
      toast.error(
        erro instanceof Error ? erro.message : "Falha de rede na geração.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ---------------- Coluna esquerda ---------------- */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <section className="surface-card p-4">
          {/* `min-w-0` nos três: item de grid tem `min-width: auto` e não
              encolhe abaixo do próprio conteúdo. Sem isso o select de
              template — cujo nome é longo, "E-commerce — Performance &
              ROAS" — vazava 69px para fora do card em vez de truncar. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Cliente</span>
              <Select value={clientId} onValueChange={(v) => trocarCliente(v ?? clientId)}>
                <SelectTrigger size="sm" className="w-full min-w-0">
                  <SelectValue>
                    {(v: string) =>
                      clients.find((c) => c.id === v)?.name ?? "Selecione"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {/* PERÍODO É CAMPO DE NOVO, e desta vez trocar ele troca o
                número: `trocarPeriodo` rebusca as métricas da janela.
                Abre na meta da conta, que é o que o servidor já somou. */}
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">
                Período
                {buscando && (
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">
                    somando…
                  </span>
                )}
              </span>
              <DateRangePicker value={periodo} onChange={trocarPeriodo} />
            </label>

            {/* Template é CONSEQUÊNCIA, não escolha: o segmento da conta
                decide, e é o mesmo `resolverTemplate` que o gerador usa.
                Trocar aqui só criaria a chance de mandar ao cliente um
                layout que não é o dele. Para mudar o que entra no PDF,
                o lugar é o botão Templates, no topo da página. */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="eyebrow">Template</span>
              {/* `title` porque o nome trunca nesta largura e, sendo
                  texto e não select, não há outro jeito de ler inteiro. */}
              <p
                className="flex h-8 items-center truncate text-sm"
                title={cliente?.templateName}
              >
                {cliente?.templateName ?? "—"}
              </p>
            </div>
          </div>
        </section>

        <section className="surface-card relative p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Texto para o cliente</span>
            <Button size="sm" variant="ghost" onClick={copiar} disabled={!cliente}>
              {copiado ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
              Copiar
            </Button>
          </div>
          <Textarea
            value={mensagem}
            readOnly
            rows={9}
            className="mt-2 resize-y font-mono text-xs"
          />
          {/* ZERO POR FALTA DE DADO NÃO PODE PARECER ZERO DE VERDADE.
              Sem este aviso a tela mostra R$ 0,00 nos dois casos, e o
              texto pronto para copiar sai afirmando ao cliente que ele
              não investiu nada no mês. Foi o que aconteceu com julho de
              2026: o sync de rotina só cobre o mês corrente, o mês
              fechado nunca tinha sido buscado, e a tela não tinha como
              dizer isso. */}
          {semDado && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning-muted px-3 py-2 text-2xs text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>
                <strong>Nenhum dado sincronizado neste período.</strong> Os
                zeros acima são ausência de dado, não desempenho —{" "}
                <strong>não envie</strong> esta mensagem. O robô busca o
                período na madrugada do dia agendado; para conferir antes,
                peça uma sincronização deste intervalo.
              </span>
            </p>
          )}
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Números somados das métricas sincronizadas na janela acima.
            Trocar o período rebusca no banco — o texto nunca fica
            dizendo um prazo e mostrando outro.
          </p>
        </section>

        {/* HAVIA UM "Tipo de relatório" AQUI — dois cartões, "completo"
            e "simples" — e ele só pintava a própria borda. Nada lia a
            escolha: não mudava a mensagem, não ia para o PDF, não ia
            para lugar nenhum.

            E era redundante por construção: os dois botões abaixo JÁ
            são essa escolha. "Copiar" (no card da mensagem) é o simples;
            "Gerar PDF" é o completo. Um seletor de modo acima de dois
            botões que fazem os dois modos oferece a mesma decisão duas
            vezes — e a de cima não valia nada. */}
        <section className="surface-card p-4">
          <span className="eyebrow">O que fazer com isto</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!cliente || busy !== null}
              onClick={visualizar}
            >
              <FileDown className="size-4" />
              {busy === "pdf" ? "Abrindo…" : "Visualizar PDF"}
            </Button>
            <Button
              size="sm"
              className="bg-signal text-white hover:bg-signal/90"
              /* `semDado` TRAVA o botão, não só avisa. O aviso amarelo
                 logo acima já dizia "não envie" — e o botão continuava
                 clicável ao lado dele. Numa tarde de sete envios
                 seguidos, um aviso que não impede nada é um aviso que se
                 lê depois. Trocar o período limpa o estado. */
              disabled={!cliente || busy !== null || jaEnviado || semDado}
              onClick={gerarEEnviar}
              title={
                jaEnviado
                  ? "Já enviado nesta janela. Troque o período ou a conta para enviar de novo."
                  : semDado
                    ? "Sem dado sincronizado neste período — o PDF sairia zerado."
                    : "Gera o PDF e despacha pelo SEU WhatsApp"
              }
            >
              {jaEnviado ? (
                <Check className="size-4" />
              ) : (
                <MessageCircle className="size-4" />
              )}
              {busy === "envio"
                ? "Enviando…"
                : jaEnviado
                  ? "Enviado ✓"
                  : "Gerar e enviar"}
            </Button>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">
            <strong>Visualizar</strong> abre o PDF numa aba sem gravar
            nada — serve para conferir antes. <strong>Gerar e enviar</strong>
            arquiva e dispara pelo seu WhatsApp, com o documento em anexo.
            Só a mensagem, sem PDF? Use o <strong>Copiar</strong> acima.
          </p>
        </section>
      </div>

      {/* ---------------- Coluna direita ---------------- */}
      <div className="flex flex-col gap-4">
        <section className="overflow-hidden rounded-xl bg-gradient-to-br from-signal to-[color-mix(in_oklab,var(--signal)_55%,black)] p-4 text-white">
          <p className="text-xs opacity-80">{periodoLabel}</p>
          <h3 className="mt-0.5 truncate text-lg font-semibold">
            {cliente?.name ?? "Nenhum cliente"}
          </h3>

          {/* EMPILHADO, não em três colunas. Com faturamento de seis
              dígitos — "R$ 835.070,52" — as três colunas colidiam num
              card desta largura, e o valor ficava colado no vizinho. Uma
              linha por número não tem esse limite. */}
          <dl className="mt-4 flex flex-col gap-2 border-t border-white/20 pt-3">
            {[
              /* ⚠️ `spendCents`/`resultValue` DERIVADOS, nunca
                 `cliente.spendCents`. Este cartão é o que a pessoa olha
                 enquanto decide, e ler direto da prop o deixava preso na
                 janela da meta enquanto a mensagem ao lado já mostrava a
                 janela escolhida. Visto na tela: período trocado para 7
                 dias, o Retorno virou 0,00x e o Investimento continuou o
                 do mês — dois números do mesmo card falando de períodos
                 diferentes. É o mesmo defeito que derrubou o seletor
                 antigo, só que uma camada acima. */
              ["Investimento", cliente ? formatCurrency(spendCents) : "—"],
              [
                cliente?.metric.label ?? "Resultados",
                cliente ? formatGoalValue(cliente.metric, resultValue) : "—",
              ],
              /* Terceira coluna: custo unitário onde ele existe, ROAS
                 onde a meta é dinheiro. */
              cliente?.metric.isCurrency
                ? ["Retorno", roas ? formatMultiplier(roas) : "—"]
                : ["Custo", cpl ? formatCurrency(Math.round(cpl)) : "—"],
            ].map(([label, valor]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3"
              >
                <dt className="text-[10px] uppercase tracking-wide opacity-75">
                  {label}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="surface-card p-4">
          <span className="eyebrow">Seções do relatório</span>
          <ul className="mt-3 flex flex-col gap-3">
            {SECOES.map(({ icon: Icon, titulo, sub }) => (
              <li key={titulo} className="flex items-start gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">
                  <Icon className="size-3.5 text-muted-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{titulo}</span>
                  <span className="block text-2xs text-muted-foreground">{sub}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-2xs text-muted-foreground">
            As seções variam por segmento — o template do cliente decide
            quais entram no PDF.
          </p>
        </section>
      </div>
    </div>
  );
}
