"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { salvarMensagemDoCliente } from "@/app/(app)/relatorios/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MARCADORES,
  MENSAGEM_PADRAO,
  mensagemDoCliente,
  type LinhaDeNumero,
} from "@/lib/reports/mensagem-do-cliente";
import { cn } from "@/lib/utils";

/* =====================================================================
   A mensagem que acompanha o relatório, editável
   ---------------------------------------------------------------------
   A PRÉVIA É A PRÓPRIA FUNÇÃO DO ENVIO. `mensagemDoCliente` é pura e
   roda aqui no navegador com um exemplo — não há uma segunda
   implementação para a tela. Enquanto existiram duas, a equipe conferia
   um texto e o cliente recebia outro; ver o cabeçalho daquele arquivo.

   HÁ UM MARCADOR DE NÚMERO, E É UM SÓ. `{numeros}` traz o bloco
   inteiro, montado a partir dos KPIs do relatório — não existe
   `{roas}`, `{investimento}` nem `{custo}` avulso, e isso é desenho, não
   omissão. Marcador que CALCULA é o que fez a legenda discordar do
   anexo em 27/08/2026, em oito de 54 contas. Ver o cabeçalho de
   `mensagem-do-cliente.ts`.

   A PRÉVIA MOSTRA UM EXEMPLO FIXO, e o exemplo tem selo. Na tela de
   configuração não há conta selecionada — os números abaixo são de
   demonstração. Os de verdade, da conta e do período escolhidos,
   aparecem na estação de comando, em "Texto para o cliente".

   O LIMITE É 900 E NÃO 1024. O WhatsApp corta em 1024, e `{periodo}`
   CRESCE na substituição — nove caracteres viram vinte e cinco. A folga
   impede que uma mensagem salva sem aviso chegue cortada no meio.
   ===================================================================== */

const LIMITE = 900;

/**
 * Os números do exemplo.
 *
 * SÃO OS DA SATÖ, 18–24/08/2026 — a conta que tornou o defeito de
 * agosto visível. O ROAS aqui é o da campanha de origem (12,35x, o do
 * PDF), com o selo, e não o da conta inteira (8,11x, o que a legenda
 * antiga imprimia). Quem abre esta tela vê logo de cara como a
 * ressalva aparece para o cliente.
 */
const NUMEROS_EXEMPLO: LinhaDeNumero[] = [
  { label: "Investimento", valor: "R$ 551,90", origem: null },
  { label: "Faturamento", valor: "R$ 4.137,74", origem: null },
  { label: "Pedidos", valor: "30", origem: null },
  { label: "Custo por pedido", valor: "R$ 16,75", origem: 1 },
  { label: "Retorno", valor: "12,35x", origem: 1 },
];

/** O exemplo da prévia. Semana fechada, que é o caso comum. */
const EXEMPLO = {
  periodoLabel: "18 – 24 de agosto de 2026",
  dias: 7,
  cliente: "Satö",
  numeros: NUMEROS_EXEMPLO,
} as const;

/** O mesmo exemplo fora da janela semanal, onde `{periodo}` muda. */
const EXEMPLO_MENSAL = {
  periodoLabel: "1 – 26 de agosto de 2026",
  dias: 26,
  cliente: "Satö",
  numeros: NUMEROS_EXEMPLO,
} as const;

