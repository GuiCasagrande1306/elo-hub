"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";

import { salvarCampos } from "@/app/(app)/clientes/ficha-actions";
import { Button } from "@/components/ui/button";
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
import { formatDate } from "@/lib/format";
import { rotuloDaOpcao, type Campos, type DefinicaoDeCampo } from "@/lib/clientes/ficha";
import { cn } from "@/lib/utils";

/** O valor como aparece na leitura: data em dd/mm/aaaa, opção pelo rótulo. */
export function valorLegivel(def: DefinicaoDeCampo, valor: string | undefined): string {
  if (!valor) return "";
  if (def.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return formatDate(`${valor}T12:00:00`);
  return def.opcoes ? rotuloDaOpcao(def, valor) : valor;
}

/** Texto puro, ou link clicável quando o valor é uma URL (pasta do Drive...). */
export function ValorOuLink({ texto }: { texto: string }) {
  if (!texto) return <span className="text-muted-foreground">—</span>;
  if (/^https?:\/\/\S+$/.test(texto)) {
    return (
      <a href={texto} target="_blank" rel="noopener noreferrer" className="text-signal underline-offset-2 hover:underline">
        {texto.replace(/^https?:\/\//, "").slice(0, 60)}
      </a>
    );
  }
  return <>{texto}</>;
}

/** Um campo de formulário a partir da definição. Compartilhado com as listas. */
export function CampoDoFormulario({
  def,
  valor,
  onChange,
  idBase,
}: {
  def: DefinicaoDeCampo;
  valor: string;
  onChange: (v: string) => void;
  idBase: string;
}) {
  const idCampo = `${idBase}-${def.chave}`;
  return (
    <div className={cn("flex flex-col gap-1.5", def.tipo === "longo" && "sm:col-span-2")}>
      <Label htmlFor={idCampo}>{def.rotulo}</Label>
      {def.opcoes ? (
        <Select value={valor} onValueChange={(v) => onChange(v ?? "")}>
          <SelectTrigger id={idCampo} className="w-full">
            <SelectValue>{(v: string) => rotuloDaOpcao(def, v) || "Selecione"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {def.opcoes.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : def.tipo === "longo" ? (
        <Textarea
          id={idCampo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          maxLength={3000}
          rows={3}
        />
      ) : (
        <Input
          id={idCampo}
          type={def.tipo === "data" ? "date" : "text"}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          maxLength={3000}
        />
      )}
    </div>
  );
}

/**
 * Seção de campos da ficha (Mapa do Negócio, Metas, Como atender...).
 * Leitura por padrão; "Editar" troca pelo formulário da seção inteira.
 */
export function CamposEditaveis({
  clientId,
  secao,
  titulo,
  descricao,
  definicao,
  valores,
  colunas = 3,
}: {
  clientId: string;
  secao: string;
  titulo: string;
  descricao?: string;
  definicao: readonly DefinicaoDeCampo[];
  valores: Campos | undefined;
  colunas?: 2 | 3;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Campos>({});
  const [salvando, iniciar] = useTransition();
  const atuais = valores ?? {};
  const vazio = definicao.every((d) => !atuais[d.chave]);

  function abrir() {
    setRascunho({ ...atuais });
    setEditando(true);
  }

  function salvar() {
    iniciar(async () => {
      const r = await salvarCampos({ clientId, secao, valores: rascunho });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${titulo} salvo.`);
      setEditando(false);
    });
  }

  return (
    <section className="surface-card p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {!editando && (
          <Button size="sm" variant="outline" onClick={abrir}>
            <Pencil className="size-3.5" />
            {vazio ? "Preencher" : "Editar"}
          </Button>
        )}
      </header>

      {editando ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {definicao.map((d) => (
              <CampoDoFormulario
                key={d.chave}
                def={d}
                idBase={`${secao}`}
                valor={rascunho[d.chave] ?? ""}
                onChange={(v) => setRascunho((r) => ({ ...r, [d.chave]: v }))}
              />
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={salvando}>
              {salvando && <Loader2 className="size-3.5 animate-spin" />}
              Salvar
            </Button>
          </div>
        </form>
      ) : vazio ? (
        <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-muted-foreground">
          Nada preenchido ainda.
        </p>
      ) : (
        <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", colunas === 3 && "lg:grid-cols-3")}>
          {definicao.map((d) => (
            <div key={d.chave} className="min-w-0">
              <dt className="eyebrow">{d.rotulo}</dt>
              <dd className="mt-1 whitespace-pre-line break-words text-sm">
                <ValorOuLink texto={valorLegivel(d, atuais[d.chave])} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
