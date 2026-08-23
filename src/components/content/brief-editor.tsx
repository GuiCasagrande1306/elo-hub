"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Eye, Plus, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BriefDocument } from "./brief-document";
import { salvarBrief } from "@/app/(app)/conteudo/actions";
import {
  blocosSchema,
  carimbosSchema,
  lerBlocos,
  resumirBrief,
  STATUS_BRIEF,
  STATUS_BRIEF_LABEL,
  type Bloco,
  type Carimbo,
  type StatusBrief,
} from "@/lib/content/blocks";

/* =====================================================================
   Editor
   ---------------------------------------------------------------------
   O corpo do documento é editado como JSON, e isso é uma escolha, não
   uma etapa que faltou.

   Quem escreve estes documentos é o modelo: o texto chega pronto, em
   bloco, e o trabalho da pessoa é conferir, ajustar uma frase e salvar.
   Um construtor de blocos com botão de "adicionar seção" otimizaria a
   montagem manual — que é justamente a parte que não acontece — e
   tornaria a colagem de um documento inteiro impossível sem vinte
   cliques.

   O que o JSON cru custaria em segurança de edição é devolvido por
   duas coisas: a validação roda a cada tecla e diz QUAL bloco quebrou,
   e a prévia ao lado mostra o documento final, não uma aproximação.
   Errar sem perceber exigiria não olhar para nenhuma das duas.

   Os campos do cabeçalho — cliente, título, resumo, carimbos — ficam em
   formulário normal: são os que se ajustam sozinhos, sem tocar no corpo.
   ===================================================================== */

export interface BriefEditorProps {
  briefId?: string;
  clientes: { id: string; name: string }[];
  inicial: {
    clientId: string;
    titulo: string;
    destaque: string;
    resumo: string;
    carimbos: Carimbo[];
    blocos: Bloco[];
    status: StatusBrief;
  };
}

