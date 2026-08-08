"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type OnConnect,
} from "@xyflow/react";
import { Blocks, Play, Rocket, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import "@xyflow/react/dist/style.css";

import { NODE_TYPES, type NoDoFluxo } from "./flow-nodes";
import {
  BLOCK_BY_ID,
  BLOCK_TYPES,
  KIND_LABELS,
  KIND_STYLES,
  type BlockKind,
  type BlockType,
  type DadosDoNo,
} from "./blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CONSULTA_DESKTOP, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/* =====================================================================
   EloChat — construtor de fluxo
   ---------------------------------------------------------------------
   ⚠️ ESTA TELA NÃO DISPARA NADA. É o construtor, não o motor: não há
   tabela, não há publicação e "Testar fluxo" não manda mensagem para
   ninguém. O sistema já tem envio de WhatsApp em `/api/whatsapp/send`,
   e ligar os dois é um projeto próprio — persistência do fluxo, fila de
   execução, estado por contato e janela de 24h da Meta.

   Está escrito aqui em cima para que ninguém descubra isso em produção,
   com um cliente esperando a automação rodar.

   POR QUE REACT FLOW E NÃO CSS. Um canvas de verdade precisa de pan,
   zoom, arraste de nó e aresta que se recalcula sozinha. Feito à mão com
   flexbox, tudo isso vira posição fixa — e a diferença entre uma
   ferramenta e a imagem de uma ferramenta aparece no primeiro arraste.
   ===================================================================== */

const POSICAO_INICIAL: NoDoFluxo[] = [
  {
    id: "gatilho",
    type: "elo",
    position: { x: 0, y: 0 },
    data: {
      blockId: "keyword",
      titulo: 'Palavra-chave "Promoção"',
      texto: "Dispara quando alguém manda PROMOÇÃO no direct do Instagram.",
      botoes: [],
    },
  },
  {
    id: "mensagem",
    type: "elo",
    position: { x: 0, y: 190 },
    data: {
      blockId: "message",
      titulo: "Boas-vindas",
      texto:
        "Olá! Aqui está o seu desconto de 15% — é só usar o cupom ELO15 no carrinho. Posso ajudar em mais alguma coisa?",
      botoes: [
        { id: "comprar", label: "Quero comprar" },
        { id: "atendente", label: "Falar com atendente" },
      ],
    },
  },
  {
    id: "checkout",
    type: "elo",
    position: { x: 340, y: 150 },
    data: {
      blockId: "media",
      titulo: "Enviar catálogo",
      texto: "Manda o PDF com os produtos em promoção.",
      botoes: [],
    },
  },
  {
    id: "humano",
    type: "elo",
    position: { x: 340, y: 330 },
    data: {
      blockId: "delay",
      titulo: "Passar para humano",
      texto: "Aguarda 1 minuto e avisa a equipe no grupo de atendimento.",
      botoes: [],
    },
  },
];

const ARESTAS_INICIAIS: Edge[] = [
  { id: "e1", source: "gatilho", target: "mensagem", animated: true },
  {
    id: "e2",
    source: "mensagem",
    sourceHandle: "comprar",
    target: "checkout",
    animated: true,
  },
  {
    id: "e3",
    source: "mensagem",
    sourceHandle: "atendente",
    target: "humano",
    animated: true,
  },
];

export function FlowBuilder() {
  const [nodes, setNodes, onNodesChange] = useNodesState(POSICAO_INICIAL);
  const [edges, setEdges, onEdgesChange] = useEdgesState(ARESTAS_INICIAIS);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const desktop = useMediaQuery(CONSULTA_DESKTOP);

  const noAtual = useMemo(
    () => nodes.find((n) => n.id === selecionado) ?? null,
    [nodes, selecionado],
  );

  const onConnect: OnConnect = useCallback(
    (conexao: Connection) =>
      setEdges((atuais) => addEdge({ ...conexao, animated: true }, atuais)),
    [setEdges],
  );

  /** Adiciona um bloco no meio da tela, já selecionado para edição. */
  const adicionar = useCallback(
    (bloco: BlockType) => {
      const id = `${bloco.id}-${Date.now()}`;
      setNodes((atuais) => [
        ...atuais,
        {
          id,
          type: "elo",
          position: {
            /* Deslocado a cada inserção para dois blocos seguidos não
               nascerem exatamente um sobre o outro. */
            x: 120 + (atuais.length % 4) * 36,
            y: 120 + (atuais.length % 4) * 36,
          },
          data: {
            blockId: bloco.id,
            titulo: bloco.label,
            texto: "",
            botoes: [],
          },
        },
      ]);
      setSelecionado(id);
      setPaletaAberta(false);
    },
    [setNodes],
  );

  /** Aplica uma alteração parcial ao nó selecionado. */
  const editar = useCallback(
    (patch: Partial<DadosDoNo>) => {
      if (!selecionado) return;
      setNodes((atuais) =>
        atuais.map((n) =>
          n.id === selecionado ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      );
    },
    [selecionado, setNodes],
  );

  const remover = useCallback(() => {
    if (!selecionado) return;
    setNodes((atuais) => atuais.filter((n) => n.id !== selecionado));
    /* As arestas do nó removido têm de ir junto, senão o React Flow
       mantém uma ligação para um id que não existe mais e a aresta
       fica pendurada no vazio. */
    setEdges((atuais) =>
      atuais.filter((e) => e.source !== selecionado && e.target !== selecionado),
    );
    setSelecionado(null);
  }, [selecionado, setNodes, setEdges]);

  return (
    <div className="flex h-[calc(100dvh-4rem-56px-env(safe-area-inset-bottom))] flex-col md:h-[calc(100dvh-4rem)]">
      <Cabecalho nos={nodes.length} />

      <div className="flex min-h-0 flex-1">
        {/* --------------------- Paleta (desktop) ------------------- */}
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-hairline bg-surface p-3 lg:block">
          <Paleta onAdicionar={adicionar} />
        </aside>

        {/* --------------------------- Canvas ----------------------- */}
        <div className="elochat-canvas relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, no) => setSelecionado(no.id)}
            /* Clicar no vazio fecha o editor: sem isto o painel da
               direita fica preso no último nó e some a impressão de que
               ele reflete a seleção. */
            onPaneClick={() => setSelecionado(null)}
            fitView
            /* `maxZoom: 1` porque o fluxo de exemplo é pequeno e o
               `fitView` sozinho amplia até preencher — em tela grande os
               cards apareciam inflados, com fonte maior que a do resto
               do sistema. O piso de zoom nunca passa do tamanho real. */
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            proOptions={{ hideAttribution: false }}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>

          {/* Botão da paleta no mobile, onde a coluna da esquerda não
              cabe. Fica sobre o canvas, no canto oposto aos controles. */}
          <Button
            size="sm"
            className="absolute right-3 top-3 shadow-lg lg:hidden"
            onClick={() => setPaletaAberta(true)}
          >
            <Blocks className="size-4" />
            Blocos
          </Button>
        </div>

        {/* -------------------- Editor (desktop) -------------------- */}
        {noAtual && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-hairline bg-surface lg:block">
            <Editor
              no={noAtual}
              onEditar={editar}
              onRemover={remover}
              onFechar={() => setSelecionado(null)}
            />
          </aside>
        )}
      </div>

      {/* ---------------- Painéis em gaveta (mobile) ----------------
          NÃO MONTADOS NO DESKTOP, e isso é obrigatório: `lg:hidden` no
          conteúdo esconde a gaveta mas mantém o Root vivo, com trava de
          foco e detecção de clique fora. Com um nó selecionado existia
          aqui uma gaveta invisível aberta, e o primeiro clique em
          qualquer lugar — inclusive no painel da direita — contava como
          clique fora e limpava a seleção. Ver `useMediaQuery`. */}
      {!desktop && (
        <>
          <Sheet open={paletaAberta} onOpenChange={setPaletaAberta}>
            <SheetContent side="left" className="w-[280px] p-0">
              <SheetHeader className="border-b border-hairline">
                <SheetTitle>Blocos</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto p-3">
                <Paleta onAdicionar={adicionar} />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet
            open={Boolean(noAtual)}
            onOpenChange={(v) => !v && setSelecionado(null)}
          >
            <SheetContent side="right" className="w-[320px] p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Editar bloco</SheetTitle>
              </SheetHeader>
              {noAtual && (
                <div className="overflow-y-auto">
                  <Editor
                    no={noAtual}
                    onEditar={editar}
                    onRemover={remover}
                    onFechar={() => setSelecionado(null)}
                  />
                </div>
              )}
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cabeçalho                                                           */
/* ------------------------------------------------------------------ */

function Cabecalho({ nos }: { nos: number }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold tracking-[-0.01em]">EloChat</h1>
          <span className="rounded-full bg-warning-muted px-2 py-0.5 text-[10px] font-medium text-warning">
            Prévia
          </span>
        </div>
        <p className="truncate text-2xs text-muted-foreground">
          Boas-vindas — WhatsApp · {nos} {nos === 1 ? "bloco" : "blocos"}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* O acesso à paleta no mobile é o botão flutuante sobre o
            canvas, não mais um ícone aqui: dois caminhos para a mesma
            gaveta empurravam o cabeçalho para duas linhas no celular e
            comiam altura do canvas, que é o que a tela existe para
            mostrar. O flutuante ainda ganha por ficar ao alcance do
            polegar. */}
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() =>
            toast.info("Ainda não existe motor de execução.", {
              description:
                "O construtor desenha o fluxo; publicar e disparar são a próxima etapa.",
            })
          }
        >
          <Play className="size-3.5" />
          Testar fluxo
        </Button>

        <Button
          size="sm"
          className="h-8"
          onClick={() =>
            toast.info("Publicação ainda não implementada.", {
              description:
                "O fluxo vive só nesta aba — recarregar a página devolve o exemplo inicial.",
            })
          }
        >
          <Rocket className="size-3.5" />
          Publicar
        </Button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Paleta                                                              */
/* ------------------------------------------------------------------ */

function Paleta({ onAdicionar }: { onAdicionar: (b: BlockType) => void }) {
  const familias: BlockKind[] = ["trigger", "action", "logic"];

  return (
    <div className="flex flex-col gap-4">
      {familias.map((kind) => (
        <div key={kind}>
          <span className="mb-1.5 block px-1 eyebrow">{KIND_LABELS[kind]}</span>

          <div className="flex flex-col gap-1">
            {BLOCK_TYPES.filter((b) => b.kind === kind).map((bloco) => {
              const estilo = KIND_STYLES[bloco.kind];
              return (
                /* CLIQUE, não arrastar. Arrastar é o gesto que se espera
                   de um construtor, mas sozinho ele não existe no toque
                   nem no teclado — e um bloco que só entra arrastando é
                   um bloco que parte dos usuários não consegue inserir.
                   O arraste entra depois, como atalho, não como o único
                   caminho. */
                <button
                  key={bloco.id}
                  type="button"
                  onClick={() => onAdicionar(bloco)}
                  className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "mt-px flex size-6 shrink-0 items-center justify-center rounded-md",
                      estilo.chip,
                    )}
                  >
                    <bloco.icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {bloco.label}
                    </span>
                    <span className="block text-[10px] leading-tight text-muted-foreground">
                      {bloco.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor do bloco                                                     */
/* ------------------------------------------------------------------ */

function Editor({
  no,
  onEditar,
  onRemover,
  onFechar,
}: {
  no: NoDoFluxo;
  onEditar: (patch: Partial<DadosDoNo>) => void;
  onRemover: () => void;
  onFechar: () => void;
}) {
  const bloco = BLOCK_BY_ID.get(no.data.blockId);
  const estilo = KIND_STYLES[bloco?.kind ?? "action"];

  /* Botão só faz sentido em bloco de mensagem: pendurar resposta rápida
     num "Atraso" criaria uma saída que o motor não saberia percorrer. */
  const aceitaBotoes = no.data.blockId === "message";

  function editarBotao(id: string, label: string) {
    onEditar({
      botoes: no.data.botoes.map((b) => (b.id === id ? { ...b, label } : b)),
    });
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            estilo.chip,
          )}
        >
          {bloco?.icon && <bloco.icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{bloco?.label}</p>
          <p className="text-2xs text-muted-foreground">Editando o bloco</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar editor"
          onClick={onFechar}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="no-titulo">Nome do passo</Label>
          <Input
            id="no-titulo"
            value={no.data.titulo}
            onChange={(e) => onEditar({ titulo: e.target.value })}
            maxLength={60}
          />
          <p className="text-2xs text-muted-foreground">
            Só aparece para a equipe, não para o contato.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="no-texto">
            {aceitaBotoes ? "Mensagem" : "Descrição"}
          </Label>
          <Textarea
            id="no-texto"
            value={no.data.texto}
            onChange={(e) => onEditar({ texto: e.target.value })}
            rows={5}
            maxLength={1000}
            placeholder={
              aceitaBotoes
                ? "Olá! Aqui está o seu desconto…"
                : "O que este passo faz"
            }
          />
          {aceitaBotoes && (
            <p className="text-2xs tabular-nums text-muted-foreground">
              {no.data.texto.length} de 1000 caracteres
            </p>
          )}
        </div>

        {aceitaBotoes && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label>Botões de resposta</Label>
              <span className="text-2xs tabular-nums text-muted-foreground">
                {no.data.botoes.length} de 3
              </span>
            </div>

            <p className="text-2xs text-muted-foreground">
              Cada botão vira uma saída do bloco no canvas — é por eles que
              o fluxo se divide.
            </p>

            {no.data.botoes.map((botao) => (
              <div key={botao.id} className="flex items-center gap-1.5">
                <Input
                  value={botao.label}
                  onChange={(e) => editarBotao(botao.id, e.target.value)}
                  maxLength={20}
                  className="h-8 text-xs"
                  aria-label={`Texto do botão ${botao.label}`}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remover botão ${botao.label}`}
                  onClick={() =>
                    onEditar({
                      botoes: no.data.botoes.filter((b) => b.id !== botao.id),
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            {/* Três é o teto do WhatsApp para botões de resposta rápida.
                Deixar cadastrar quatro aqui seria construir um fluxo que
                a plataforma recusa na hora de publicar. */}
            {no.data.botoes.length < 3 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() =>
                  onEditar({
                    botoes: [
                      ...no.data.botoes,
                      { id: `b-${Date.now()}`, label: "Novo botão" },
                    ],
                  })
                }
              >
                Adicionar botão
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-hairline p-4">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full text-negative hover:text-negative"
          onClick={onRemover}
        >
          <Trash2 className="size-3.5" />
          Remover bloco
        </Button>
      </div>
    </div>
  );
}
