"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NetworkGlyph } from "./network-glyph";
import {
  carregarComentarios,
  comentarPost,
  excluirPost,
  marcarPublicacao,
  salvarPost,
} from "@/app/(app)/midias-sociais/actions";
import {
  FORMATOS,
  REDES,
  formatoEstranho,
  limiteDaLegenda,
  ordenarRedes,
  rede,
} from "@/lib/social/networks";
import { STATUS_EDITORIAL } from "@/lib/social/post-status";
import { montarAgendamento, partesDoAgendamento } from "@/lib/social/agenda";
import { formatDateFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Client,
  SocialAccount,
  SocialFormat,
  SocialNetwork,
  SocialPostComment,
  SocialPostStatus,
  SocialPostWithRelations,
} from "@/types/database";

/* =====================================================================
   Compositor — e painel da peça
   ---------------------------------------------------------------------
   UM SÓ LUGAR para escrever, agendar, aprovar e registrar o que saiu.
   A alternativa era um diálogo de edição e um painel de detalhe
   separados, e ela quebra no uso real: quem abre a peça para aprovar
   quase sempre quer corrigir uma palavra antes, e quem corrige a palavra
   quer aprovar em seguida. Dois lugares obrigariam a fechar um, achar o
   outro e reencontrar a mesma peça.

   O ESTADO NASCE DAS PROPS e não é sincronizado por efeito. Quem monta
   este componente passa `key={post?.id ?? "novo"}`, então trocar de peça
   remonta com o formulário já certo. `setState` dentro de efeito para
   copiar prop em estado é o padrão que o React Compiler recusa neste
   projeto — e que, quando passa, deixa o rascunho de uma peça aparecer
   dentro de outra.
   ===================================================================== */