export function MessageSettingsDialog({ atual }: { atual: string }) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-9"
        onClick={() => setAberto(true)}
      >
        <MessageSquareText className="size-4" />
        Mensagem
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="flex max-h-[90vh] w-[96vw] flex-col overflow-hidden sm:max-w-[min(94vw,720px)]">
          <DialogHeader>
            <DialogTitle>Mensagem enviada com o relatório</DialogTitle>
            <DialogDescription>
              É a legenda que vai junto do PDF no WhatsApp, igual para
              todos os clientes. Os números ficam no relatório.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pt-2">
            {/* `key` remonta o formulário ao reabrir: sem isso um
                rascunho abandonado voltaria na próxima abertura. */}
            <Formulario
              key={aberto ? "aberto" : "fechado"}
              atual={atual}
              onSaved={() => setAberto(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Formulario({
  atual,
  onSaved,
}: {
  atual: string;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(atual);
  const [salvando, iniciar] = useTransition();

  const limpo = texto.trim();
  const restantes = LIMITE - texto.length;

  /* Marcador que a substituição não conhece chegaria CRU ao cliente —
     "{periodo }" e "{Cliente}" passam por qualquer validação de
     tamanho. A ação recusa no servidor; aqui o aviso aparece enquanto
     a pessoa ainda está com o cursor no campo. */
  const conhecidos = new Set<string>(MARCADORES.map((m) => m.chave));
  const desconhecidos = [...new Set(texto.match(/\{[^}]*\}/g) ?? [])].filter(
    (m) => !conhecidos.has(m),
  );

  /* O período é o que torna a mensagem específica. Sem ele o cliente que
     recebe dois relatórios não sabe qual é qual — mas é escolha de quem
     escreve, então avisa em vez de barrar. */
  const semPeriodo = !texto.includes("{periodo}");

  /* Sem `{numeros}` a mensagem volta a ser só um aviso de anexo. É
     legítimo — foi assim entre 27/08 e 01/09 —, mas quem apaga o
     marcador sem querer não descobre no envio: o texto continua
     saindo, bonito e sem número nenhum. */
  const semNumeros = !texto.includes("{numeros}");

  const invalido =
    limpo.length === 0 || texto.length > LIMITE || desconhecidos.length > 0;

  function salvar() {
    iniciar(async () => {
      const r = await salvarMensagemDoCliente({ template: limpo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Mensagem salva.");
      router.refresh();
      onSaved();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="mensagem-do-cliente">Texto</Label>
          <span
            className={cn(
              "text-2xs tabular-nums",
              restantes < 0
                ? "text-negative"
                : restantes < 80
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {restantes} restantes
          </span>
        </div>

        <Textarea
          id="mensagem-do-cliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          className="font-mono text-xs leading-relaxed"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">Marcadores</span>
        <ul className="flex flex-col gap-1">
          {MARCADORES.map((m) => (
            <li key={m.chave} className="flex items-baseline gap-2 text-2xs">
              <button
                type="button"
                onClick={() => setTexto((t) => `${t}${m.chave}`)}
                className="shrink-0 rounded border border-hairline bg-surface-2/60 px-1.5 py-0.5 font-mono transition-colors hover:border-signal"
              >
                {m.chave}
              </button>
              <span className="text-muted-foreground">{m.descricao}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-2xs text-muted-foreground">
          Não existe marcador avulso de investimento, custo ou retorno —
          só <code>{"{numeros}"}</code>, que traz o bloco inteiro
          copiado dos cartões do PDF, com os rótulos da conta e o selo
          da campanha de origem. É o que impede o texto de discordar do
          anexo, como acontecia até agosto.
        </p>
      </div>

      {desconhecidos.length > 0 && (
        <p className="rounded-lg bg-negative-muted/40 px-3 py-2 text-2xs text-negative">
          <strong>{desconhecidos.join(", ")}</strong> não{" "}
          {desconhecidos.length === 1 ? "é um marcador" : "são marcadores"} que
          o sistema conhece — sairia assim mesmo, com as chaves, na
          mensagem do cliente.
        </p>
      )}

      {semPeriodo && desconhecidos.length === 0 && (
        <p className="rounded-lg bg-warning-muted/50 px-3 py-2 text-2xs text-warning">
          Sem <code>{"{periodo}"}</code> a mensagem não diz de quando é o
          relatório. Quem receber dois seguidos não tem como distinguir.
        </p>
      )}

      {semNumeros && desconhecidos.length === 0 && (
        <p className="rounded-lg bg-warning-muted/50 px-3 py-2 text-2xs text-warning">
          Sem <code>{"{numeros}"}</code> o cliente recebe o PDF sem
          nenhum número na mensagem — só o aviso do anexo.
        </p>
      )}

      {/* A PRÉVIA MOSTRA OS DOIS CASOS, porque `{periodo}` muda de forma
          conforme a janela — e é aí que "últimos 7 dias" escrito à mão
          vira mentira num relatório mensal. */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Como o cliente recebe</span>

        <Previa titulo="Relatório semanal" exemplo={EXEMPLO} texto={limpo} />
        <Previa
          titulo="Qualquer outro período"
          exemplo={EXEMPLO_MENSAL}
          texto={limpo}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setTexto(MENSAGEM_PADRAO)}
          disabled={salvando || texto === MENSAGEM_PADRAO}
        >
          <RotateCcw className="size-3.5" />
          Restaurar padrão
        </Button>

        <Button size="sm" onClick={salvar} disabled={salvando || invalido}>
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

function Previa({
  titulo,
  exemplo,
  texto,
}: {
  titulo: string;
  exemplo: { periodoLabel: string; dias: number; cliente: string };
  texto: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2/60 p-3">
      <p className="text-2xs text-muted-foreground">{titulo}</p>
      <p className="mt-1.5 text-xs whitespace-pre-wrap">
        {texto ? mensagemDoCliente(exemplo, texto) : "—"}
      </p>
    </div>
  );
}
