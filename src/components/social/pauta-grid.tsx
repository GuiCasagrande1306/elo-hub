"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarSync,
  ChevronLeft,
  ChevronRight,
  Film,
  FileText,
  Image as ImageIcon,
  Images,
  Layers,
  Loader2,
  Paperclip,
  Plus,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  anexarArte,
  assinarArtes,
  criarPauta,
  enviarArte,
  moverPauta,
} from "@/app/(app)/midias-sociais/actions";
import { dataNoBrasil } from "@/lib/date-br";
import { horaDoPost, rotuloDoDia } from "@/lib/social/agenda";
import { ehArteDoPainel } from "@/lib/social/media";
import { FORMATO_LABEL } from "@/lib/social/networks";
import {
  PRODUCAO,
  agruparPorClienteEDia,
  deslocarSemana,
  producaoDoPost,
  resumirSemana,
  rotuloDaColuna,
  rotuloDaSemana,
  semanaDe,
} from "@/lib/social/pauta";
import { ProgramacaoDialog } from "./programacao-dialog";
import { useLocalPreference } from "@/lib/use-local-preference";
import { cn } from "@/lib/utils";
import type {
  Client,
  SocialFormat,
  SocialPostWithRelations,
  SocialRecurrenceWithClient,
} from "@/types/database";

/* =====================================================================
   Pauta — a semana inteira da carteira, cliente por cliente
   ---------------------------------------------------------------------
   Uma linha por cliente, uma coluna por dia. É a grade que a agência
   desenha no quadro branco, e ela responde a pergunta que nenhuma das
   outras duas visões responde: QUEM ESTÁ SEM NADA.

   O calendário do mês esconde isso por construção. Um cliente sem peça
   não desenha nada nele — ele simplesmente não aparece, e uma semana com
   dez peças de dois clientes parece uma semana cheia. Aqui o mesmo
   cliente ocupa uma linha vazia do tamanho das outras.

   POR ISSO A LINHA VAZIA É O PADRÃO, e não um caso escondido atrás de
   uma caixinha. Quem já encheu a semana liga "Só com pauta" e some com
   elas; quem está planejando precisa justamente delas.
   ===================================================================== */

/**
 * Ícone por formato.
 *
 * TODA leitura leva `?? ImageIcon`, e não é zelo: o `check` de
 * `social_posts.format` em produção passou semanas fora de sincronia com
 * o tipo daqui (ver a migration 68), e uma linha com um formato que este
 * mapa não conhece devolveria `undefined` — que como componente JSX
 * derruba a grade inteira, não só o chip.
 *
 * O `??` mora em cada uso em vez de numa função auxiliar porque o React
 * Compiler recusa `const Icone = fn()` com "Cannot create components
 * during render"; o acesso ao mapa ele aceita.
 */
const ICONE_FORMATO: Record<SocialFormat, LucideIcon> = {
  video_vertical: Smartphone,
  video_horizontal: Film,
  imagem: ImageIcon,
  carrossel: Images,
  stories: Layers,
  artigo: FileText,
};

/** Rótulo que cabe em 56px, embaixo do ícone. */
const ROTULO_CURTO: Partial<Record<SocialFormat, string>> = {
  video_vertical: "Vertical",
  carrossel: "Carrossel",
  imagem: "Imagem",
  stories: "Stories",
};

/* Os quatro do atalho, na ordem em que a casa produz. Os outros dois
   (horizontal e artigo) existem no compositor — botão de atalho para
   formato que aparece uma vez por trimestre só rouba largura de célula. */
const ATALHOS: SocialFormat[] = [
  "video_vertical",
  "carrossel",
  "imagem",
  "stories",
];

/**
 * O tipo MIME do nosso arrasto.
 *
 * NÃO É DETALHE. Antes daqui a célula fazia `preventDefault()` em todo
 * `dragover` e lia a peça arrastada do ESTADO, não do evento. Duas
 * consequências, as duas medidas na tela:
 *
 *   1. Soltar um arquivo do Finder na grade era aceito pela célula, o
 *      `drop` não era cancelado, e o navegador abria o arquivo — tirando
 *      a pessoa do painel no meio do planejamento.
 *
 *   2. Se o chip de origem desmontasse durante o arrasto (um
 *      `router.refresh()` chegando no meio, e a tela dispara um a cada
 *      pauta criada), o `dragend` era disparado num nó já destacado e o
 *      React não o via. O estado ficava preso — e o PRÓXIMO drop em
 *      qualquer célula reagendava uma peça que ninguém tinha arrastado.
 *
 * Com um tipo próprio, a célula só aceita o que ela mesma originou, e a
 * identidade da peça vem do evento. O estado sobrou para uma coisa só:
 * desenhar a opacidade de quem está sendo arrastado. Se ele vazar, o
 * estrago é cosmético.
 */
const MIME_PECA = "application/x-elo-pauta";

