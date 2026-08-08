"use client";

import { useState } from "react";
import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Sidebar } from "./sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { GlobalSearch } from "./global-search";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Client, Profile } from "@/types/database";

interface AppShellProps {
  user: Profile;
  clients: Client[];
  demoMode: boolean;
  children: React.ReactNode;
}

/**
 * Estrutura de duas colunas: sidebar fixa a partir de `lg`, gaveta no
 * mobile. A `topbar` é sticky e ganha uma hairline apenas quando há
 * conteúdo rolado atrás dela — borda permanente sobre página vazia
 * parece sujeira.
 */
export function AppShell({ user, clients, demoMode, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Ponto de corte único em `md` (768px) para sidebar, gaveta e
          barra inferior. Com a sidebar em `lg` e a barra em `md`, as
          telas entre 768 e 1024 ficavam sem nenhuma das duas — só o
          hambúrguer, que é o pior dos dois mundos. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-sidebar-border md:block">
        <Sidebar user={user} clients={clients} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-hairline bg-background/85 px-4 backdrop-blur-xl sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            {/* Base UI compõe com `render`, não com `asChild` (Radix).
                Passar `asChild` aqui renderizaria um <button> dentro de
                outro <button> e quebraria a hidratação. */}
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Abrir menu"
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[272px] p-0">
              <SheetTitle className="sr-only">Navegação</SheetTitle>
              <Sidebar
                user={user}
                clients={clients}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {/* A mesma lista que a sidebar usa: já filtrada pelo RLS, e é
              o que torna a busca de cliente instantânea e sem rede. */}
          <GlobalSearch clients={clients} role={user.role} />

          <div className="ml-auto flex items-center gap-1.5">
            {demoMode && <DemoBadge />}
            <ThemeToggle />
          </div>
        </header>

        {/* A barra inferior é `fixed`, então não ocupa espaço no fluxo.
            Sem reservar a altura dela aqui (56px + área segura), o
            último item de toda lista fica escondido atrás da barra.

            Classe do Tailwind, e não style inline: inline vence classe
            por especificidade, e o `md:pb-0` nunca zeraria o espaço no
            desktop. Os `_` viram espaços — o calc do CSS exige espaço
            em volta do `+`. */}
        <main className="flex-1 pb-[calc(56px_+_env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      <MobileNavigation />
    </div>
  );
}

function DemoBadge() {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full bg-warning-muted px-2.5 py-1 text-2xs font-medium text-warning sm:inline-flex"
      title="Sem credenciais do Supabase: exibindo dataset de demonstração."
    >
      <span className="size-1.5 rounded-full bg-warning" />
      Modo demo
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Alternar tema"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Renderiza os dois e alterna por CSS: ler `resolvedTheme` durante
          a hidratação causaria divergência entre servidor e cliente. */}
      <Sun className="size-[18px] rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-[18px] rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
