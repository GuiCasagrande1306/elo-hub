"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Check, Copy, FileDown, MessageCircle, Pencil, RotateCcw,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate, formatPeriod } from "@/lib/format";
import { dataNoBrasil } from "@/lib/date-br";
import { estadoDaJanela } from "@/lib/reports/janela-coberta";
import { goalExecutedFrom, type GoalMetric } from "@/lib/metrics/goal-metric";
import {
  DateRangePicker,
  type Intervalo,
} from "@/components/ui/date-range-picker";
import {
  linhasDaLegenda,
  mensagemDoCliente,
} from "@/lib/reports/mensagem-do-cliente";
import { kpisDoTemplate, type MetricTotals } from "@/lib/metrics/kpi";
import type { MetricKey } from "@/types/database";
import { resumoDoPeriodo } from "./actions";

/* =====================================================================
   Estação de comando
   ---------------------------------------------------------------------
   Uma tela para a pergunta "mandar o resultado desta conta agora":
   escolher a conta e a janela, conferir o texto, despachar.

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
  /**
   * Quantas linhas de `daily_metrics` existem na janela inicial.
   *
   * ⚠️ ZERO LINHA E ZERO REAL SÃO COISAS DIFERENTES, e sem este campo a
   * tela não distinguia as duas na janela padrão — `semDado` só era
   * calculado quando alguém trocava o período. Conta cujo sync quebrou
   * abria com "Investimento R$ 0,00", sem aviso e com o botão liberado,
   * e um clique mandava ao cliente um PDF zerado afirmando que ele não
   * investiu nada no mês.
   */
  linhas: number;
  /** Último dia da janela da meta com linha. `null` = nenhuma. */
  ultimoDiaComDado: string | null;
  /** Saúde da coleta — ver `saudeDaColetaDaCarteira` em `data.ts`. */
  sincronizacao: { comErro: boolean; ate: string | null };
  /** Template que o segmento desta conta seleciona. Exibido, não escolhido. */
  templateName: string;
  /**
   * As métricas do template, na ordem em que o PDF as imprime.
   *
   * A prévia da mensagem monta as linhas a partir daqui, com
   * `kpisDoTemplate` — a MESMA função que monta os cartões do
   * documento. Sem isso a tela derivava três números por conta própria
   * e a legenda discordava do anexo; ver `linhasDaLegenda`.
   */
  metricas: MetricKey[];
  /** Como esta conta chama cada métrica: "Pedidos", "Custo por lead". */
  rotulos: Partial<Record<MetricKey, string>>;
  /** Totais inteiros da janela da meta, com `origem` para o selo. */
  totais: MetricTotals;
}

/** Corte do WhatsApp para legenda de documento. */
const LIMITE_DA_LEGENDA = 1024;

