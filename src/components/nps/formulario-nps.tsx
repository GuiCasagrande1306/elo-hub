"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTINUIDADE, DIMENSOES, type ChaveDimensao, type Continuidade } from "@/lib/nps/regras";
import { cn } from "@/lib/utils";

type Notas = Record<ChaveDimensao, number | null>;

const NOTAS_VAZIAS = Object.fromEntries(DIMENSOES.map((d) => [d.chave, null])) as Notas;

function corDoScore(n: number, ativo: boolean) {
  if (!ativo) return "border-border bg-background text-foreground hover:border-primary/60";
  if (n >= 9) return "border-emerald-600 bg-emerald-600 text-white";
  if (n >= 7) return "border-amber-500 bg-amber-500 text-white";
  return "border-red-600 bg-red-600 text-white";
}

function Pergunta({
  numero,
  titulo,
  ajuda,
  children,
}: {
  numero: number;
  titulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Pergunta {numero}
        </p>
        <h2 className="mt-1 text-base font-semibold leading-snug sm:text-lg">{titulo}</h2>
        {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
      </div>
      {children}
    </section>
  );
}

export function FormularioNps({
  token,
  agencia,
}: {
  token: string;
  agencia: string;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState<Notas>(NOTAS_VAZIAS);
  const [continuidade, setContinuidade] = useState<Continuidade | null>(null);
  const [melhoria, setMelhoria] = useState("");
  const [respondente, setRespondente] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (score === null) {
      setErro("Escolha uma nota de 0 a 10 na primeira pergunta.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/pesquisa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          score,
          motivo: motivo || null,
          ...notas,
          continuidade,
          melhoria: melhoria || null,
          respondente: respondente || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; motivo?: string } | null;
      if (!json?.ok) throw new Error(json?.motivo ?? "Não foi possível enviar agora.");
      setEnviado(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar agora.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="surface-card flex flex-col items-center gap-3 px-6 py-12 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <h2 className="text-xl font-semibold">Obrigado pela resposta!</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Ela chegou direto para a equipe da {agencia}. Vamos ler com atenção e
          usar para melhorar o nosso trabalho.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Pergunta
        numero={1}
        titulo={`De 0 a 10, o quanto você recomendaria o trabalho da ${agencia} para um amigo ou parceiro de negócio?`}
      >
        <div role="radiogroup" aria-label="Nota de 0 a 10" className="grid grid-cols-6 gap-2 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              onClick={() => setScore(n)}
              className={cn(
                "h-11 rounded-lg border text-base font-semibold tabular-nums transition-colors",
                corDoScore(n, score === n),
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0 = nada provável</span>
          <span>10 = muito provável</span>
        </div>
      </Pergunta>

      <Pergunta numero={2} titulo="O que mais pesou na sua nota?" ajuda="Opcional, mas é o que mais nos ajuda.">
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Conte com suas palavras"
        />
      </Pergunta>

      <Pergunta
        numero={3}
        titulo="Como você avalia cada parte do nosso trabalho?"
        ajuda="1 = muito ruim, 5 = excelente. Marque “Não se aplica” no que não contrata."
      >
        <div className="flex flex-col gap-5">
          {DIMENSOES.map((d) => (
            <div key={d.chave} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{d.rotulo}</p>
              <div role="radiogroup" aria-label={d.rotulo} className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const ativo = notas[d.chave] === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      onClick={() => setNotas((v) => ({ ...v, [d.chave]: n }))}
                      className={cn(
                        "h-10 w-11 rounded-lg border text-sm font-semibold tabular-nums transition-colors",
                        ativo
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:border-primary/60",
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={notas[d.chave] === null}
                  onClick={() => setNotas((v) => ({ ...v, [d.chave]: null }))}
                  className={cn(
                    "h-10 rounded-lg border px-3 text-xs transition-colors",
                    notas[d.chave] === null
                      ? "border-foreground/40 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/60",
                  )}
                >
                  Não se aplica
                </button>
              </div>
            </div>
          ))}
        </div>
      </Pergunta>

      <Pergunta numero={4} titulo={`Você pretende continuar com a ${agencia} nos próximos meses?`}>
        <div role="radiogroup" aria-label="Continuidade" className="grid grid-cols-3 gap-2">
          {CONTINUIDADE.map((c) => (
            <button
              key={c.valor}
              type="button"
              role="radio"
              aria-checked={continuidade === c.valor}
              onClick={() => setContinuidade(c.valor)}
              className={cn(
                "h-11 rounded-lg border text-sm font-semibold transition-colors",
                continuidade === c.valor
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-primary/60",
              )}
            >
              {c.rotulo}
            </button>
          ))}
        </div>
      </Pergunta>

      <Pergunta numero={5} titulo="O que poderíamos fazer melhor?" ajuda="Opcional.">
        <Textarea
          value={melhoria}
          onChange={(e) => setMelhoria(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Uma sugestão, um incômodo, uma ideia"
        />
      </Pergunta>

      <Pergunta numero={6} titulo="Quem está respondendo?" ajuda="Opcional — nome e cargo.">
        <Input
          value={respondente}
          onChange={(e) => setRespondente(e.target.value)}
          maxLength={200}
          placeholder="Ex.: Ana, sócia"
          autoComplete="name"
        />
      </Pergunta>

      {erro && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erro}
        </p>
      )}

      <Button type="submit" size="lg" disabled={enviando} className="h-12 text-base">
        {enviando ? "Enviando…" : "Enviar resposta"}
      </Button>
    </form>
  );
}