interface Props {
  /** O que a grade DESENHA: já recortado por todos os filtros do topo. */
  posts: SocialPostWithRelations[];
  /**
   * A pauta da carteira recortada só por CLIENTE e REDE — sem o filtro de
   * situação, sem "sem data", sem busca.
   *
   * É ela que responde "quem está sem nada", e é por isso que existe
   * separada. Com o filtro de situação ligado, `posts` esvazia as
   * células, e contar o buraco em cima dele faria a tela afirmar que 40
   * clientes estão sem pauta quando o que houve foi um clique num cartão
   * do topo.
   */
  pautaDaCarteira: SocialPostWithRelations[];
  /**
   * Um filtro do topo (situação, "sem data" ou busca) está estreitando o
   * que a grade desenha.
   *
   * VEM DE FORA, e não de comparar os dois arrays — que foi a primeira
   * tentativa e acendia o aviso sozinho: `posts` já nasce sem os
   * arquivados, então os tamanhos diferem no estado normal da tela, e o
   * aviso aparecia com filtro nenhum ligado. Só o workspace sabe se
   * alguém CLICOU em alguma coisa.
   */
  recorteParcial: boolean;
  /** Já recortados pelo filtro de cliente do workspace. */
  clients: Client[];
  /**
   * A carteira inteira, sem o recorte de cliente.
   *
   * A grade semanal fala de todos os clientes que têm programação, e um
   * filtro de cliente na tela não deveria esconder metade dela do
   * diálogo — que é onde se conserta justamente o cliente que sumiu.
   */
  todosOsClientes: Client[];
  programacao: SocialRecurrenceWithClient[];
  onAbrirPost: (post: SocialPostWithRelations) => void;
  /** Compositor completo, com o dia preenchido. É o caminho do celular. */
  onNovoNoDia: (dia: string) => void;
}

