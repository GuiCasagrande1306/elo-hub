"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  CalendarDays,
  LayoutGrid,
  ListOrdered,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountsPanel } from "./accounts-panel";
import { PautaGrid } from "./pauta-grid";
import { PostComposer } from "./post-composer";
import { PostQueue } from "./post-queue";
import { SocialCalendar } from "./social-calendar";
import { REDES, rede } from "@/lib/social/networks";
import {
  SITUACOES,
  resumirPosts,
  situacaoDoPost,
  type Situacao,
} from "@/lib/social/post-status";
import { useLocalPreference } from "@/lib/use-local-preference";
import { cn } from "@/lib/utils";
import type {
  Client,
  SocialAccount,
  SocialNetwork,
  SocialPostWithRelations,
  SocialRecurrenceWithClient,
} from "@/types/database";

/* =====================================================================
   Área de trabalho de mídias sociais
   ---------------------------------------------------------------------
   Concentra o que é estado de INTERFACE — visão, filtros, peça aberta. O
   dado vem do servidor já filtrado por RLS e as mutações são Server
   Actions; este componente não decide o que alguém pode ver, só desenha
   o que recebeu.

   ARQUIVADOS FICAM DE FORA por padrão, e não há caixinha para ligá-los:
   quem quer vê-los escolhe "Arquivado" no filtro de situação. Uma peça
   cancelada não some do sistema, mas também não pode dividir espaço com
   o que sai esta semana — mesma regra que os clientes encerrados seguem
   em `/clientes`.
   ===================================================================== */

const TODOS = "__todos__";

type Visao = "pauta" | "calendario" | "fila" | "contas";

