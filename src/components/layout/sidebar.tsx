"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, ChevronsUpDown, LogOut, Settings } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserProfileDialog } from "./user-profile-dialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { ClientAvatar } from "@/components/clients/client-avatar";
import { isNavActive, primaryNav, secondaryNav } from "./nav-config";
import type { Client, Profile } from "@/types/database";

interface SidebarProps {
  user: Profile;
  clients: Client[];
  onNavigate?: () => void;
}

/**
 * Sidebar do sistema.
 *
 * Detalhe de design que carrega o peso visual: o item ativo não é um
 * bloco pintado inteiro — é uma barra de 2px na cor de sinal, com o
 * fundo apenas insinuado. A barra usa `layoutId` do Motion, então ela
 * desliza entre os itens em vez de piscar. Custa pouco e é o tipo de
 * detalhe que diferencia produto de template.
 */
export function Sidebar({ user, clients, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [perfilAberto, setPerfilAberto] = useState(false);

  async function sair() {
    const supabase = getSupabaseBrowserClient();
    // `signOut` limpa o cookie de sessão; `refresh` é o que faz o
    // proxy reavaliar e mandar para /login sem depender do cache.
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const visibleSecondary = secondaryNav.filter(
    (item) => !item.adminOnly || user.role === "admin",
  );

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar">
      {/* Marca ------------------------------------------------------
          Duas artes, uma por tema, alternadas por CSS (`dark:hidden` /
          `hidden dark:block`) e NÃO por JavaScript. Ler o tema no
          cliente para escolher a imagem causaria divergência de
          hidratação e um piscar de logo errada no primeiro frame.

          Ambas usam o mesmo viewBox 150×32: trocar pelo arquivo oficial
          em alta resolução não mexe no layout.

          `priority` porque a logo está acima da dobra em toda página —
          sem isso ela entra na fila de lazy-load e aparece depois do
          resto da sidebar. */}
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Elo Hub — ir para a visão geral"
          className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Image
            src="/logo-light.svg"
            alt="Elo Marketing"
            width={150}
            height={32}
            priority
            className="h-7 w-auto dark:hidden"
          />
          <Image
            src="/logo-dark.svg"
            alt="Elo Marketing"
            width={150}
            height={32}
            priority
            className="hidden h-7 w-auto dark:block"
          />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="flex flex-col gap-0.5">
          {primaryNav.map((item) => {
            const active = isNavActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-signal"
                      transition={{ type: "spring", stiffness: 520, damping: 38 }}
                    />
                  )}
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active ? "text-signal" : "text-muted-foreground/80",
                    )}
                    strokeWidth={active ? 2.2 : 1.9}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Atalho para as contas -------------------------------------
            Colaborador só vê aqui o que o RLS já devolveu — a lista
            chega filtrada do servidor, não é escondida no cliente. */}
        {clients.length > 0 && (
          <div className="mt-7">
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="eyebrow">Contas</span>
              <Link
                href="/clientes"
                onClick={onNavigate}
                className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
              >
                ver todas
              </Link>
            </div>
            <ul className="flex flex-col gap-0.5">
              {clients.slice(0, 6).map((client) => {
                const active = pathname === `/clientes/${client.slug}`;
                return (
                  <li key={client.id}>
                    <Link
                      href={`/clientes/${client.slug}`}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground",
                      )}
                    >
                      <ClientAvatar
                        name={client.name}
                        logoUrl={client.logo_url}
                        brandPrimary={client.brand_primary}
                        className="size-4 rounded-[5px]"
                      />
                      <span className="truncate">{client.name}</span>
                      <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {visibleSecondary.length > 0 && (
          <ul className="mt-7 flex flex-col gap-0.5 border-t border-sidebar-border pt-4">
            {visibleSecondary.map((item) => {
              const active = isNavActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" strokeWidth={1.9} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Usuário ---------------------------------------------------- */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-[11px] font-semibold ring-1 ring-hairline">
                  {user.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável; next/image exigiria allowlist.
                    <img src={user.avatar_url} alt="" className="size-full object-cover" />
                  ) : (
                    initials(user.full_name)
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-tight">
                    {user.full_name}
                  </p>
                  <p className="truncate text-2xs leading-tight text-muted-foreground">
                    {user.role === "admin"
                      ? "Administrador"
                      : user.job_title || "Colaborador"}
                  </p>
                </div>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            }
          />

          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuItem onClick={() => setPerfilAberto(true)}>
              <Settings className="size-3.5" />
              Configurações de conta
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={sair}
              className="text-destructive data-[highlighted]:text-destructive"
            >
              <LogOut className="size-3.5" />
              Sair da conta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UserProfileDialog
        user={user}
        open={perfilAberto}
        onOpenChange={setPerfilAberto}
      />
    </div>
  );
}