export function PautaGrid({
  posts,
  pautaDaCarteira,
  recorteParcial,
  clients,
  todosOsClientes,
  programacao,
  onAbrirPost,
  onNovoNoDia,
}: Props) {
  const hojeISO = dataNoBrasil();
  const [ancora, setAncora] = useState(hojeISO);
  const [soComPauta, setSoComPauta] = useLocalPreference(
    "elo:social:pauta:so-com-pauta",
    false,
  );
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  /** Célula com o popover de pauta rápida aberto: `"<clientId>|<dia>"`. */
  const [criandoEm, setCriandoEm] = useState<string | null>(null);
  const [programando, setProgramando] = useState(false);
  const router = useRouter();

  const dias = useMemo(() => semanaDe(ancora), [ancora]);
  const grade = useMemo(() => agruparPorClienteEDia(posts), [posts]);
  const semData = useMemo(() => posts.filter((p) => !p.scheduled_at), [posts]);

  const comPautaNaSemana = useMemo(() => {
    const ids = new Set<string>();
    for (const [clientId, porDia] of grade) {
      if (dias.some((d) => (porDia.get(d)?.length ?? 0) > 0)) ids.add(clientId);
    }
    return ids;
  }, [grade, dias]);

  /* `base` é a carteira que a grade desenharia; `linhas` é o que ela
     desenha depois da caixinha. A distinção existe porque o número do
     topo saía de `linhas` — e "Só com pauta" tinha acabado de remover
     dali justamente os clientes que ele conta. Marcar a caixa não
     escondia só as linhas vazias: apagava a métrica que as contava, e o
     texto passava a AFIRMAR "todos os clientes com pauta". */
  const base = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [clients],
  );

  const linhas = useMemo(
    () => (soComPauta ? base.filter((c) => comPautaNaSemana.has(c.id)) : base),
    [base, comPautaNaSemana, soComPauta],
  );

  const resumo = useMemo(
    () =>
      resumirSemana(
        pautaDaCarteira,
        dias,
        base.map((c) => c.id),
      ),
    [pautaDaCarteira, dias, base],
  );

  const semanaAtual = dias.includes(hojeISO);

  /* ------------------------- Miniatura da arte -------------------------
     A capa de cada peça, assinada em lote. Sem ela a grade só dizia que
     havia arte (um clipe de 10px); com ela, "o que já está pronto" se lê
     sem abrir nada — que é metade da pergunta desta tela.

     O caminho no banco é permanente e a URL assinada expira, então nada
     disso é gravado; assina-se na hora de mostrar, como no compositor. */
  const [previas, setPrevias] = useState<Record<string, string>>({});

  const capas = useMemo(() => {
    const lista: string[] = [];
    for (const p of posts) {
      const primeira = p.media_urls[0];
      if (primeira && ehArteDoPainel(primeira)) lista.push(primeira);
    }
    return lista;
  }, [posts]);

  useEffect(() => {
    const faltando = capas.filter((c) => previas[c] === undefined).slice(0, 60);
    if (faltando.length === 0) return;

    let ativo = true;
    assinarArtes(faltando).then((r) => {
      if (!ativo) return;
      /* O que NÃO voltou assinado é gravado como string vazia, de
         propósito: sem isso o caminho continuava "faltando" a cada
         render, o efeito repetia o pedido para sempre e a aba esquentava
         sozinha. Vazio quer dizer "já perguntei, não dá para mostrar". */
      setPrevias((atual) => {
        const novo = { ...atual };
        for (const c of faltando) novo[c] = r.ok ? (r.dados[c] ?? "") : "";
        return novo;
      });
    });

    return () => {
      ativo = false;
    };
  }, [capas, previas]);

  /* O popover vive num portal, então ele NÃO some junto com a grade
     quando a janela encolhe abaixo de `lg` — ficava flutuando sobre a
     lista do celular, ancorado num gatilho invisível. */
  useEffect(() => {
    const consulta = window.matchMedia("(min-width: 1024px)");
    const aoMudar = () => {
      if (!consulta.matches) setCriandoEm(null);
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  /* Células e chips em que um upload está correndo, para desenhar o
     estado. Um `Set` e não um booleano: dois arrastos em células
     diferentes acontecem, e um spinner global mentiria sobre os dois. */
  const [enviandoEm, setEnviandoEm] = useState<Set<string>>(new Set());

  function marcarEnvio(chave: string, ligado: boolean) {
    setEnviandoEm((atual) => {
      const novo = new Set(atual);
      if (ligado) novo.add(chave);
      else novo.delete(chave);
      return novo;
    });
  }

  /**
   * Soltar arquivo de arte na grade.
   *
   * O alvo é DEDUZIDO, e a dedução é a parte que importa:
   *
   *   sobre um chip      → anexa naquela peça, sem ambiguidade nenhuma
   *   célula com 1 peça  → anexa nela; é o caso comum e não vale
   *                        perguntar
   *   célula vazia       → cria a pauta com o nome do arquivo e anexa,
   *                        que é literalmente o que a pessoa quis dizer
   *                        ao soltar um Reels numa terça em branco
   *   célula com 2+      → recusa e pede para soltar em cima da peça.
   *                        Escolher por conta própria aqui erraria
   *                        metade das vezes, e a arte iria parar na peça
   *                        errada sem ninguém notar.
   */
  async function soltarArquivos(
    arquivos: File[],
    clientId: string,
    dia: string,
    alvo: { postId: string } | { doDia: SocialPostWithRelations[] },
    chave: string,
  ) {
    if (arquivos.length === 0) return;

    let postId: string | null = null;

    if ("postId" in alvo) {
      postId = alvo.postId;
    } else if (alvo.doDia.length === 1) {
      postId = alvo.doDia[0]!.id;
    } else if (alvo.doDia.length > 1) {
      toast.error(
        "Este dia tem mais de uma peça. Solte o arquivo em cima da peça certa.",
      );
      return;
    }

    marcarEnvio(chave, true);

    try {
      /* Sequencial, não em paralelo: são arquivos grandes, e disparar
         seis uploads de 30MB de uma vez satura a subida de um escritório
         comum — todos ficam lentos e algum estoura. Mesma escolha do
         `ArtUploader`. */
      for (const arquivo of arquivos) {
        const form = new FormData();
        form.append("arquivo", arquivo);
        form.append("clientId", clientId);

        const envio = await enviarArte(form);
        if (!envio.ok) {
          toast.error(envio.error);
          continue;
        }

        /* A peça só nasce DEPOIS do primeiro upload dar certo. Criar
           antes deixaria uma pauta órfã com nome de arquivo toda vez que
           o Storage recusasse. */
        if (!postId) {
          const nome = nomeDaPauta(arquivo.name);
          const criada = await criarPauta({
            clientId,
            dia,
            title: nome,
            format: arquivo.type.startsWith("video/")
              ? "video_vertical"
              : "imagem",
          });
          if (!criada.ok) {
            toast.error(criada.error);
            return;
          }
          postId = criada.dados.postId;
        }

        const anexo = await anexarArte({ postId, arte: envio.dados.caminho });
        if (!anexo.ok) {
          toast.error(anexo.error);
          return;
        }
      }

      toast.success(
        arquivos.length === 1
          ? "Arte anexada."
          : `${arquivos.length} artes anexadas.`,
      );
      router.refresh();
    } catch {
      toast.error("Não deu para enviar a arte. Verifique a conexão.");
    } finally {
      marcarEnvio(chave, false);
    }
  }

  function soltarEm(
    e: React.DragEvent,
    clientId: string,
    dia: string,
  ) {
    /* Cancela o comportamento padrão ANTES de qualquer decisão. Sem isto
       o navegador ABRE o arquivo solto e tira a pessoa do painel no meio
       do planejamento — que é o que acontecia aqui. */
    e.preventDefault();
    setArrastando(null);
    setAlvo(null);

    const arquivos = Array.from(e.dataTransfer.files ?? []);
    if (arquivos.length > 0) {
      const doDia = grade.get(clientId)?.get(dia) ?? [];
      void soltarArquivos(arquivos, clientId, dia, { doDia }, `${clientId}|${dia}`);
      return;
    }

    /* A identidade vem do EVENTO, nunca do estado — ver o comentário de
       `MIME_PECA`. */
    const postId = e.dataTransfer.getData(MIME_PECA);
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const mesmoDia = post.scheduled_at
      ? dataNoBrasil(post.scheduled_at) === dia
      : false;
    if (mesmoDia && post.client_id === clientId) return;

    const trocaCliente = post.client_id !== clientId;

    /* A ARTE MORA NUMA PASTA POR CLIENTE, e o primeiro trecho do caminho
       é o que a policy do bucket compara. Mudar o dono da peça sem mover
       o arquivo deixaria a arte na pasta do cliente antigo — visível
       para quem enxerga os dois, e um quadrado vazio para o cliente que
       passou a ser o dono. Recusar é melhor do que quebrar em silêncio. */
    if (trocaCliente && post.media_urls.length > 0) {
      toast.error(
        "Esta peça já tem arte anexada, e a arte fica na pasta do cliente atual. Mova o dia dentro da mesma linha, ou troque o cliente pelo compositor.",
      );
      return;
    }

    const destino = clients.find((c) => c.id === clientId);

    moverPauta({
      postId: post.id,
      clientId: trocaCliente ? clientId : undefined,
      dia,
    })
      .then((r) => {
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(
          trocaCliente
            ? `“${post.title}” foi para ${destino?.name ?? "outro cliente"}, ${rotuloDoDia(dia)}.`
            : `“${post.title}” movida para ${rotuloDoDia(dia)}.`,
        );
        router.refresh();
      })
      /* Server Action é fetch: uma conexão que oscila REJEITA a promise.
         Sem este `catch` a rejeição sumia sem aviso — a peça não se
         movia e a tela não dizia nada. */
      .catch(() => {
        toast.error("Não deu para mover a peça. Verifique a conexão.");
      });
  }

  return (
    <section className="flex flex-col gap-4">
      {/* ---------------------------- Topo ---------------------------- */}
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => setAncora((a) => deslocarSemana(a, -1))}
            aria-label="Semana anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-44 text-center text-sm font-semibold">
            {rotuloDaSemana(dias)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => setAncora((a) => deslocarSemana(a, 1))}
            aria-label="Próxima semana"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {!semanaAtual && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setAncora(hojeISO)}
          >
            Esta semana
          </Button>
        )}

        <Button
          variant={programacao.length > 0 ? "outline" : "default"}
          size="sm"
          className="h-8"
          onClick={() => setProgramando(true)}
        >
          <CalendarSync className="size-4" />
          <span className="hidden sm:inline">Programação semanal</span>
          <span className="sm:hidden">Grade</span>
          {programacao.length > 0 && (
            <span className="tabular-nums text-2xs text-muted-foreground">
              {programacao.length}/sem
            </span>
          )}
        </Button>

        {/* `hidden lg:flex`: a caixinha só existe para esconder linha
            vazia, e no celular não há linha nenhuma — a lista é por dia.
            Deixá-la visível lá fazia o único efeito perceptível ser o
            número do resumo mudar, sem nada mudar na lista. */}
        <label className="ml-auto hidden cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground lg:flex">
          <input
            type="checkbox"
            checked={soComPauta}
            onChange={(e) => setSoComPauta(e.target.checked)}
            className="size-3.5 accent-[var(--signal)]"
          />
          Só com pauta
        </label>
      </header>

      <ProgramacaoDialog
        aberto={programando}
        onAbertoChange={setProgramando}
        programacao={programacao}
        clients={todosOsClientes}
        semanaVisivel={ancora}
      />

      {/* --------------------------- Resumo --------------------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs">
        <Marcador
          className={PRODUCAO.a_produzir.dot}
          label="a produzir"
          valor={resumo.aProduzir}
          destaque={resumo.aProduzir > 0}
        />
        <Marcador
          className={PRODUCAO.arte_pronta.dot}
          label="arte pronta"
          valor={resumo.artePronta}
        />
        <Marcador
          className={PRODUCAO.aprovada.dot}
          label="aprovadas"
          valor={resumo.aprovadas}
        />
        <Marcador
          className={PRODUCAO.no_ar.dot}
          label="no ar"
          valor={resumo.noAr}
        />
        <span className="text-muted-foreground">
          {resumo.clientesSemPauta === 0
            ? "todos os clientes com pauta"
            : `${resumo.clientesSemPauta} ${resumo.clientesSemPauta === 1 ? "cliente sem" : "clientes sem"} pauta`}
        </span>
      </div>

      {recorteParcial && (
        <p className="rounded-md bg-warning-muted px-3 py-2 text-2xs text-warning">
          Há um filtro ligado, então as células mostram só parte da pauta —
          aqui a linha vazia quer dizer “nada nesta situação”, não “nada para
          produzir”. Os números acima continuam contando a semana inteira.
        </p>
      )}

      {/* ----------------------- Pauta sem data -----------------------
          Espelha a bandeja do calendário do mês, e virou obrigatória
          quando a Pauta passou a ser a visão que abre: peça "aprovada,
          sem data" é justamente uma das que o cartão do topo marca como
          exigindo ação, e ela não aparecia em lugar nenhum da primeira
          tela do módulo. Arrastar daqui para uma célula marca o dia. */}
      {semData.length > 0 && (
        <section className="surface-card flex flex-col gap-2 p-3">
          <h3 className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <CalendarClock className="size-3.5" />
            {semData.length} sem dia marcado
            <span className="hidden font-normal lg:inline">
              — arraste para uma célula
            </span>
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {semData.map((post) => (
              <li key={post.id} className="max-w-56">
                <ChipDaPauta
                  post={post}
                  capa={previas[post.media_urls[0] ?? ""]}
                  onAbrir={() => onAbrirPost(post)}
                  onArrastar={() => setArrastando(post.id)}
                  onFimArrasto={() => setArrastando(null)}
                  arrastando={arrastando === post.id}
                  mostrarCliente
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------ Grade (desktop) ---------------------
          `lg`, pelo mesmo motivo do calendário do mês: abaixo de 1024px
          a coluna do cliente e sete colunas de dia não convivem. */}
      <div className="surface-card hidden overflow-hidden lg:block">
        {/* A ALTURA MÁXIMA É O QUE FAZ O CABEÇALHO GRUDAR, e demorei a
            entender por quê. `overflow-x-auto` computa `overflow-y:auto`
            junto, então esta caixa já era o scrollport do eixo Y — mas
            sem altura limitada ela nunca rolava, quem rolava era a
            página, e o `sticky top-0` se resolvia contra um contêiner
            parado. Medido com 61 clientes: 49px por linha, 2989px de
            grade, e a partir da quinta linha eram sete colunas idênticas
            sem rótulo. Numa grade cliente × dia, perder o nome do dia é
            perder metade da coordenada. */}
        <div className="max-h-[calc(100dvh-11rem)] overflow-auto">
          <div className="min-w-[60rem]">
            <div className="sticky top-0 z-30 grid grid-cols-[11rem_repeat(7,minmax(0,1fr))] border-b border-hairline bg-surface-2">
              <span className="sticky left-0 z-40 bg-surface-2 px-3 py-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Cliente
              </span>
              {dias.map((iso) => {
                const { semana, dia } = rotuloDaColuna(iso);
                const ehHoje = iso === hojeISO;
                return (
                  <span
                    key={iso}
                    className={cn(
                      "px-2 py-2 text-center text-2xs",
                      ehHoje ? "font-semibold text-signal" : "text-muted-foreground",
                    )}
                  >
                    {semana} <span className="tabular-nums">{dia}</span>
                  </span>
                );
              })}
            </div>

            {linhas.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {soComPauta
                  ? "Nenhum cliente tem peça nesta semana."
                  : "Nenhum cliente no recorte atual."}
              </p>
            ) : (
              linhas.map((client) => {
                const porDia = grade.get(client.id);
                const naSemana = dias.reduce(
                  (n, d) => n + (porDia?.get(d)?.length ?? 0),
                  0,
                );

                return (
                  <div
                    key={client.id}
                    className="grid grid-cols-[11rem_repeat(7,minmax(0,1fr))] border-b border-hairline last:border-b-0"
                  >
                    <div
                      className={cn(
                        "sticky left-0 z-10 flex items-center gap-2 border-r border-hairline bg-surface px-3 py-2",
                        naSemana === 0 && "opacity-60",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          background:
                            client.brand_primary || "var(--muted-foreground)",
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {client.name}
                      </span>
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                        {naSemana || "—"}
                      </span>
                    </div>

                    {dias.map((iso) => {
                      const chave = `${client.id}|${iso}`;
                      const doDia = porDia?.get(iso) ?? [];
                      const passou = iso < hojeISO;

                      return (
                        <div
                          key={iso}
                          onDragOver={(e) => {
                            /* Duas coisas, e só elas: uma peça nossa ou
                               um arquivo. Antes daqui era
                               `preventDefault()` incondicional, e a
                               célula aceitava texto de qualquer lugar
                               como se fosse peça. */
                            const t = e.dataTransfer.types;
                            if (!t.includes(MIME_PECA) && !t.includes("Files")) {
                              return;
                            }
                            e.preventDefault();
                            setAlvo(chave);
                          }}
                          onDragLeave={() =>
                            setAlvo((a) => (a === chave ? null : a))
                          }
                          onDrop={(e) => soltarEm(e, client.id, iso)}
                          className={cn(
                            "group/celula relative min-h-12 border-r border-hairline p-1 last:border-r-0",
                            iso === hojeISO && "bg-signal-muted/15",
                            passou && "bg-surface-2/25",
                            alvo === chave &&
                              "bg-accent ring-1 ring-inset ring-signal",
                          )}
                        >
                          <div className="flex flex-col gap-0.5">
                            {doDia.map((post) => (
                              <ChipDaPauta
                                key={post.id}
                                post={post}
                                capa={previas[post.media_urls[0] ?? ""]}
                                onAbrir={() => onAbrirPost(post)}
                                onArrastar={() => setArrastando(post.id)}
                                onFimArrasto={() => setArrastando(null)}
                                arrastando={arrastando === post.id}
                                enviando={enviandoEm.has(post.id)}
                                onSoltarArquivos={(arquivos) =>
                                  void soltarArquivos(
                                    arquivos,
                                    client.id,
                                    iso,
                                    { postId: post.id },
                                    post.id,
                                  )
                                }
                              />
                            ))}
                          </div>

                          {enviandoEm.has(chave) && (
                            <p className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                              <Loader2 className="size-2.5 animate-spin" />
                              enviando…
                            </p>
                          )}

                          <PautaRapida
                            aberto={criandoEm === chave}
                            onAbertoChange={(v) => setCriandoEm(v ? chave : null)}
                            client={client}
                            dia={iso}
                            vazia={doDia.length === 0}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ------------------------- Lista (celular) --------------------
          A grade não cabe e não adianta encolher: 375px divididos por
          oito colunas dão 46px, onde não entra nem o nome do cliente. No
          celular a pergunta também muda — quem abre o telefone quer
          saber o que sai HOJE, não como está a semana toda. Então vira
          uma lista por dia, com os sete dias à mostra: o dia vazio
          continua sendo a informação, do mesmo jeito que a linha vazia é
          na grade. */}
      <div className="flex flex-col gap-2.5 lg:hidden">
        {dias.map((iso) => {
          const doDia = posts
            .filter((p) => p.scheduled_at && dataNoBrasil(p.scheduled_at) === iso)
            .sort((a, b) =>
              (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
            );
          const ehHoje = iso === hojeISO;

          return (
            <section key={iso} className="surface-card overflow-hidden">
              <header
                className={cn(
                  "flex items-center justify-between border-b border-hairline px-3 py-2",
                  ehHoje && "bg-signal-muted/25",
                )}
              >
                <span className="text-xs font-semibold">
                  {ehHoje ? "Hoje — " : ""}
                  {rotuloDoDia(iso)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground">
                    {doDia.length === 0
                      ? "sem pauta"
                      : `${doDia.length} ${doDia.length === 1 ? "peça" : "peças"}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNovoNoDia(iso)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
                    aria-label={`Nova peça em ${rotuloDoDia(iso)}`}
                  >
                    <Plus className="size-4" />
                  </button>
                </span>
              </header>

              {doDia.length > 0 && (
                <ul className="divide-y divide-hairline">
                  {doDia.map((post) => {
                    const p = PRODUCAO[producaoDoPost(post)];
                    const Icone = ICONE_FORMATO[post.format] ?? ImageIcon;
                    const capa = previas[post.media_urls[0] ?? ""];

                    return (
                      <li key={post.id}>
                        <button
                          type="button"
                          onClick={() => onAbrirPost(post)}
                          className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                        >
                          {capa ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={capa}
                              alt=""
                              className="mt-0.5 size-8 shrink-0 rounded object-cover ring-1 ring-hairline"
                            />
                          ) : (
                            <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1">
                            {/* `block` junto do `truncate`: sem ele o span
                                continua inline, `text-overflow` não se
                                aplica e o título passa por cima da hora.
                                Visto com "LinkedIn — o que mudou no CAC
                                de infoproduto". */}
                            <span className="block truncate text-xs font-medium">
                              {post.title}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="truncate text-2xs text-muted-foreground">
                                {post.client?.name}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-px text-[10px] ring-1",
                                  p.chip,
                                )}
                              >
                                {p.curto}
                              </span>
                              {post.media_urls.length > 0 && (
                                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <Paperclip className="size-3" />
                                  {post.media_urls.length}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                            {horaDoPost(post.scheduled_at)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Nome de pauta a partir do nome do arquivo solto.
 *
 * "reels-dia-dos-pais-final-v3.mp4" vira "Reels dia dos pais final v3".
 * Não é adivinhação bonita: é melhor do que "Nova peça" e melhor do que
 * o nome cru com extensão, e quem soltou pode reescrever em um clique.
 */
function nomeDaPauta(nomeDoArquivo: string): string {
  const semExtensao = nomeDoArquivo.replace(/\.[a-z0-9]{1,5}$/i, "");
  const limpo = semExtensao.replace(/[-_]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!limpo) return "Arte sem nome";
  return (limpo.charAt(0).toUpperCase() + limpo.slice(1)).slice(0, 200);
}

/* ------------------------------------------------------------------ */

function Marcador({
  className,
  label,
  valor,
  destaque,
}: {
  className: string;
  label: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5",
        destaque ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("size-2 rounded-full", className)} />
      <span className="tabular-nums">{valor}</span> {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function ChipDaPauta({
  post,
  capa,
  onAbrir,
  onArrastar,
  onFimArrasto,
  arrastando,
  mostrarCliente,
  enviando,
  onSoltarArquivos,
}: {
  post: SocialPostWithRelations;
  /** URL assinada da primeira arte, quando houver. */
  capa?: string;
  onAbrir: () => void;
  onArrastar: () => void;
  onFimArrasto: () => void;
  arrastando: boolean;
  /** Na bandeja "sem data" o cliente não vem da linha, então vai no chip. */
  mostrarCliente?: boolean;
  enviando?: boolean;
  /** Soltar arquivo EM CIMA da peça: o alvo mais explícito que existe. */
  onSoltarArquivos?: (arquivos: File[]) => void;
}) {
  const estado = producaoDoPost(post);
  const p = PRODUCAO[estado];
  const Icone = ICONE_FORMATO[post.format] ?? ImageIcon;

  const quando = post.scheduled_at
    ? `${rotuloDoDia(dataNoBrasil(post.scheduled_at))}, ${horaDoPost(post.scheduled_at)}`
    : "sem dia marcado";

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_PECA, post.id);
        /* `text/plain` junto: o Firefox só inicia o arrasto com o data
           store povoado num tipo que ele reconhece. Quem decide o que a
           célula aceita é o tipo próprio, acima. */
        e.dataTransfer.setData("text/plain", post.title);
        e.dataTransfer.effectAllowed = "move";
        onArrastar();
      }}
      onDragEnd={onFimArrasto}
      onDragOver={(e) => {
        if (!onSoltarArquivos || !e.dataTransfer.types.includes("Files")) return;
        /* `stopPropagation` para a célula não reivindicar o mesmo drop:
           soltar em cima de uma peça quer dizer AQUELA peça, e deixar os
           dois handlers rodarem faria a dedução da célula sobrescrever a
           escolha explícita de quem soltou. */
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        if (!onSoltarArquivos) return;
        const arquivos = Array.from(e.dataTransfer.files ?? []);
        if (arquivos.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onSoltarArquivos(arquivos);
      }}
      onClick={onAbrir}
      /* O `aria-label` carrega a coordenada inteira. A grade é visual: o
         leitor de tela não enxerga que este chip está na linha do Brazzo
         e na coluna de quarta, e "Reels — massa" sozinho não localiza
         nada. */
      aria-label={`${post.title} · ${post.client?.name ?? "cliente"} · ${quando} · ${p.label}`}
      title={`${post.title} · ${FORMATO_LABEL.get(post.format) ?? post.format} · ${p.label}${post.media_urls.length ? ` · ${post.media_urls.length} arte(s)` : ""}`}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-accent",
        arrastando && "opacity-40",
        estado === "arquivada" && "opacity-50 line-through",
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", p.dot)} />
      {enviando ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-signal" />
      ) : capa ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={capa}
          alt=""
          className="size-4 shrink-0 rounded-[2px] object-cover"
        />
      ) : (
        <Icone className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {mostrarCliente && post.client?.name ? (
          <span className="text-muted-foreground">{post.client.name} · </span>
        ) : null}
        {post.title}
      </span>
      {!capa && post.media_urls.length > 0 && (
        <Paperclip className="size-2.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Pauta em uma linha, num popover ancorado na célula.
 *
 * O compositor completo é o caminho errado para encher um mês: ele pede
 * cliente, redes, legenda e formato antes de aceitar a primeira peça, e
 * quem está planejando trinta pautas de dez clientes desiste na quarta.
 * Aqui o cliente e o dia já vêm da célula; sobra o nome.
 *
 * POR QUE POPOVER E NÃO UM CAMPO DENTRO DA CÉLULA — que foi a primeira
 * tentativa. Medido a 1440px: a coluna do dia dá 112px, e o formulário
 * precisava de campo, quatro botões de formato e um "Salvar" naquilo. O
 * "Salvar" saía por cima dos ícones. O popover sai do portal, então não
 * é a largura da célula que manda, e ainda sobra espaço para escrever de
 * quem e de que dia é a pauta — que é a informação que se perde assim
 * que o formulário deixa de estar dentro da célula.
 *
 * NÃO FECHA AO SALVAR. Limpa o campo e mantém o foco, porque a próxima
 * coisa que a pessoa faz depois de escrever "Reels — bastidores" quase
 * sempre é escrever a segunda pauta do mesmo dia.
 */
function PautaRapida({
  aberto,
  onAbertoChange,
  client,
  dia,
  vazia,
}: {
  aberto: boolean;
  onAbertoChange: (v: boolean) => void;
  client: Client;
  dia: string;
  /** Célula sem peça: o alvo do clique vira a célula inteira. */
  vazia: boolean;
}) {
  const [titulo, setTitulo] = useState("");
  const [link, setLink] = useState("");
  const [formato, setFormato] = useState<SocialFormat>("video_vertical");
  const [criadas, setCriadas] = useState(0);
  const [salvando, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function salvar() {
    const nome = titulo.trim();
    if (!nome) return;

    iniciar(async () => {
      let r;
      try {
        r = await criarPauta({
          clientId: client.id,
          dia,
          title: nome,
          format: formato,
          mediaUrl: link.trim() || undefined,
        });
      } catch {
        /* Server Action é fetch, e a rejeição de rede acontece DENTRO da
           transition — o React a propaga para o error boundary do (app)
           em vez de virar um `r.ok === false`. Sem este `catch`, um 4G
           que oscilasse trocava a grade inteira, a semana em que a
           pessoa estava e os filtros por "Alguma coisa quebrou nesta
           tela". Medido: interceptando o fetch da action, zero toasts e
           a página inteira substituída pelo boundary.

           O texto digitado não é limpo aqui, então basta reenviar. */
        toast.error("Não deu para salvar agora. Verifique a conexão.");
        return;
      }

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setTitulo("");
      setLink("");
      setCriadas((n) => n + 1);
      campo.current?.focus();
      router.refresh();
    });
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        onAbertoChange(v);
        if (!v) {
          setTitulo("");
          setLink("");
          setCriadas(0);
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Nova pauta para ${client.name} em ${rotuloDoDia(dia)}`}
            title={`Nova pauta · ${client.name} · ${rotuloDoDia(dia)}`}
            /* Invisível até o hover — um "+" visível em 7 colunas × 61
               linhas são 427 botões, e a grade viraria um painel de
               controle. Mas invisível E alcançável por Tab são 427
               paradas cegas, então o foco de teclado o revela como o
               mouse revela: `focus-visible` acende o mesmo estado que o
               hover acende. */
            className={cn(
              "flex w-full items-center justify-center rounded py-0.5 text-muted-foreground/0 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:text-signal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal group-hover/celula:text-muted-foreground data-[popup-open]:text-signal",
              vazia && "absolute inset-1",
            )}
          >
            <Plus className="size-3.5" />
          </button>
        }
      />

      {/* `initialFocus` no CAMPO, não no popup. O padrão do Base UI é
          focar a própria caixa, e o `autoFocus` do React perde a disputa:
          medido, `document.activeElement` era a `div` do popup e o que se
          digitava não chegava a lugar nenhum. */}
      <PopoverContent
        align="start"
        initialFocus={campo}
        className="w-64 gap-2 p-3"
      >
        {/* De quem e de que dia. Dentro da célula isso era óbvio pela
            posição; fora dela, some — e criar a pauta no cliente errado é
            um erro que só aparece dias depois. */}
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: client.brand_primary || "var(--muted-foreground)" }}
          />
          <span className="min-w-0 truncate font-medium text-foreground">
            {client.name}
          </span>
          <span className="shrink-0">· {rotuloDoDia(dia)}</span>
        </p>

        <input
          ref={campo}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salvar();
            }
          }}
          placeholder="Reels — bastidores da massa"
          disabled={salvando}
          className="h-8 w-full rounded-md bg-surface-2 px-2 text-xs outline-none ring-1 ring-hairline focus:ring-signal/60"
        />

        {/* O link já na criação, porque muita arte nasce no Drive e o
            que trava a semana é não saber ONDE ela está. Arquivo continua
            subindo pelo compositor, que tem barra de progresso e
            miniatura — coisas que não cabem aqui. */}
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salvar();
            }
          }}
          placeholder="Link da arte (opcional)"
          disabled={salvando}
          className="h-7 w-full rounded-md bg-surface-2 px-2 text-[11px] outline-none ring-1 ring-hairline focus:ring-signal/60"
        />

        <div className="grid grid-cols-4 gap-1">
          {ATALHOS.map((f) => {
            const Icone = ICONE_FORMATO[f] ?? ImageIcon;
            return (
              <button
                key={f}
                type="button"
                /* `onMouseDown` com `preventDefault`: um clique comum
                   tiraria o foco do campo, e voltar a digitar exigiria
                   clicar nele de novo a cada troca de formato. */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setFormato(f)}
                aria-pressed={formato === f}
                title={FORMATO_LABEL.get(f)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded py-1 text-[9px] transition-colors",
                  formato === f
                    ? "bg-signal text-white"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icone className="size-3.5" />
                {ROTULO_CURTO[f]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {criadas === 0
              ? "Enter salva e continua"
              : `${criadas} ${criadas === 1 ? "pauta criada" : "pautas criadas"}`}
          </span>
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={salvar}
            disabled={salvando || titulo.trim() === ""}
          >
            {salvando ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            Adicionar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