export function SocialWorkspace({
  posts,
  clients,
  accounts,
  programacao,
  ehAdmin,
}: {
  posts: SocialPostWithRelations[];
  clients: Client[];
  accounts: SocialAccount[];
  /** A grade semanal fixa. Vazia quando ninguém montou ainda. */
  programacao: SocialRecurrenceWithClient[];
  ehAdmin: boolean;
}) {
  /* Abre na PAUTA, não no calendário do mês. A primeira pergunta de quem
     abre esta tela é "o que eu tenho que produzir", e o calendário do
     mês responde outra ("o que sai neste dia") — boa depois que a semana
     está cheia, inútil enquanto ela está vazia. Quem prefere o mês
     escolhe uma vez e a preferência fica. */
  const [visao, setVisao] = useLocalPreference<Visao>(
    "elo:social:visao",
    "pauta",
  );

  const [cliente, setCliente] = useState(TODOS);
  const [redeFiltro, setRedeFiltro] = useState(TODOS);
  const [situacao, setSituacao] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");

  /* "Sem data" é recorte de AGENDA, não de situação: uma peça sem dia
     pode estar em rascunho, em aprovação ou aprovada. Tentar exprimi-lo
     como situação faria o contador dizer 5 e a lista mostrar 2. */
  const [semDataApenas, setSemDataApenas] = useState(false);

  /* `undefined` = fechado. `postId: null` = aberto para peça nova. Um
     booleano separado obrigaria a manter dois estados coerentes, e o
     caso ruim é justamente o meio termo: aberto sem saber se cria ou
     edita.

     ⚠️ GUARDA O ID, NUNCA O OBJETO. Guardando o objeto, o diálogo ficava
     preso ao instantâneo do clique: marcar "publicado" chamava a action,
     o `router.refresh()` trazia o alvo já publicado do servidor — e a
     tela continuava mostrando "pendente", porque o post dentro do estado
     era o de antes. Medido: o registro gravava e a marcação não
     aparecia até recarregar a página na mão. */
  const [editando, setEditando] = useState<
    { postId: string | null; dia?: string } | undefined
  >(undefined);

  const postEmEdicao = editando?.postId
    ? (posts.find((p) => p.id === editando.postId) ?? null)
    : null;

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return posts.filter((post) => {
      const s = situacaoDoPost(post);

      if (situacao === TODOS ? s === "arquivado" : s !== situacao) return false;
      if (semDataApenas && post.scheduled_at) return false;
      if (cliente !== TODOS && post.client_id !== cliente) return false;
      if (
        redeFiltro !== TODOS &&
        !post.targets.some((t) => t.network === redeFiltro)
      ) {
        return false;
      }

      if (termo) {
        const alvo = `${post.title} ${post.caption} ${post.client?.name ?? ""}`;
        if (!alvo.toLowerCase().includes(termo)) return false;
      }

      return true;
    });
  }, [posts, situacao, semDataApenas, cliente, redeFiltro, busca]);

  /* A pauta da carteira: recortada por CLIENTE e REDE, e só. Ignorar o
     filtro de situação aqui é o que faz clicar em "Atrasados" NÃO zerar
     os outros contadores — sem isso a tira deixaria de servir para
     voltar.

     Extraída do `useMemo` do resumo porque a grade de pauta precisa
     exatamente do mesmo conjunto: é ele que responde "quem está sem
     nada", e contar o buraco em cima do recorte filtrado faria a tela
     afirmar que 40 clientes estão sem pauta quando o que houve foi um
     clique num cartão do topo. */
  const pautaDaCarteira = useMemo(
    () =>
      posts.filter(
        (p) =>
          (cliente === TODOS || p.client_id === cliente) &&
          (redeFiltro === TODOS ||
            p.targets.some((t) => t.network === redeFiltro)),
      ),
    [posts, cliente, redeFiltro],
  );

  const resumo = useMemo(() => resumirPosts(pautaDaCarteira), [pautaDaCarteira]);

  /* A grade de pauta desenha uma LINHA POR CLIENTE, então o filtro de
     cliente precisa recortar as linhas também — e não só as peças, como
     faz nas outras visões. Sem isto, escolher um cliente deixaria as 60
     linhas na tela com 59 delas vazias. */
  const clientesNaGrade = useMemo(
    () => (cliente === TODOS ? clients : clients.filter((c) => c.id === cliente)),
    [clients, cliente],
  );

  const filtrando =
    cliente !== TODOS ||
    redeFiltro !== TODOS ||
    situacao !== TODOS ||
    semDataApenas ||
    busca !== "";

  function abrirNovo(dia?: string) {
    setEditando({ postId: null, dia });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* --------------------------- Resumo --------------------------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Contador
          label="Precisa de você"
          valor={resumo.exigemAcao}
          /* As SEIS situações com `exigeAcao`, não quatro. A legenda
             antiga listava só metade, e quem conferisse na mão achava
             dois a mais no número do que na explicação — publicado em
             parte e falhou também pedem alguém. */
          hint="Atrasado, em aprovação, ajustes, aprovado sem data, publicado em parte ou falhou"
          tom={resumo.exigemAcao > 0 ? "atencao" : "neutro"}
          ativo={false}
          onClick={undefined}
        />
        <Contador
          label="Atrasados"
          valor={resumo.atrasados}
          hint="Aprovado, o dia passou, não saiu"
          tom={resumo.atrasados > 0 ? "negativo" : "neutro"}
          ativo={situacao === "atrasado"}
          onClick={() =>
            setSituacao(situacao === "atrasado" ? TODOS : "atrasado")
          }
        />
        <Contador
          label="Em aprovação"
          valor={resumo.emAprovacao}
          hint="Com o cliente, esperando resposta"
          ativo={situacao === "em_aprovacao"}
          onClick={() =>
            setSituacao(situacao === "em_aprovacao" ? TODOS : "em_aprovacao")
          }
        />
        <Contador
          label="Agendados"
          valor={resumo.agendados}
          hint="Aprovado, com dia marcado à frente"
          ativo={situacao === "agendado"}
          onClick={() =>
            setSituacao(situacao === "agendado" ? TODOS : "agendado")
          }
        />
        <Contador
          label="Sem data"
          valor={resumo.semData}
          hint="Pauta que ainda não entrou no calendário"
          ativo={semDataApenas}
          onClick={() => setSemDataApenas((v) => !v)}
        />
      </div>

      {/* ----------------------- Barra de ações ----------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline sm:w-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <BotaoVisao
            ativo={visao === "pauta"}
            onClick={() => setVisao("pauta")}
            icon={LayoutGrid}
            label="Pauta"
          />
          <BotaoVisao
            ativo={visao === "calendario"}
            onClick={() => setVisao("calendario")}
            icon={CalendarDays}
            label="Calendário"
          />
          <BotaoVisao
            ativo={visao === "fila"}
            onClick={() => setVisao("fila")}
            icon={ListOrdered}
            label="Fila"
          />
          <BotaoVisao
            ativo={visao === "contas"}
            onClick={() => setVisao("contas")}
            icon={AtSign}
            label="Perfis"
          />
        </div>

        {visao !== "contas" && (
          <>
            {/* `w-full` no celular e só então `flex-1`: com `flex-1`
                sozinho a tira de abas toma a linha e esta caixa fica com
                largura zero — o input vaza para fora e a página ganha
                rolagem horizontal. Aconteceu na tela de tarefas. */}
            <div className="relative w-full min-w-0 sm:w-auto sm:min-w-44 sm:flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar peça…"
                className="h-9 pl-8"
              />
            </div>

            {/* Desktop: filtros na barra. Celular: dentro do popover —
                três selects de largura total empurrariam o calendário
                para fora da primeira dobra. */}
            <div className="hidden items-center gap-2 md:flex">
              <FiltroCliente
                value={cliente}
                onChange={setCliente}
                clients={clients}
              />
              <FiltroRede value={redeFiltro} onChange={setRedeFiltro} />
              <FiltroSituacao value={situacao} onChange={setSituacao} />
            </div>

            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="outline" size="sm" className="h-9 md:hidden">
                    <SlidersHorizontal className="size-4" />
                    {filtrando && (
                      <span className="size-1.5 rounded-full bg-signal" />
                    )}
                  </Button>
                }
              />
              <PopoverContent align="end" className="flex w-64 flex-col gap-2 p-3">
                <FiltroCliente
                  value={cliente}
                  onChange={setCliente}
                  clients={clients}
                />
                <FiltroRede value={redeFiltro} onChange={setRedeFiltro} />
                <FiltroSituacao value={situacao} onChange={setSituacao} />
              </PopoverContent>
            </Popover>
          </>
        )}

        <Button
          size="sm"
          className="h-9 ml-auto md:ml-0"
          onClick={() => abrirNovo()}
        >
          <Plus className="size-4" />
          Nova peça
        </Button>
      </div>

      {/* ---------------------------- Corpo --------------------------- */}
      {visao === "pauta" && (
        <PautaGrid
          posts={filtrados}
          pautaDaCarteira={pautaDaCarteira}
          /* Só o que a PESSOA ligou. `filtrando` inclui cliente e rede,
             que a grade já respeita nas próprias linhas — avisar por
             causa deles diria que a tela está mentindo quando ela está
             certa. */
          recorteParcial={situacao !== TODOS || semDataApenas || busca !== ""}
          clients={clientesNaGrade}
          todosOsClientes={clients}
          programacao={programacao}
          onAbrirPost={(post) => setEditando({ postId: post.id })}
          onNovoNoDia={(dia) => abrirNovo(dia)}
        />
      )}

      {visao === "calendario" && (
        <SocialCalendar
          posts={filtrados}
          onAbrirPost={(post) => setEditando({ postId: post.id })}
          onNovoNoDia={(dia) => abrirNovo(dia)}
        />
      )}

      {visao === "fila" && (
        <PostQueue
          posts={filtrados}
          onAbrirPost={(post) => setEditando({ postId: post.id })}
        />
      )}

      {visao === "contas" && (
        <AccountsPanel
          clients={clients}
          accounts={accounts}
          podeEditar={ehAdmin}
        />
      )}

      {/* O `key` remonta o compositor a cada peça: é o que faz o
          formulário nascer com os valores certos sem copiar prop em
          estado por efeito. E como a chave é o ID, um `refresh` que traz
          a mesma peça atualizada NÃO remonta — o texto que a pessoa está
          digitando fica, e só o que o compositor lê direto da prop (a
          lista de publicação) se atualiza.

          A condição extra cobre a peça que sumiu do servidor entre o
          clique e o refresh: sem ela, `post` viraria `null` e o diálogo
          de edição se transformaria em "Nova peça" na cara de quem
          estava editando. */}
      {editando !== undefined && (editando.postId === null || postEmEdicao) && (
        <PostComposer
          key={editando.postId ?? `novo-${editando.dia ?? ""}`}
          post={postEmEdicao}
          clients={clients}
          accounts={accounts}
          clientePadrao={cliente !== TODOS ? cliente : undefined}
          diaPadrao={editando.dia}
          onOpenChange={(aberto) => {
            if (!aberto) setEditando(undefined);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FiltroCliente({
  value,
  onChange,
  clients,
}: {
  value: string;
  onChange: (v: string) => void;
  clients: Client[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? TODOS)}>
      <SelectTrigger size="sm" className="w-full md:w-44" aria-label="Cliente">
        <SelectValue>
          {(v: string) =>
            v === TODOS
              ? "Todos os clientes"
              : (clients.find((c) => c.id === v)?.name ?? "Cliente")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>Todos os clientes</SelectItem>
        {clients.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FiltroRede({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? TODOS)}>
      <SelectTrigger size="sm" className="w-full md:w-36" aria-label="Rede">
        <SelectValue>
          {(v: string) =>
            v === TODOS ? "Todas as redes" : rede(v as SocialNetwork).label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>Todas as redes</SelectItem>
        {REDES.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* Ordem do FLUXO, não alfabética: rascunho → aprovação → ajustes →
   aprovado → no ar. Uma lista em ordem de dicionário abriria com
   "Agendado" e fecharia com "Rascunho", invertendo o caminho da peça. */
const SITUACOES_EM_ORDEM: Situacao[] = [
  "rascunho",
  "em_aprovacao",
  "ajustes",
  "pronto",
  "agendado",
  "atrasado",
  "parcial",
  "publicado",
  "falhou",
  "arquivado",
];

function FiltroSituacao({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? TODOS)}>
      <SelectTrigger size="sm" className="w-full md:w-40" aria-label="Situação">
        <SelectValue>
          {(v: string) =>
            v === TODOS ? "Todas as situações" : SITUACOES[v as Situacao].label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>Todas as situações</SelectItem>
        {SITUACOES_EM_ORDEM.map((s) => (
          <SelectItem key={s} value={s}>
            {SITUACOES[s].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Contador({
  label,
  valor,
  hint,
  tom = "neutro",
  ativo,
  onClick,
}: {
  label: string;
  valor: number;
  hint: string;
  tom?: "neutro" | "atencao" | "negativo";
  ativo: boolean;
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      <span className="eyebrow">{label}</span>
      <span
        className={cn(
          "mt-1.5 text-2xl font-semibold leading-none tabular-nums tracking-[-0.025em]",
          tom === "negativo" && valor > 0 && "text-negative",
          tom === "atencao" && valor > 0 && "text-warning",
        )}
      >
        {valor}
      </span>
      <span className="mt-1.5 line-clamp-2 text-2xs text-muted-foreground">
        {hint}
      </span>
    </>
  );

  /* O primeiro cartão NÃO filtra: um "Precisa de você" clicável
     prometeria um recorte que a lista de situações não sabe fazer — são
     seis situações diferentes, e o seletor escolhe uma de cada vez. */
  if (!onClick) {
    return (
      <div className="surface-card flex flex-col p-3.5 sm:p-4">{conteudo}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "surface-card flex flex-col p-3.5 text-left transition-colors hover:bg-accent sm:p-4",
        ativo && "ring-1 ring-signal",
      )}
    >
      {conteudo}
    </button>
  );
}

function BotaoVisao({
  ativo,
  onClick,
  icon: Icon,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  icon: typeof CalendarDays;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors",
        ativo
          ? "bg-background text-foreground ring-1 ring-hairline"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
