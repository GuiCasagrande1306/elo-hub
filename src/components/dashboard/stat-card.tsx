import { Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Cartão de número no topo do painel.
 *
 * Compartilhado pelos dois perfis: o admin conta a agência, o
 * colaborador conta a própria carteira, mas a leitura é a mesma e duas
 * cópias divergiriam no primeiro ajuste de espaçamento.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutro",
}: {
  icon: typeof Users;
  label: string;
  /* Aceita string além de número: os cartões de dinheiro chegam já
     formatados em R$, e o de ritmo é uma frase ("8 no ritmo · 3
     abaixo"). Formatar aqui dentro obrigaria o componente a saber se o
     número é moeda, contagem ou percentual. */
  value: number | string;
  hint: string;
  tone?: "neutro" | "alerta";
}) {
  return (
    /* MAIS BAIXO NO CELULAR, e isso é a diferença entre ler e rolar.
       -----------------------------------------------------------------
       Medido em 20/08/2026 num viewport de 812px: os cartões antigos
       ocupavam ~115px cada, empilhados numa coluna só. Cinco números
       davam 2,5 telas de rolagem — e o painel existe para responder em
       cinco segundos, não em três deslizadas.

       Agora entram dois por linha no celular, com o ícone ao lado do
       rótulo em vez de numa coluna própria: a coluna do ícone comia 48px
       de largura, que num cartão de meia tela é onde o número mora. */
    <div
      className={cn(
        "surface-card flex flex-col gap-1.5 p-3 sm:flex-row sm:items-start sm:gap-3 sm:p-4",
        tone === "alerta" && "ring-warning/35",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg sm:size-9",
          tone === "alerta"
            ? "bg-warning-muted text-warning"
            : "bg-surface-2 text-muted-foreground",
        )}
      >
        <Icon className="size-3.5 sm:size-4" />
      </span>

      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        {/* Frase longa não cabe em text-2xl — "8 no ritmo · 3 abaixo"
            quebraria em duas linhas e desalinharia o card do vizinho.
            O corte em 12 caracteres separa número de sentença. */}
        {/* Frase longa não cabe em text-2xl — "8 no ritmo · 3 abaixo"
            quebraria em duas linhas e desalinharia o card do vizinho.
            O corte em 12 caracteres separa número de sentença. */}
        <p
          className={cn(
            "mt-0.5 font-semibold tabular-nums leading-none tracking-[-0.02em]",
            String(value).length > 12
              ? "text-sm sm:text-base"
              : "text-xl sm:text-2xl",
          )}
        >
          {value}
        </p>
        {/* A DICA SOME NO CELULAR. Ela explica de onde o número vem, o
            que é leitura de conferência — e conferência se faz sentado,
            no desktop. Mantê-la ali custava uma linha de texto miúdo por
            cartão, seis linhas ao todo, empurrando o gráfico para fora
            da primeira tela. */}
        <p className="mt-1 hidden text-2xs text-muted-foreground sm:block">
          {hint}
        </p>
      </div>
    </div>
  );
}
