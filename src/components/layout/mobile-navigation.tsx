"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { isNavActive, navDoMobile } from "./nav-config";
import { cn } from "@/lib/utils";

/* =====================================================================
   Bottom Navigation — mobile
   ---------------------------------------------------------------------
   Aparece abaixo de `md` (768px); a partir daí a sidebar assume.

   Três detalhes que separam uma barra inferior que funciona no celular
   de uma que só parece funcionar no simulador:

   1. `env(safe-area-inset-bottom)` — no iPhone com indicador de home,
      sem esse padding os botões ficam por baixo da barra do sistema e
      o toque não chega neles. Depende de `viewport-fit=cover`, definido
      no viewport do layout raiz.

   2. Alvo de toque de 44px de altura mínima. É a diretriz da Apple e o
      limite abaixo do qual o erro de toque dispara — especialmente com
      cinco itens dividindo a largura de um iPhone SE.

   3. `pb-[calc(...)]` no <main>, não `margin` na barra: a barra é
      `fixed`, então ela não ocupa espaço no fluxo. Sem reservar o
      espaço embaixo, o último card de toda lista fica escondido atrás
      dela — e o usuário nunca descobre que existe conteúdo ali.

   A pílula do item ativo usa `layoutId`, então desliza entre os itens
   em vez de piscar. É o mesmo recurso da sidebar, para os dois modos de
   navegação parecerem o mesmo produto.
   ===================================================================== */

export function MobileNavigation({ role }: { role: string }) {
  const pathname = usePathname();

  // A barra inferior carrega apenas os destinos principais. Contas,
  // configurações e perfil continuam na gaveta do topo — cinco itens é
  // o limite antes de os rótulos começarem a truncar.
  //
  // Para um usuário de cliente a lista é outra: só o funil dele. Ver
  // `navDoMobile`.
  const items = navDoMobile(role);

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t border-hairline bg-background/92 backdrop-blur-xl",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isNavActive(item, pathname);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2",
                  "transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-active"
                    className="absolute inset-x-2 top-0 h-[2px] rounded-full bg-signal"
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                  />
                )}

                <item.icon
                  className={cn(
                    "size-[22px] shrink-0 transition-colors",
                    active && "text-signal",
                  )}
                  strokeWidth={active ? 2.2 : 1.8}
                />

                {/* Rótulo curto: "Visão geral" quebraria em duas linhas
                    numa coluna de ~75px no iPhone SE. */}
                <span className="w-full truncate text-center text-[10px] font-medium leading-none">
                  {shortLabel(item.label)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Rótulos enxutos para caber na largura de um quinto de tela. */
function shortLabel(label: string): string {
  const map: Record<string, string> = {
    "Visão geral": "Início",
    Clientes: "Clientes",
    Tarefas: "Tarefas",
    Relatórios: "Relatórios",
    Performance: "Métricas",
  };
  return map[label] ?? label;
}