export function BriefEditor({ briefId, clientes, inicial }: BriefEditorProps) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  const [clientId, setClientId] = useState(inicial.clientId);
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [destaque, setDestaque] = useState(inicial.destaque);
  const [resumo, setResumo] = useState(inicial.resumo);
  const [status, setStatus] = useState<StatusBrief>(inicial.status);
  const [carimbos, setCarimbos] = useState<Carimbo[]>(inicial.carimbos);

  /* O JSON vive como TEXTO no estado, não como objeto.
     Guardar o objeto e reserializar a cada tecla reformataria o que a
     pessoa está digitando no meio da digitação — a indentação pularia
     sozinha e o cursor se perderia. */
  const [json, setJson] = useState(() =>
    JSON.stringify(inicial.blocos, null, 2),
  );

  const [previa, setPrevia] = useState(true);

  /**
   * Colar o documento INTEIRO no campo do corpo preenche o cabeçalho
   * junto.
   *
   * O texto que chega pronto vem como um objeto com `titulo`,
   * `carimbos` e `blocos` — o mesmo formato dos arquivos em
   * `docs/briefs/`. Sem isto, importar um documento seria recortar o
   * array de blocos de dentro do objeto e redigitar quatro campos à
   * mão, que é justamente onde se troca o cliente de um carimbo e
   * ninguém percebe.
   *
   * Só dispara com objeto COMPLETO e válido: enquanto a pessoa digita,
   * o `JSON.parse` falha e nada acontece. Colar um array de blocos —
   * o caso comum — continua funcionando como antes.
   */
  function aoDigitarCorpo(texto: string) {
    const doc = documentoInteiro(texto);

    if (!doc) {
      setJson(texto);
      return;
    }

    setTitulo(doc.titulo ?? titulo);
    setDestaque(doc.destaque ?? "");
    setResumo(doc.resumo ?? "");
    setCarimbos(doc.carimbos ?? []);
    setJson(JSON.stringify(doc.blocos, null, 2));
    toast.success("Documento importado: cabeçalho e corpo preenchidos.");
  }

  const analise = useMemo(() => analisar(json), [json]);
  const resumoDoc = useMemo(
    () => resumirBrief(analise.blocos),
    [analise.blocos],
  );

  function salvar() {
    if (analise.erro) {
      toast.error(analise.erro);
      return;
    }

    startTransition(async () => {
      const r = await salvarBrief({
        briefId,
        clientId,
        titulo,
        destaque,
        resumo,
        carimbos,
        blocos: analise.blocos,
        status,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success("Documento salvo.");
      router.push(`/conteudo/${r.dados.id}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={briefId ? `/conteudo/${briefId}` : "/conteudo"} />}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrevia((v) => !v)}
          >
            <Eye className="size-4" />
            {previa ? "Ocultar prévia" : "Ver prévia"}
          </Button>
          <Button size="sm" onClick={salvar} disabled={pendente || !!analise.erro}>
            <Save className="size-4" />
            {pendente ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {/* ---------------- Formulário ----------------
            `min-w-0` nas duas colunas: item de grid nasce com
            `min-width: auto`, então o campo mais largo de dentro (o
            JSON em fonte monoespaçada) empurrava a trilha e a página
            inteira ganhava rolagem horizontal. */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cliente">Cliente</Label>
              <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
                <SelectTrigger id="cliente" className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      clientes.find((c) => c.id === v)?.name ?? "Escolha"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus((v as StatusBrief) ?? "rascunho")}
              >
                <SelectTrigger id="status" className="w-full">
                  <SelectValue>
                    {(v: string) => STATUS_BRIEF_LABEL[v as StatusBrief] ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_BRIEF.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_BRIEF_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Bastidores da Brazzo"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="destaque">Destaque</Label>
              <Input
                id="destaque"
                value={destaque}
                onChange={(e) => setDestaque(e.target.value)}
                placeholder="Brazzo"
                className="sm:w-40"
              />
              {/* Explica o campo sem precisar de tooltip: o pedaço do
                  título que sai na cor da marca. */}
              <p className="text-2xs text-muted-foreground">
                Trecho do título em cor
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="resumo">Resumo</Label>
            <Textarea
              id="resumo"
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
              rows={3}
              placeholder="O parágrafo grande logo abaixo do título."
            />
          </div>

          <CarimbosField carimbos={carimbos} onChange={setCarimbos} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="blocos">Corpo do documento</Label>
              <span className="text-2xs text-muted-foreground">
                {resumoDoc.roteiros} roteiros · {resumoDoc.pendencias} a
                confirmar
              </span>
            </div>

            <Textarea
              id="blocos"
              value={json}
              onChange={(e) => aoDigitarCorpo(e.target.value)}
              spellCheck={false}
              className="min-h-[28rem] font-mono text-xs leading-relaxed"
            />

            {analise.erro ? (
              <p className="text-xs text-destructive">{analise.erro}</p>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Marcação no texto: <code>**negrito**</code>,{" "}
                <code>_itálico_</code> para cena e{" "}
                <code>[colchete]</code> para o que ainda precisa ser
                confirmado com o cliente. Colar o documento inteiro —
                com título e carimbos — preenche os campos acima junto.
              </p>
            )}
          </div>
        </div>

        {/* ---------------- Prévia ---------------- */}
        {previa ? (
          <div className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
            <div className="overflow-hidden rounded-xl border border-border">
              <BriefDocument
                titulo={titulo || "Sem título"}
                destaque={destaque}
                resumo={resumo}
                carimbos={carimbos}
                blocos={analise.blocos}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface DocumentoColado {
  titulo?: string;
  destaque?: string;
  resumo?: string;
  carimbos?: Carimbo[];
  blocos: unknown[];
}

/** `null` quando o texto não é um documento completo — inclusive quando
 *  é só o array de blocos, que é o caminho normal de edição. */
function documentoInteiro(texto: string): DocumentoColado | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }

  if (
    bruto === null ||
    typeof bruto !== "object" ||
    Array.isArray(bruto) ||
    !Array.isArray((bruto as { blocos?: unknown }).blocos)
  ) {
    return null;
  }

  const doc = bruto as Record<string, unknown>;
  const carimbos = carimbosSchema.safeParse(doc.carimbos);

  return {
    titulo: typeof doc.titulo === "string" ? doc.titulo : undefined,
    destaque: typeof doc.destaque === "string" ? doc.destaque : undefined,
    resumo: typeof doc.resumo === "string" ? doc.resumo : undefined,
    carimbos: carimbos.success ? carimbos.data : [],
    blocos: doc.blocos as unknown[],
  };
}

interface Analise {
  blocos: Bloco[];
  erro: string | null;
}

/**
 * Valida o texto do editor.
 *
 * Erro de sintaxe e erro de formato são mensagens DIFERENTES porque
 * exigem coisas diferentes de quem lê: um é vírgula sobrando, o outro é
 * um campo faltando num bloco específico. "JSON inválido" para os dois
 * casos mandaria procurar vírgula num documento que está bem formado.
 *
 * A prévia usa `lerBlocos`, que descarta o inválido em vez de sumir com
 * tudo: com um bloco quebrado no meio, o resto do documento continua
 * aparecendo, e é o que permite achar o buraco olhando.
 */
function analisar(texto: string): Analise {
  let bruto: unknown;

  try {
    bruto = JSON.parse(texto);
  } catch (e) {
    return {
      blocos: [],
      erro: `JSON inválido: ${e instanceof Error ? e.message : "erro de sintaxe"}`,
    };
  }

  if (!Array.isArray(bruto)) {
    return { blocos: [], erro: "O corpo precisa ser uma lista de blocos ([…])." };
  }

  const validacao = blocosSchema.safeParse(bruto);
  if (!validacao.success) {
    const issue = validacao.error.issues[0];
    const caminho = issue?.path.join(".") ?? "";
    return {
      blocos: lerBlocos(bruto),
      erro: `Bloco inválido em ${caminho || "?"}: ${issue?.message ?? "formato inesperado"}`,
    };
  }

  return { blocos: validacao.data, erro: null };
}

function CarimbosField({
  carimbos,
  onChange,
}: {
  carimbos: Carimbo[];
  onChange: (c: Carimbo[]) => void;
}) {
  function atualizar(i: number, campo: keyof Carimbo, valor: string) {
    onChange(carimbos.map((c, j) => (i === j ? { ...c, [campo]: valor } : c)));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Carimbos do topo</Label>

      {carimbos.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={c.rotulo}
            onChange={(e) => atualizar(i, "rotulo", e.target.value)}
            placeholder="Formato"
            className="w-40"
          />
          <Input
            value={c.valor}
            onChange={(e) => atualizar(i, "valor", e.target.value)}
            placeholder="Reels vertical"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(carimbos.filter((_, j) => j !== i))}
            aria-label="Remover carimbo"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={carimbos.length >= 8}
        onClick={() => onChange([...carimbos, { rotulo: "", valor: "" }])}
      >
        <Plus className="size-4" />
        Carimbo
      </Button>
    </div>
  );
}