export function PostComposer({
  post,
  clients,
  accounts,
  clientePadrao,
  diaPadrao,
  onOpenChange,
}: {
  /** `null` = peça nova. */
  post: SocialPostWithRelations | null;
  clients: Client[];
  accounts: SocialAccount[];
  /** Cliente do filtro ativo, para a peça nova já vir preenchida. */
  clientePadrao?: string;
  /** Dia clicado no calendário, no formato YYYY-MM-DD. */
  diaPadrao?: string;
  onOpenChange: (aberto: boolean) => void;
}) {
  const router = useRouter();
  const [salvando, iniciarSalvamento] = useTransition();

  const partes = partesDoAgendamento(post?.scheduled_at ?? null);

  const [clientId, setClientId] = useState(
    post?.client_id ?? clientePadrao ?? clients[0]?.id ?? "",
  );
  const [title, setTitle] = useState(post?.title ?? "");
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [format, setFormat] = useState<SocialFormat>(post?.format ?? "feed");
  const [status, setStatus] = useState<SocialPostStatus>(post?.status ?? "rascunho");
  const [data, setData] = useState(partes.data || diaPadrao || "");
  const [hora, setHora] = useState(partes.hora);
  const [midia, setMidia] = useState((post?.media_urls ?? []).join("\n"));
  const [redes, setRedes] = useState<SocialNetwork[]>(
    post ? ordenarRedes(post.targets.map((t) => t.network)) : [],
  );

  /* Redes em que a peça JÁ SAIU (ou falhou). Não dá para desmarcar:
     apagar o destino apagaria junto o link do post no ar, que é a prova
     de que saiu. O servidor recusa do mesmo jeito — ver
     `sincronizarDestinos`. */
  const travadas = useMemo(
    () =>
      new Set(
        (post?.targets ?? [])
          .filter((t) => t.status !== "pendente")
          .map((t) => t.network),
      ),
    [post],
  );

  const doCliente = useMemo(
    () =>
      accounts.filter((a) => a.client_id === clientId && a.is_active),
    [accounts, clientId],
  );

  const cadastradas = useMemo(
    () => new Set(doCliente.map((a) => a.network)),
    [doCliente],
  );

  const limite = limiteDaLegenda(caption, redes);
  const estranhas = formatoEstranho(format, redes);

  function alternarRede(id: SocialNetwork) {
    if (travadas.has(id)) {
      toast.info("Essa rede já tem publicação registrada e não pode sair da peça.");
      return;
    }
    setRedes((atual) =>
      atual.includes(id)
        ? atual.filter((r) => r !== id)
        : ordenarRedes([...atual, id]),
    );
  }

  function salvar() {
    iniciarSalvamento(async () => {
      const resultado = await salvarPost({
        postId: post?.id,
        clientId,
        title,
        caption,
        format,
        status,
        scheduledAt: montarAgendamento(data, hora),
        networks: redes,
        mediaUrls: midia
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      });

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      toast.success(post ? "Peça atualizada." : "Peça criada.");
      onOpenChange(false);
      router.refresh();
    });
  }

  function apagar() {
    if (!post) return;
    iniciarSalvamento(async () => {
      const resultado = await excluirPost(post.id);
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Peça excluída.");
      onOpenChange(false);
      router.refresh();
    });
  }

  const descricaoStatus = STATUS_EDITORIAL.find((s) => s.id === status)?.descricao;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col overflow-hidden sm:max-w-[min(94vw,1000px)]">
        <DialogHeader>
          <DialogTitle>{post ? "Editar peça" : "Nova peça"}</DialogTitle>
          <DialogDescription>
            {post
              ? "Conteúdo, agenda, aprovação e o registro do que já saiu."
              : "Escreva uma vez e escolha em quais redes ela entra."}
          </DialogDescription>
        </DialogHeader>

        {/* Duas colunas no desktop, empilhado no celular. A rolagem é
            DESTE bloco e não da página: com a rolagem no diálogo
            inteiro, o rodapé de ações sai da tela justamente quando a
            legenda cresce. */}
        <div className="-mx-1 flex-1 overflow-y-auto px-1 py-1">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
            {/* ------------------------- Conteúdo -------------------- */}
            <div className="flex min-w-0 flex-col gap-4">
              <Campo label="Nome da peça" hint="Uso interno — é o que aparece no calendário.">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Carrossel — 5 erros de skincare"
                  autoFocus
                />
              </Campo>

              <Campo
                label="Legenda"
                hint={
                  limite ? (
                    <span
                      className={cn(
                        "tabular-nums",
                        limite.estourou && "font-medium text-negative",
                      )}
                    >
                      {limite.usado} / {limite.rede.limite} — limite do{" "}
                      {limite.rede.label}
                    </span>
                  ) : (
                    "Escolha uma rede para ver o limite de caracteres."
                  )
                }
              >
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={8}
                  placeholder="O texto que vai junto com a arte…"
                  className={cn(
                    "resize-y",
                    limite?.estourou && "ring-1 ring-negative/50",
                  )}
                />
              </Campo>

              {limite?.estourou && (
                <Aviso tom="negativo">
                  A legenda passa {limite.usado - limite.rede.limite} caracteres do
                  limite do {limite.rede.label}. Ela cabe nas outras redes — dá para
                  salvar assim e cortar só na hora, ou tirar o {limite.rede.label}{" "}
                  desta peça.
                </Aviso>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Formato">
                  <Select
                    value={format}
                    onValueChange={(v) => setFormat((v as SocialFormat) ?? "feed")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          FORMATOS.find((f) => f.id === v)?.label ?? v
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {FORMATOS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>

                <Campo label="Cliente">
                  <Select
                    value={clientId}
                    onValueChange={(v) => setClientId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          clients.find((c) => c.id === v)?.name ?? "Escolher"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              </div>

              {estranhas.length > 0 && (
                <Aviso tom="atencao">
                  {FORMATOS.find((f) => f.id === format)?.label} não existe{" "}
                  {estranhas.length === 1 ? "no" : "em"}{" "}
                  {estranhas.map((r) => rede(r).label).join(", ")}. Dá para salvar
                  assim — a lista de formatos daqui pode estar atrás do que a
                  plataforma lançou.
                </Aviso>
              )}

              <Campo
                label="Links das artes"
                hint="Um por linha. Aponte para onde o arquivo já está — o sistema não guarda a arte."
              >
                <Textarea
                  value={midia}
                  onChange={(e) => setMidia(e.target.value)}
                  rows={2}
                  placeholder="https://drive.google.com/…"
                  className="resize-y font-mono text-xs"
                />
              </Campo>
            </div>

            {/* ------------------- Destino e trâmite ----------------- */}
            <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-hairline lg:pl-5">
              <Campo
                label="Redes"
                hint={
                  doCliente.length > 0
                    ? "As de cima são os perfis cadastrados deste cliente."
                    : "Nenhum perfil cadastrado para este cliente ainda."
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {ordenarRedes(REDES.map((r) => r.id))
                    /* Cadastradas primeiro: numa lista de nove, as três
                       que o cliente realmente tem se perdem no meio. */
                    .sort((a, b) =>
                      Number(cadastradas.has(b)) - Number(cadastradas.has(a)),
                    )
                    .map((id) => {
                      const marcada = redes.includes(id);
                      const travada = travadas.has(id);
                      const temPerfil = cadastradas.has(id);

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => alternarRede(id)}
                          aria-pressed={marcada}
                          /* O `title` VIRA o nome acessível do botão e
                             cobre o texto visível. Sem o rótulo da rede
                             aqui, o leitor de tela anunciava só
                             "@verdicosmeticos" — sem dizer de qual rede. */
                          title={
                            travada
                              ? `${rede(id).label} — já tem publicação registrada`
                              : temPerfil
                                ? `${rede(id).label} — @${doCliente.find((a) => a.network === id)?.handle}`
                                : `${rede(id).label} — perfil não cadastrado para este cliente`
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors",
                            marcada
                              ? "border-signal bg-accent font-medium"
                              : "border-hairline text-muted-foreground hover:text-foreground",
                            travada && "cursor-not-allowed opacity-75",
                            /* Sem perfil cadastrado ainda dá para
                               marcar: a peça pode ser planejada antes de
                               alguém preencher o @. Fica só mais apagada
                               para a diferença aparecer. */
                            !temPerfil && !marcada && "opacity-55",
                          )}
                        >
                          <NetworkGlyph network={id} colorida={marcada} />
                          {rede(id).label}
                        </button>
                      );
                    })}
                </div>
              </Campo>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Data">
                  <Input
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                  />
                </Campo>
                <Campo label="Hora">
                  <Input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    disabled={!data}
                  />
                </Campo>
              </div>

              {!data && (
                <p className="-mt-2 text-2xs text-muted-foreground">
                  Sem data a peça fica na pauta, fora do calendário — e aparece
                  no contador de “sem data”.
                </p>
              )}

              <Campo label="Situação" hint={descricaoStatus}>
                <Select
                  value={status}
                  onValueChange={(v) =>
                    setStatus((v as SocialPostStatus) ?? "rascunho")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) =>
                        STATUS_EDITORIAL.find((s) => s.id === v)?.label ?? v
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_EDITORIAL.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>

              {post?.approver && post.status === "aprovado" && (
                <p className="-mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <CheckCircle2 className="size-3 text-positive" />
                  Aprovado por {post.approver.full_name}
                  {post.approved_at && ` em ${formatDateFull(post.approved_at)}`}
                </p>
              )}

              {post && (
                <>
                  <ChecklistDePublicacao post={post} />
                  <Comentarios postId={post.id} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* --------------------------- Rodapé --------------------------- */}
        <footer className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          {post && (
            <Button
              variant="ghost"
              size="sm"
              onClick={apagar}
              disabled={salvando}
              className="text-negative hover:bg-negative-muted hover:text-negative"
            >
              <Trash2 className="size-4" />
              Excluir
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="size-4 animate-spin" />}
              {post ? "Salvar" : "Criar peça"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Registro de publicação                                              */
/* ------------------------------------------------------------------ */

/**
 * O que já saiu, rede a rede.
 *
 * MARCAÇÃO MANUAL, e a tela diz isso em voz alta. O sistema não fala com
 * a API de rede nenhuma; um botão "Publicar" aqui seria a mesma armadilha
 * do "Publicar" do EloChat, que não publica. Marcar à mão é chato e é
 * verdade — e resolve o problema real, que é saber se o post de terça
 * saiu no Facebook.
 */
function ChecklistDePublicacao({ post }: { post: SocialPostWithRelations }) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const [editando, setEditando] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  function marcar(
    targetId: string,
    status: "pendente" | "publicado" | "falhou",
    link?: string,
  ) {
    iniciar(async () => {
      const r = await marcarPublicacao({ targetId, status, url: link ?? "" });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEditando(null);
      setUrl("");
      router.refresh();
    });
  }

  if (post.targets.length === 0) return null;

  return (
    <section className="rounded-xl bg-surface-2/60 p-3 ring-1 ring-hairline">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="eyebrow">Publicação</h3>
        <span className="text-2xs text-muted-foreground">
          marcada à mão por quem publicou
        </span>
      </header>

      <div className="flex flex-col gap-1">
        {post.targets.map((alvo) => {
          const publicado = alvo.status === "publicado";
          const falhou = alvo.status === "falhou";

          return (
            <div key={alvo.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <NetworkGlyph network={alvo.network} />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {rede(alvo.network).label}
                </span>

                {alvo.published_url && (
                  <a
                    href={alvo.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    title="Abrir post publicado"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}

                {/* Três estados, três botões. Um Select aqui esconderia
                    a ação atrás de dois cliques para uma escolha que é
                    quase sempre "publiquei". */}
                <div className="flex items-center gap-0.5">
                  <BotaoEstado
                    ativo={alvo.status === "pendente"}
                    onClick={() => marcar(alvo.id, "pendente")}
                    disabled={salvando}
                    icon={CircleDashed}
                    label="Pendente"
                    tom="neutro"
                  />
                  <BotaoEstado
                    ativo={publicado}
                    onClick={() =>
                      publicado ? undefined : setEditando(alvo.id)
                    }
                    disabled={salvando}
                    icon={CheckCircle2}
                    label="Publicado"
                    tom="positivo"
                  />
                  <BotaoEstado
                    ativo={falhou}
                    onClick={() => marcar(alvo.id, "falhou")}
                    disabled={salvando}
                    icon={XCircle}
                    label="Falhou"
                    tom="negativo"
                  />
                </div>
              </div>

              {editando === alvo.id && (
                <div className="flex items-center gap-1.5 pl-6">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Link do post (opcional)"
                    className="h-8 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") marcar(alvo.id, "publicado", url);
                      if (e.key === "Escape") setEditando(null);
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => marcar(alvo.id, "publicado", url)}
                    disabled={salvando}
                  >
                    Marcar
                  </Button>
                </div>
              )}

              {alvo.error && (
                <p className="pl-6 text-2xs text-negative">{alvo.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BotaoEstado({
  ativo,
  onClick,
  disabled,
  icon: Icon,
  label,
  tom,
}: {
  ativo: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: typeof CheckCircle2;
  label: string;
  tom: "neutro" | "positivo" | "negativo";
}) {
  const cores = {
    neutro: "text-muted-foreground",
    positivo: "text-positive",
    negativo: "text-negative",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={ativo}
      className={cn(
        "rounded-md p-1 transition-colors",
        ativo
          ? cn("bg-accent", cores[tom])
          : "text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Conversa de aprovação                                               */
/* ------------------------------------------------------------------ */

function Comentarios({ postId }: { postId: string }) {
  const router = useRouter();
  const [comentarios, setComentarios] = useState<SocialPostComment[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, iniciar] = useTransition();

  /* Carregados por Server Action em vez de virem com a lista de posts:
     a página traz centenas de peças e quase nenhuma tem a conversa
     aberta. `vivo` evita gravar estado depois de fechar o diálogo. */
  useEffect(() => {
    let vivo = true;
    carregarComentarios(postId)
      .then((lista) => {
        if (vivo) setComentarios(lista);
      })
      /* Sem o catch, uma action que rejeita deixa `comentarios` em
         `null` para sempre — o bloco fica em "Carregando…" e quem olha
         conclui que a peça não tem conversa, quando na verdade a
         conversa não carregou. */
      .catch(() => {
        if (!vivo) return;
        setComentarios([]);
        toast.error("Não foi possível carregar a conversa.");
      });
    return () => {
      vivo = false;
    };
  }, [postId]);

  function enviar() {
    const corpo = texto.trim();
    if (!corpo) return;

    iniciar(async () => {
      const r = await comentarPost({ postId, body: corpo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setTexto("");
      setComentarios(await carregarComentarios(postId).catch(() => []));
      router.refresh();
    });
  }

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h3 className="eyebrow flex items-center gap-1.5">
        <MessageSquare className="size-3.5" />
        Conversa
      </h3>

      {comentarios === null ? (
        <p className="text-2xs text-muted-foreground">Carregando…</p>
      ) : comentarios.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          Nada ainda. Use para registrar o que o cliente pediu — é o que falta
          quando a peça volta para ajuste.
        </p>
      ) : (
        <ol className="flex max-h-44 flex-col gap-2 overflow-y-auto pr-1">
          {comentarios.map((c) => (
            <li key={c.id} className="text-xs">
              <span className="font-medium">
                {c.author?.full_name ?? "Alguém"}
              </span>
              <span className="ml-1.5 text-2xs text-muted-foreground">
                {formatDateFull(c.created_at)}
              </span>
              <p className="mt-0.5 text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-end gap-1.5">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="O que o cliente pediu…"
          className="resize-none text-xs"
          onKeyDown={(e) => {
            /* ⌘/Ctrl+Enter envia. Enter sozinho quebra linha: o texto
               aqui costuma ter duas ou três frases, e enviar no Enter
               partiria o comentário em pedaços. */
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviar();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="h-9 px-2.5"
          title="Enviar (⌘+Enter)"
        >
          {enviando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Campo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Aviso({
  tom,
  children,
}: {
  tom: "atencao" | "negativo";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-2xs",
        tom === "negativo"
          ? "bg-negative-muted text-negative"
          : "bg-warning-muted text-warning",
      )}
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
