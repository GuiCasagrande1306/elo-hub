"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { criarNegocio } from "@/app/(app)/comercial/actions";
import type { DealOrigem } from "@/types/database";

/* =====================================================================
   Captura de lead em um campo
   ---------------------------------------------------------------------
   SUBSTITUI `new-deal-dialog.tsx`, que pedia sete campos e um título
   composto à mão. O módulo passou 44 dias no ar com ZERO negócios
   cadastrados, e este é o arquivo que carrega a correção: digitar o
   nome da empresa e apertar Enter cria o negócio.

   Por que uma BARRA e não um botão que abre modal: a conversa está
   acontecendo no WhatsApp, em outra janela. Um modal exige abrir,
   esperar, preencher, salvar e fechar — cinco passos e uma troca de
   contexto. A barra fica sempre visível no topo do quadro, e o custo de
   registrar um lead vira o mesmo de anotar num papel.

   ORIGEM COMO ATALHO, NÃO COMO OBRIGAÇÃO. Indicação e prospecção ativa
   são os dois canais reais da agência; ficam à mão em dois cliques
   porque o dado é barato de colher NA HORA e caro de reconstituir
   depois. Sem escolha, entra como "Outro" e alguém corrige na ficha.

   O RESTO É COBRADO ADIANTE. Telefone, valor, dono e previsão não são
   perguntados aqui — os portões pedem cada um na etapa em que ele
   importa. Ver `src/lib/crm/portoes.ts`.
   ===================================================================== */

/** Os dois canais reais da agência. O resto se escolhe na ficha. */
const CANAIS: { id: DealOrigem; label: string }[] = [
  { id: "indicacao", label: "Indicação" },
  { id: "prospeccao", label: "Prospecção" },
];

export function BarraDeCaptura() {
  const [empresa, setEmpresa] = useState("");
  const [origem, setOrigem] = useState<DealOrigem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  function capturar() {
    const nome = empresa.trim();
    if (!nome || enviando) return;

    iniciar(async () => {
      const r = await criarNegocio({
        company: nome,
        origem: origem ?? undefined,
      });

      if (!r.ok) {
        setErro(r.error);
        return;
      }

      /* Limpa e devolve o foco ao campo: quem está passando a limpo uma
         conversa registra três leads seguidos, e obrigar a clicar de
         novo entre um e outro é o atrito que fez a versão anterior
         morrer. A origem PERMANECE escolhida pelo mesmo motivo — uma
         leva de prospecção é toda da mesma origem. */
      setErro(null);
      setEmpresa("");
      campo.current?.focus();
    });
  }

  return (
    <div className="surface-card flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          ref={campo}
          value={empresa}
          onChange={(e) => {
            setEmpresa(e.target.value);
            if (erro) setErro(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              capturar();
            }
          }}
          placeholder="Nome da empresa e Enter — o resto vem depois"
          aria-label="Nome da empresa"
          className="flex-1"
          disabled={enviando}
        />

        <div className="flex items-center gap-2">
          {/* Dois botões que alternam, não um select: os dois canais
              reais da agência ficam à vista, e escolher custa um clique
              em vez de três. Clicar no que já está escolhido desmarca. */}
          <div
            role="group"
            aria-label="De onde veio"
            className="flex shrink-0 rounded-lg border border-hairline p-0.5"
          >
            {CANAIS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={origem === c.id}
                onClick={() => setOrigem(origem === c.id ? null : c.id)}
                className={cn(
                  "rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors",
                  origem === c.id
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <Button onClick={capturar} disabled={!empresa.trim() || enviando}>
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Registrar
          </Button>
        </div>
      </div>

      {erro && <p className="text-xs text-negative">{erro}</p>}
    </div>
  );
}