export function CommandStation({
  clients,
  modeloDaMensagem,
}: {
  clients: ClientSummary[];
  /**
   * O texto gravado em `report_message_settings`.
   *
   * Vem do servidor porque é ele que a legenda do envio também usa —
   * a tela e o WhatsApp chamam a MESMA função com o MESMO modelo, que é
   * o que impede a equipe de conferir um texto e o cliente receber
   * outro.
   */
  modeloDaMensagem: string;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [copiado, setCopiado] = useState(false);

  /* A LEGENDA EDITADA À MÃO, amarrada à conta e à janela em que foi
     escrita. A chave é o que impede o defeito mais caro desta tela: um
     texto escrito para uma conta sair com o nome ou os números de outra.
     Trocar cliente ou período limpa a edição (ver `trocarCliente` e
     `trocarPeriodo`), e a comparação de chave abaixo é a rede de
     segurança caso algum caminho novo esqueça de limpar. */
  const [edicao, setEdicao] = useState<{ chave: string; texto: string } | null>(
    null,
  );
  const campoDoTexto = useRef<HTMLTextAreaElement>(null);
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
    /* Inteiros, para a mensagem. Os achatados acima travam o envio
       quando não há número conferido; o texto que vai ao cliente sai
       destes, pela mesma função que o PDF usa. */
    totais: MetricTotals;
    /** Último dia COM DADO da janela buscada. */
    ultimoDia: string | null;
  } | null>(null);
  const [buscando, setBuscando] = useState(false);

  /* QUAL BUSCA VALE. Cada chamada leva um número; só a última escreve.
     -----------------------------------------------------------------
     `resumoDoPeriodo` é server action — centenas de milissegundos — e
     trocar o Select é instantâneo. Sem isto, a resposta da conta A
     chegava depois da troca para B e sobrescrevia o estado de B: a
     tela mostrou o nome da Leotex com os números da Brazzo, e o
     texto pronto para copiar era montado com eles. `buscando` já tinha
     voltado a false, então nada na tela denunciava.

     Vale também para duas trocas rápidas de período na mesma conta, em
     que as respostas voltam fora de ordem. */
  const buscaAtual = useRef(0);

  /* `true` só quando a busca VOLTOU e não achou linha nenhuma. Começa
     `false` porque a janela inicial é a da meta, que o servidor já
     somou. Ver a nota de `linhas` em `ResumoDoPeriodo`: zero real e
     período nunca sincronizado apareciam iguais na tela. */
  /* `null` = ainda não se sabe / vale o que o servidor disse para esta
     janela. Só vira booleano quando UMA BUSCA respondeu. */
  const [semDadoDaBusca, setSemDadoDaBusca] = useState<boolean | null>(null);

  const periodoLabel = formatPeriod(periodo.inicio, periodo.fim);

  /* Quantos dias a janela cobre. Decide só entre "dos últimos 7 dias" e
     a data por extenso na mensagem — nenhuma conta depende disto.
     `+1` porque o intervalo inclui as duas pontas. */
  const diasDoPeriodo =
    periodo.inicio && periodo.fim
      ? Math.round(
          (Date.parse(`${periodo.fim}T00:00:00Z`) -
            Date.parse(`${periodo.inicio}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      : 0;

  /* Conta + janela. Trocar qualquer um dos dois libera o botão de novo. */
  const chaveDoEnvio = `${clientId}|${periodo.inicio}|${periodo.fim}`;
  const jaEnviado = enviados.has(chaveDoEnvio);

  /* ⚠️ `janelaDaMeta` DECIDE SE O NÚMERO INICIAL AINDA VALE.
     -----------------------------------------------------------------
     `override` nulo significava duas coisas diferentes — "ainda é a
     janela da meta, valem os números do servidor" e "acabei de trocar o
     período e ainda não sei" —, e o `??` tratava as duas igual. O
     resultado: ao aplicar uma janela nova, a prévia voltava a mostrar o
     total do MÊS INTEIRO sob o rótulo da semana, e ficava assim durante
     toda a busca. Se ela falhasse, ficava para sempre.

     É o mesmo defeito que derrubou o primeiro seletor desta tela, e o
     conserto anterior prometia "—" sem entregar. */
  const janelaDaMeta =
    cliente != null &&
    periodo.inicio === cliente.period.start &&
    periodo.fim === cliente.period.end;

  const doServidor = janelaDaMeta ? cliente : null;

  const spendCents = override?.spendCents ?? doServidor?.spendCents ?? null;
  const resultValue = override?.resultValue ?? doServidor?.resultValue ?? null;

  /* Os totais inteiros da janela vigente — a fonte dos números da
     mensagem. Segue exatamente a regra do `janelaDaMeta` acima: durante
     uma busca que ainda não voltou é `null`, e a mensagem sai sem o
     bloco em vez de sair com os números da janela anterior. */
  const totais = override?.totais ?? doServidor?.totais ?? null;

  /** Nenhum número conferido para esta janela — o envio fica travado. */
  const semNumero = spendCents === null || resultValue === null;

  /* ⚠️ DERIVADO, NÃO GUARDADO EM ESTADO INICIAL.
     -----------------------------------------------------------------
     Era `useState(clients[0]?.linhas === 0)`, que roda UMA VEZ na
     montagem. A prop `clients` é substituída sem remontagem toda vez
     que alguém chama `revalidatePath("/relatorios")` — e três ações da
     MESMA página fazem isso. Então a trava ficava congelada no valor de
     06h enquanto a prévia da mensagem já trazia os números que o sync
     trouxe às 06h20, ou o contrário.

     Na janela da meta vale o que o servidor contou; fora dela, o que a
     busca respondeu. Enquanto a busca não respondeu, `null` — e é o
     `buscando` abaixo que segura o botão. */
  const semDado = janelaDaMeta
    ? (cliente?.linhas ?? 0) === 0
    : (semDadoDaBusca ?? false);

  /* JANELA QUE ACABA ANTES DO PERÍODO — a regra mora em
     `lib/reports/janela-coberta.ts`, com teste de mesa. Decisão de
     interface escrita dentro do componente não tem como ser conferida
     sem clicar, e esta decide se um relatório pode ou não sair. */
  const ultimoDiaComDado = janelaDaMeta
    ? (cliente?.ultimoDiaComDado ?? null)
    : (override?.ultimoDia ?? null);

  const { incompleta: janelaIncompleta, naoApurada: janelaNaoApurada } =
    estadoDaJanela({
      fim: periodo.fim,
      hoje: dataNoBrasil(),
      ultimoDiaComDado,
      semDado,
      sincronizacao: cliente?.sincronizacao ?? { comErro: true, ate: null },
    });

  /* `buscando` ENTRA NA TRAVA. Sem ele, trocar o período liberava o
     botão durante toda a ida ao servidor: `semDado` tinha acabado de
     ser limpo e o guard interno de `gerarEEnviar` lia o mesmo valor
     otimista. Uma janela nunca sincronizada ficava clicável por meio
     segundo — o bastante para o clique que o conserto existe para
     impedir. `semNumero` fecha o resto: sem número conferido não há o
     que enviar. */
  const naoPodeEnviar =
    !cliente || buscando || semDado || semNumero || janelaNaoApurada;

  /** Troca de conta reabre na janela da meta dela e descarta a busca. */
  function trocarCliente(id: string) {
    const alvo = clients.find((c) => c.id === id);
    /* Invalida qualquer busca em voo: a resposta que chegar depois é da
       conta anterior e não pode escrever nesta. */
    buscaAtual.current += 1;
    setBuscando(false);
    setClientId(id);
    setOverride(null);
    setEdicao(null);
    /* A conta nova abre na janela da meta dela, e ali quem responde é
       `cliente.linhas` — derivado, não guardado. */
    setSemDadoDaBusca(null);
    if (alvo) setPeriodo({ inicio: alvo.period.start, fim: alvo.period.end });
  }

  /** Trocar o período REBUSCA. É o que impede a tela de mentir. */
  function trocarPeriodo(novo: Intervalo) {
    setPeriodo(novo);
    /* O texto editado citava os números da janela anterior. */
    setEdicao(null);
    if (!cliente) return;

    /* O NÚMERO VELHO SAI JUNTO COM O RÓTULO VELHO.
       ---------------------------------------------------------------
       `setPeriodo` acima já trocou a frase da tela. Se a busca falhar,
       a prévia ficaria mostrando o total da janela ANTERIOR sob o
       rótulo da nova — e o texto pronto para copiar diria "Período: 1 a
       31 de julho · Investimento: R$ 4.201,55" com o gasto de agosto.
       É exatamente o defeito que derrubou o primeiro seletor desta
       tela, e ele tinha voltado pela porta do erro.

       Limpar antes de buscar tira o número errado da prévia: ela sai
       sem o bloco enquanto carrega, e continua sem ele se falhar. */
    setOverride(null);
    setSemDadoDaBusca(null);

    const meuTurno = (buscaAtual.current += 1);
    setBuscando(true);

    resumoDoPeriodo({
      clientId: cliente.id,
      start: novo.inicio,
      end: novo.fim,
    })
      .then((r) => {
        // Chegou tarde: a tela já é de outra conta ou de outra janela.
        if (meuTurno !== buscaAtual.current) return;

        if (!r.ok) {
          toast.error(r.error);
          /* Trava o botão: uma busca que falhou deixava "Gerar e
             enviar" liberado sobre uma prévia sem número. */
          setSemDadoDaBusca(true);
          return;
        }
        /* A UNIDADE VEM DE `cliente.metric`, não do servidor. É a mesma
           que formatou os números iniciais, então a prévia e o PDF não
           têm como discordar dela. Deixar o servidor escolher já
           produziu R$ 0,64 onde eram R$ 12.170,81 — ele resolveu
           contagem e a tela formatou como dinheiro. */
        setSemDadoDaBusca(r.resumo.linhas === 0);
        setOverride({
          spendCents: r.resumo.spendCents,
          resultValue: goalExecutedFrom(cliente.metric, {
            conversions: r.resumo.conversions,
            revenueCents: r.resumo.revenueCents,
          }),
          totais: r.resumo.totais,
          ultimoDia: r.resumo.ultimoDia,
        });
      })
      .catch(() => {
        if (meuTurno !== buscaAtual.current) return;
        toast.error("Não deu para somar o período.");
        setSemDadoDaBusca(true);
      })
      .finally(() => {
        if (meuTurno === buscaAtual.current) setBuscando(false);
      });
  }

  /* O TEXTO NÃO É MONTADO AQUI — ver `lib/reports/mensagem-do-cliente`.
     Esta tela e o envio pelo WhatsApp chamam a mesma função; enquanto
     cada um montava o seu, a equipe conferia um texto e o cliente
     recebia outro.

     A mensagem não leva mais número nenhum, só o período: os números
     ficam no PDF, onde o selo da campanha de origem explica de onde
     eles saem. Ver o cabeçalho daquele arquivo. */
  const mensagem = useMemo(() => {
    if (!cliente) return "";

    /* OS NÚMEROS DA PRÉVIA SÃO OS DO PDF, e é `kpisDoTemplate` que
       garante: a mesma função, as mesmas métricas, os mesmos rótulos e
       os mesmos totais que o gerador do payload usa. A tela não divide
       nada aqui.

       `null` enquanto a busca de outro período não voltou — melhor a
       mensagem sem o bloco por um instante do que com os números da
       janela anterior sob o rótulo da nova.

       Sem período anterior de propósito: a legenda não imprime
       variação, e carregá-lo até aqui seria uma segunda consulta para
       um dado que ninguém lê. */
    const numeros =
      totais === null
        ? []
        : linhasDaLegenda(
            kpisDoTemplate(cliente.metricas, cliente.rotulos, totais),
          );

    return mensagemDoCliente(
      {
        periodoLabel,
        dias: diasDoPeriodo,
        cliente: cliente.name,
        numeros,
      },
      modeloDaMensagem,
    );
  }, [cliente, periodoLabel, diasDoPeriodo, modeloDaMensagem, totais]);

  /* O QUE ESTÁ NA CAIXA É O QUE SAI. Editado, vale o texto da pessoa —
     no Copiar e no envio; senão, o automático, que continua vindo dos
     dados reais a cada troca de período. */
  const textoEditado = edicao?.chave === chaveDoEnvio ? edicao.texto : null;
  const editando = textoEditado !== null;
  const textoFinal = textoEditado ?? mensagem;

  /* Vazio mandaria o PDF sem legenda nenhuma; acima de 1024 o WhatsApp
     corta a mensagem no meio. A rota recusa os dois — aqui a trava
     aparece antes do clique. */
  const legendaInvalida =
    editando &&
    (textoEditado.trim().length === 0 ||
      textoEditado.length > LIMITE_DA_LEGENDA);

  function editar() {
    setEdicao({ chave: chaveDoEnvio, texto: mensagem });
    // O campo acabou de deixar de ser só leitura: o cursor vai para ele.
    requestAnimationFrame(() => campoDoTexto.current?.focus());
  }

  async function copiar() {
    await navigator.clipboard.writeText(textoFinal);
    setCopiado(true);
    toast.success("Mensagem copiada.");
    // Volta ao ícone original: o check permanente perde o significado.
    setTimeout(() => setCopiado(false), 2000);
  }

  /**
   * Abre o PDF numa aba, sem gravar nada.
   *
   * ⚠️ GET COM QUERY, NUNCA FORMULÁRIO POST.
   *
   * A aba que nasce de um POST MOSTRA o PDF — e não deixa salvar. O
   * botão de baixar do leitor do Chrome não guarda os bytes que já
   * recebeu: ele REFAZ a requisição, e refaz como GET, sem corpo. Com o
   * POST, esse refazer chegava em `/api/reports/preview` pelado,
   * levava 400 "Informe o cliente", e o download morria em "O site não
   * está disponível". Medido em 02/10/2026: três tentativas seguidas no
   * relatório da Brazzo, todas falhadas, e o arquivo nem nome ganhava
   * — virava "preview", tirado do caminho da URL.
   *
   * `Cache-Control: no-store` na rota torna o refazer OBRIGATÓRIO: não
   * existe cópia em cache para o Chrome salvar. Então a URL desta aba
   * precisa ser, sozinha, uma requisição que funciona.
   */
  function visualizar() {
    if (!cliente) return;
    setBusy("pdf");

    /* `template` fica de fora de propósito: ausente ou vazio, a rota
       resolve pelo segmento da conta — o mesmo caminho de antes. */
    const query = new URLSearchParams({
      cliente: cliente.slug,
      inicio: periodo.inicio,
      fim: periodo.fim,
    });

    /* Âncora e não `window.open`: com uma string de features o Chrome
       pode abrir JANELA em vez de aba, e sem gesto reconhecido o
       bloqueador de pop-up engole a chamada. Um clique em <a
       target="_blank"> é navegação comum — sempre aba, nunca bloqueada. */
    const link = document.createElement("a");
    link.href = `/api/reports/preview?${query}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => setBusy(null), 800);
  }

  /** Gera, arquiva e dispara pelo WhatsApp de quem está logado. */
  async function gerarEEnviar() {
    if (naoPodeEnviar || jaEnviado || legendaInvalida) return;
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
          /* Só quando editada. Ausente, o servidor monta a legenda com
             os números do payload — o mesmo texto que a caixa mostra. */
          ...(textoEditado !== null ? { legenda: textoEditado } : {}),
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
    <div className="flex flex-col gap-4">
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
        {/* `flex-wrap`: com "Voltar ao automático" os três elementos
            não cabem numa linha de 375px, e sem quebra o Copiar era
            empurrado para fora do cartão. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="eyebrow">
            Texto para o cliente
            {editando && (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-warning">
                · editado
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            {editando ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEdicao(null)}
              >
                <RotateCcw className="size-3.5" />
                Voltar ao automático
              </Button>
            ) : (
              /* Travado durante a busca: editar ali capturaria o texto
                 SEM o bloco de números, que só chega quando a busca
                 do período volta. */
              <Button
                size="sm"
                variant="ghost"
                onClick={editar}
                disabled={!cliente || buscando || !mensagem}
              >
                <Pencil className="size-3.5" />
                Editar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={copiar} disabled={!cliente}>
              {copiado ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
              Copiar
            </Button>
          </div>
        </div>
        <Textarea
          ref={campoDoTexto}
          value={textoFinal}
          readOnly={!editando}
          onChange={(e) =>
            setEdicao({ chave: chaveDoEnvio, texto: e.target.value })
          }
          aria-invalid={legendaInvalida || undefined}
          rows={9}
          className={cn(
            "mt-2 resize-y font-mono text-xs",
            editando && "border-warning/50",
          )}
        />
        {editando && (
          <p
            className={cn(
              "mt-1 text-right text-2xs tabular-nums",
              legendaInvalida ? "text-negative" : "text-muted-foreground",
            )}
          >
            {textoEditado.trim().length === 0
              ? "O texto não pode ficar vazio."
              : `${textoEditado.length} / ${LIMITE_DA_LEGENDA}`}
          </p>
        )}
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
        {/* JANELA QUE ACABA ANTES DO PERÍODO. Dois textos, porque são
            dois problemas: coleta quebrada (barra o envio) e conta
            que simplesmente não veiculou (só informa). */}
        {janelaIncompleta && (
          <p
            className={cn(
              "mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-2xs",
              janelaNaoApurada
                ? "bg-negative-muted/50 text-negative"
                : "bg-surface-2/70 text-muted-foreground",
            )}
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              {/* As datas ficam no MEIO da frase: `formatDate` devolve
                  "17 de set." com o ponto da abreviação, e terminar a
                  oração nela imprimia "set..". */}
              {janelaNaoApurada ? (
                <>
                  <strong>
                    Os números param em{" "}
                    {formatDate(`${ultimoDiaComDado}T12:00:00`)} e o período
                    vai até {formatDate(`${periodo.fim}T12:00:00`)}
                  </strong>{" "}
                  — a coleta desta conta está atrasada, então os dias que
                  faltam não foram apurados. <strong>Não envie</strong>:
                  reconecte a plataforma em Configurações e peça a
                  sincronização deste intervalo.
                </>
              ) : (
                <>
                  Os números param em{" "}
                  {formatDate(`${ultimoDiaComDado}T12:00:00`)} — a coleta
                  está em dia, então os dias sem linha são dias sem
                  veiculação.
                </>
              )}
            </span>
          </p>
        )}

        {/* A promessa do texto automático — "nunca diz um prazo e
            mostra outro" — deixa de valer quando alguém edita. A nota
            muda junto, para ninguém confiar numa garantia que o texto
            manual não tem. */}
        <p className="mt-1.5 text-2xs text-muted-foreground">
          {editando ? (
            <>
              <strong className="text-foreground">
                Este é o texto que vai no envio.
              </strong>{" "}
              Editado à mão, ele não acompanha mais os dados: trocar de
              cliente ou de período descarta a edição e volta ao
              automático.
            </>
          ) : (
            <>
              Números somados das métricas sincronizadas na janela acima.
              Trocar o período rebusca no banco — o texto nunca fica
              dizendo um prazo e mostrando outro. Use{" "}
              <strong>Editar</strong> para acrescentar ou tirar algo
              antes de enviar.
            </>
          )}
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
        {/* `max-w-lg`: sem a coluna da direita a seção ocupa a largura
            da página, e dois botões esticados a 600px cada liam como
            faixa, não como botão. */}
        <div className="mt-2 grid max-w-lg gap-2 sm:grid-cols-2">
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
            disabled={
              busy !== null || jaEnviado || naoPodeEnviar || legendaInvalida
            }
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
  );
}
